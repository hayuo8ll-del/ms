"""ボトルネック(HAL)基準の日次フロー計画エンジン。

現場の実運用に合わせた計画立案:

  1. 月(期間)の総台数 ÷ 稼働日 → 必要日次レートを求め、そのレートを賄えるシフト
     モード(例: 16H=9万/日, 22H=12万/日)を選ぶ。(Step 1)
  2. ボトルネック工程(HAL)の日次能力を上限に、機種別の日次投入台数を稼働日へ
     割り付ける。納期の早い機種から順(EDD)に、切替を減らすため機種ごとに
     まとめて(キャンペーン)投入する。(Step 2)

離散ジョブを前進スケジュールする `scheduler.py` とは別方式。TAL/ANTの逆算・
MILの製番別展開(Step 3/4)は今後ここに追加していく。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

# A勤限定の機種切替(管理者作業)がその日にできず翌朝へ繰り下がったことを示す警告タグ。
# 警告文の生成と、その件数集計(main.py)の両方でこの定数を使う。
A_SHIFT_DEFERRAL_TAG = "機種切替(管理者作業)はA勤のみ"

def _record_deferral(deferrals: dict, product: str, day) -> None:
    """A勤限定切替の繰り下げを機種×日で1回だけ記録する(ロットごとに数えない)。"""
    days = deferrals.setdefault(product, [])
    if not days or days[-1] != day:
        days.append(day)


# 完成目標を超過する製番の警告を何件まで個別に出すか(残りは1行へ集約)。
# 遅延が数十件あるとき全部並べると、他の警告が読めなくなる。
_LATE_WARNING_LIMIT = 10


@dataclass
class DemandItem:
    """一定期間に生産すべき機種と数量・納期。

    `due_date` は**完成目標日**(=台帳の完成予定日)。EDD/スラック並べ替え・遅れ判定はこれ。
    `ship_date` は台帳の出荷日(表示用)。出荷日はこのラインの後工程(内製カードのカード化
    など)を経た先の日付なので、完成目標には使わない。台帳に出荷日が無い行は None。
    """

    product: str
    quantity: float
    due_date: date
    order_id: str = ""
    ship_date: date | None = None


@dataclass
class StageFlowConfig:
    """ボトルネック(HAL)基準で各工程をどれだけずらして流すかの設定。

    lead_offset_days は稼働日数のオフセット。上流(ANT/TAL)は負(HALより早く投入)、
    ボトルネック自身は0、下流(MIL)は正(HALより後で完成)。
    daily_capacity を与えると、その工程の日次合計が超過した日に警告を出す。
    input_unit はその工程の投入単位(例: TAL=40,000のまとめ投入, HAL=リール1本10,000)。
    投入は単位の倍数を基本とし、ロットの端数(機種の台数による調整)は最終投入で吸収する。
    """

    stage_id: str
    lead_offset_days: int
    daily_capacity: float | None = None
    input_unit: float | None = None
    # 機種別のオフセット上書き(実リード由来の動的化)。無い機種は lead_offset_days を使う。
    lead_offset_by_product: dict[str, int] | None = None

    def offset_for(self, product: str) -> int:
        if self.lead_offset_by_product and product in self.lead_offset_by_product:
            return self.lead_offset_by_product[product]
        return self.lead_offset_days


@dataclass
class StageDailyCell:
    stage_id: str
    day: date
    product: str
    quantity: float
    order_id: str = ""


@dataclass
class EquipmentStop:
    """設備停止マスタの1行(試作/OH/保全/故障/能力制限など)。

    期間は「開始日+開始勤務 〜 終了日+終了勤務」(A勤=日の前半, B勤=後半)。
    method は 全停止 / 時間控除 / 停止率控除。corrected_cap(補正後Cap_台)が
    入っている日はその値をその日の上限として優先する。
    """

    stop_id: str
    stage_id: str
    machine_id: str
    start_day: date
    end_day: date
    start_shift: str = "A勤"
    end_shift: str = "B勤"
    method: str = "全停止"
    stop_rate_pct: float | None = None
    stop_hours: float | None = None
    corrected_cap: float | None = None
    enabled: bool = True
    reason: str = ""


def apply_equipment_stops(
    working_days: list[date],
    daily_capacity: float,
    stops: list[EquipmentStop],
    bottleneck_stage: str = "HAL",
    machine_counts: dict[str, int] | None = None,
    daily_hours: float = 16.0,
) -> tuple[dict[date, float], list[str]]:
    """設備停止マスタをボトルネック工程の日次能力へ反映する。

    1台あたりの寄与はライン日次能力÷その工程の号機台数で近似する。
    ボトルネック以外の工程の停止は日次能力に反映せず、確認用の警告のみ出す。
    戻り値: ({停止影響日: 補正後のライン日次能力}, 警告一覧)。
    """
    day_caps: dict[date, float] = {}
    warnings: list[str] = []
    wd = set(working_days)

    for stop in stops:
        if not stop.enabled:
            continue
        if stop.stage_id != bottleneck_stage:
            warnings.append(
                f"設備停止{stop.stop_id}({stop.stage_id} {stop.machine_id} {stop.method}): "
                f"ボトルネック({bottleneck_stage})以外の工程のため日次能力には反映していません。"
                f"当該工程側の遅れ影響は現場で確認してください。"
            )
            continue

        n_machines = max((machine_counts or {}).get(stop.stage_id, 1), 1)
        share = daily_capacity / n_machines
        d = stop.start_day
        while d <= stop.end_day:
            if d in wd:
                start_frac = 0.5 if (d == stop.start_day and stop.start_shift == "B勤") else 0.0
                end_frac = 0.5 if (d == stop.end_day and stop.end_shift == "A勤") else 1.0
                fraction = max(end_frac - start_frac, 0.0)
                cap = day_caps.get(d, daily_capacity)
                if stop.method == "全停止":
                    cap -= share * fraction
                elif stop.method == "時間控除":
                    cap -= share * min((stop.stop_hours or 0.0) / max(daily_hours, 1.0), 1.0)
                elif stop.method == "停止率控除":
                    cap -= share * ((stop.stop_rate_pct or 0.0) / 100.0) * fraction
                if stop.corrected_cap is not None:
                    cap = min(cap, stop.corrected_cap)
                day_caps[d] = max(cap, 0.0)
            d += timedelta(days=1)

        warnings.append(
            f"設備停止{stop.stop_id}: {stop.stage_id} {stop.machine_id} "
            f"{stop.start_day.isoformat()}{stop.start_shift}〜{stop.end_day.isoformat()}{stop.end_shift} "
            f"を{stop.method}で日次能力に反映しました。"
        )

    return day_caps, warnings


@dataclass
class MilLotCompletion:
    """MIL(最終工程)を製番(出荷ロット)単位で見た完成日と納期充足。

    `due_date` は完成目標日(台帳の完成予定日)。`on_time` は完成日<=完成目標日。
    `ship_date` は台帳の出荷日(表示用。後工程を経た先の日付)。
    """

    order_id: str
    product: str
    quantity: float
    completion_day: date
    due_date: date | None = None
    on_time: bool | None = None
    ship_date: date | None = None


@dataclass
class DailyCell:
    """ある稼働日・ある機種にボトルネック工程で投入する台数。"""

    day: date
    product: str
    quantity: float
    order_id: str = ""
    machine_id: str = ""  # 号機マスタを与えたときのみ埋まる(どの号機に載せたか)


@dataclass
class MachineSlot:
    """ある号機の、あるシフトモードでの日次能力と生産可能機種(CAP表 由来)。

    `eligibility` は {呼称: "○"(生産可) / "△"(条件付き)}。× は入れない。
    設備×機種の可否は 機種別キャパ に畳み込まれた数字だけでは表現できない
    (どの号機が空いているかで、同日に何機種を並行できるかが決まる)ため、
    号機の粒度で持つ。
    """

    machine_id: str
    stage_id: str
    daily_capacity: float
    eligibility: dict[str, str] = field(default_factory=dict)

    def can_run(self, product: str, allow_conditional: bool = True) -> bool:
        mark = self.eligibility.get(product)
        if mark is None:
            return False
        return mark == "○" or (allow_conditional and mark == "△")


@dataclass
class ProgressRow:
    """1稼働日の進捗(計画/実績/差/累計)。現場のSheet1(計画/実績/差/進捗)に相当。"""

    day: date
    plan: float  # 計画 日次(ボトルネック=ライン計)
    plan_cum: float  # 計画累計
    actual: float | None = None  # 実績 日次(未入力はNone)
    actual_cum: float | None = None  # 実績累計
    diff: float | None = None  # 実績 - 計画
    progress_cum: float | None = None  # Σ(実績-計画) = 進捗


@dataclass
class BottleneckPlanResult:
    shift_mode: str
    daily_capacity: float
    required_daily_rate: float
    working_days: list[date]  # ボトルネック(HAL)を配分する稼働日
    # 工程展開の表示軸。上流(ANT/TAL)はHALより前に投入され下流(MIL)は後に完成するため、
    # working_days の前後へオフセット分だけ伸ばした軸。機種×日マトリクスの列はこちらを使う。
    stage_days: list[date] = field(default_factory=list)
    allocation: list[DailyCell] = field(default_factory=list)  # ボトルネック(HAL)の日次配分
    completion: dict[str, date] = field(default_factory=dict)  # 機種 -> 投入完了日
    stage_allocation: list[StageDailyCell] = field(default_factory=list)  # 全工程(ANT/TAL/HAL/MIL)の日次
    mil_lots: list[MilLotCompletion] = field(default_factory=list)  # MILの製番別完成日
    progress: list[ProgressRow] = field(default_factory=list)  # 計画/実績/差/累計の進捗
    stage_progress: dict = field(default_factory=dict)  # 工程別の進捗 {工程: [ProgressRow]}
    remedies: list["Remedy"] = field(default_factory=list)  # 納期遅れの解消提案
    campaigns: list["Campaign"] = field(default_factory=list)  # 工程×機種の段取り(切替)キャンペーン
    warnings: list[str] = field(default_factory=list)


@dataclass
class Campaign:
    """ある工程で同一機種を連続稼働日に生産する塊(段取り替えの単位)。"""

    stage_id: str
    product: str
    start_day: date
    end_day: date
    quantity: float
    # 開始直前の稼働日に同工程で(別機種の)生産があった=段取り替えを伴う開始。
    # 直前が非稼働/停止/工程初日なら立上げ(切替ではない)ため False。
    is_changeover: bool = False


def derive_campaigns(
    cells,
    working_days: list[date],
    stage_order: list[str] | None = None,
) -> list["Campaign"]:
    """工程×機種の日次配分から、機種キャンペーンと切替(段取り)を導出する。

    キャンペーン = ある工程で同一機種を連続稼働日に生産する塊。稼働日が1日でも飛べば
    別キャンペーン(=再段取り)とみなす。`is_changeover` は開始直前の稼働日に同工程で
    生産があった(=別機種からの切替)ときに True。
    `cells` は `.stage_id/.day/.product/.quantity` を持つオブジェクト列。
    """
    idx = {d: i for i, d in enumerate(working_days)}
    by_sp: dict[str, dict[str, dict[date, float]]] = {}
    stage_busy_days: dict[str, set[date]] = {}
    for c in cells:
        if c.quantity <= 0 or c.day not in idx:
            continue
        by_sp.setdefault(c.stage_id, {}).setdefault(c.product, {})
        by_sp[c.stage_id][c.product][c.day] = by_sp[c.stage_id][c.product].get(c.day, 0.0) + c.quantity
        stage_busy_days.setdefault(c.stage_id, set()).add(c.day)

    order = stage_order or list(by_sp)
    campaigns: list[Campaign] = []
    for stage in order:
        prods = by_sp.get(stage, {})
        runs: list[tuple[str, date, date, float]] = []
        for product, daymap in prods.items():
            ds = sorted(daymap)
            run = [ds[0]]
            for d in ds[1:]:
                if idx[d] == idx[run[-1]] + 1:
                    run.append(d)
                else:
                    runs.append((product, run[0], run[-1], sum(daymap[x] for x in run)))
                    run = [d]
            runs.append((product, run[0], run[-1], sum(daymap[x] for x in run)))
        runs.sort(key=lambda r: (r[1], r[0]))
        busy = stage_busy_days.get(stage, set())
        for product, start, end, qty in runs:
            pi = idx[start] - 1
            is_changeover = pi >= 0 and working_days[pi] in busy
            campaigns.append(Campaign(stage, product, start, end, qty, is_changeover))
    return campaigns


def compute_progress(
    result: "BottleneckPlanResult",
    daily_actuals: dict[date, float] | None = None,
) -> list[ProgressRow]:
    """稼働日ごとの計画(ボトルネック日次合計)・実績・差・累計を計算する。

    daily_actuals({日付: 実績台数})を渡すと実績日次・差・進捗(Σ差)も付く。実績が無い/
    未入力の日は実績系をNoneにして計画累計だけ出す(予定管理のみ)。
    """
    plan_daily: dict[date, float] = {}
    for cell in result.allocation:
        plan_daily[cell.day] = plan_daily.get(cell.day, 0.0) + cell.quantity

    rows: list[ProgressRow] = []
    plan_cum = 0.0
    actual_cum = 0.0
    progress_cum = 0.0
    saw_actual = False
    for day in result.working_days:
        plan = plan_daily.get(day, 0.0)
        plan_cum += plan
        row = ProgressRow(day=day, plan=plan, plan_cum=plan_cum)
        if daily_actuals is not None and day in daily_actuals:
            saw_actual = True
            actual = daily_actuals[day]
            actual_cum += actual
            progress_cum += actual - plan
            row.actual = actual
            row.actual_cum = actual_cum
            row.diff = actual - plan
            row.progress_cum = progress_cum
        rows.append(row)

    # 実績が1件も無ければ計画累計のみ(実績系はNoneのまま)
    if not saw_actual:
        for row in rows:
            row.actual = row.actual_cum = row.diff = row.progress_cum = None
    return rows


def compute_stage_progress(
    result: "BottleneckPlanResult",
    actuals_by_stage: dict[str, dict[date, float]] | None = None,
) -> dict[str, list[ProgressRow]]:
    """**工程別**の進捗(計画/実績/差/累計)を稼働日ごとに計算する。

    計画は `stage_allocation` の工程×日合計、実績は `actuals_by_stage`
    ({工程: {日付: 実績}})。TAL/MILはTHM短期投入予定表の赤字、HALはTA1_投入計画の赤字
    を想定。実績の無い工程も計画累計だけの行を返す(工程別の予定管理に使える)。
    戻り値: {工程ID: [ProgressRow]}。
    """
    actuals_by_stage = actuals_by_stage or {}
    plan_by_stage: dict[str, dict[date, float]] = {}
    for c in result.stage_allocation:
        s = plan_by_stage.setdefault(c.stage_id, {})
        s[c.day] = s.get(c.day, 0.0) + c.quantity

    out: dict[str, list[ProgressRow]] = {}
    for stage_id in list(plan_by_stage) + [s for s in actuals_by_stage if s not in plan_by_stage]:
        plan_daily = plan_by_stage.get(stage_id, {})
        daily_actuals = actuals_by_stage.get(stage_id)
        rows: list[ProgressRow] = []
        plan_cum = actual_cum = progress_cum = 0.0
        saw_actual = False
        for day in result.working_days:
            plan = plan_daily.get(day, 0.0)
            plan_cum += plan
            row = ProgressRow(day=day, plan=plan, plan_cum=plan_cum)
            if daily_actuals is not None and day in daily_actuals:
                saw_actual = True
                actual = daily_actuals[day]
                actual_cum += actual
                progress_cum += actual - plan
                row.actual = actual
                row.actual_cum = actual_cum
                row.diff = actual - plan
                row.progress_cum = progress_cum
            rows.append(row)
        if not saw_actual:
            for row in rows:
                row.actual = row.actual_cum = row.diff = row.progress_cum = None
        out[stage_id] = rows
    return out


def working_days_in_range(start: date, end: date, holidays: set[date] | None = None) -> list[date]:
    """start〜end(両端含む)の稼働日(土日と holidays を除く)を列挙する。"""
    holidays = holidays or set()
    days: list[date] = []
    d = start
    while d <= end:
        if d.weekday() < 5 and d not in holidays:  # 0=月 .. 4=金
            days.append(d)
        d += timedelta(days=1)
    return days


def extend_working_days(
    working_days: list[date],
    before: int,
    after: int,
    holidays: set[date] | None = None,
) -> list[date]:
    """稼働日リストの前後に稼働日を継ぎ足す(工程展開のはみ出しを受け止める軸)。

    上流工程(ANT/TAL)はHALより前に投入されるため、計画期間の先頭数日ぶんの投入は
    期間開始より前に出る。その分の列が無いと台数が黙って消えるので、表示・集計用に
    前後へ稼働日を伸ばした軸を作る。
    """
    if not working_days:
        return working_days
    holidays = holidays or set()

    def walk(start: date, step: int, count: int) -> list[date]:
        out: list[date] = []
        d = start
        while len(out) < count:
            d += timedelta(days=step)
            if d.weekday() < 5 and d not in holidays:
                out.append(d)
        return out

    head = sorted(walk(working_days[0], -1, max(0, before)))
    tail = walk(working_days[-1], 1, max(0, after))
    return head + list(working_days) + tail


def stage_offset_span(stage_flows: list[StageFlowConfig]) -> tuple[int, int]:
    """stage_flows のオフセットが必要とする (前に伸ばす日数, 後ろに伸ばす日数)。"""
    offsets: list[int] = []
    for flow in stage_flows or []:
        offsets.append(flow.lead_offset_days)
        offsets.extend((flow.lead_offset_by_product or {}).values())
    if not offsets:
        return 0, 0
    return max(0, -min(offsets)), max(0, max(offsets))


def required_daily_rate(
    demands: list[DemandItem],
    working_days: list[date],
    max_rate: float | None = None,
) -> float:
    """納期を考慮した必要日次レートを出す。

    「期間需要 ÷ 稼働日数」だと、画面で指定した終了日を伸ばすだけで必要レートが下がり、
    9月納期のロットまで8月に作る前提でシフトモードが決まってしまう。ここでは各納期
    時点での **累積需要 ÷ その納期までの稼働日数** の最大値を取る(累積フィージビリティ)。
    終了日を後ろへ伸ばしても、早い納期のロットに必要なレートは下がらない。

    - 計画開始より前の納期(既に遅れているロット)は、それ自体ではレートを決めない
      (過去はどのモードでも取り返せないため)が、数量は以降の累積に効かせる。
    - `max_rate`(最大シフト能力)を渡すと、それを超える納期チェックポイントは
      **どのモードでも間に合わない**ので最大値の判定から外す。間に合わないことは
      納期遅れ警告の仕事で、シフトモード選択をそこに引きずられないようにする。
    - 期間末より後の納期は、全稼働日で割る。
    戻り値: 必要日次レート(台/日)。
    """
    if not working_days:
        raise ValueError("稼働日が0日です。期間・カレンダーを確認してください。")
    by_due: dict[date, float] = {}
    for item in demands:
        by_due[item.due_date] = by_due.get(item.due_date, 0.0) + item.quantity

    total = sum(by_due.values())
    best = total / len(working_days)  # 期間全体を流し切るのに必要なレート
    cumulative = 0.0
    for due in sorted(by_due):
        cumulative += by_due[due]
        if due < working_days[0]:
            continue  # 既に納期切れ。数量は cumulative に残して次の納期で効かせる
        available = sum(1 for d in working_days if d <= due)
        if available <= 0:
            continue
        rate = cumulative / available
        if max_rate is not None and rate > max_rate:
            continue  # どのモードでも間に合わない納期。遅れ警告に任せる
        best = max(best, rate)
    return best


def choose_shift_mode(
    total_demand: float,
    num_working_days: int,
    capacities: dict[str, float],
    product_demands: dict[str, float] | None = None,
    product_caps_by_mode: dict[str, dict[str, float]] | None = None,
    required_rate: float | None = None,
) -> tuple[str, float, float]:
    """必要日次レートを賄える最小のシフトモードを選ぶ。

    capacities は {シフトモード名: 日次能力}(例 {"16h": 90000, "22h": 120000})。
    product_demands と product_caps_by_mode({モード: {機種: 日産キャパ}})を渡すと、
    ライン合計だけでなく **機種別にも期間内に作り切れるか** を確認する
    (例: Lite-Sだけ需要が大きい月は、合計では16Hで足りても22Hへ上げる)。
    どのモードでも足りない場合は最大能力のモードを返す(呼び出し側で警告)。
    `required_rate` を渡すと必要日次レートをそれで上書きする(納期を考慮した
    `required_daily_rate` の結果を渡す想定。省略時は 総需要÷稼働日数)。
    戻り値: (シフトモード, 日次能力, 必要日次レート)。
    """
    if num_working_days <= 0:
        raise ValueError("稼働日が0日です。期間・カレンダーを確認してください。")
    required = required_rate if required_rate is not None else total_demand / num_working_days
    for mode, cap in sorted(capacities.items(), key=lambda kv: kv[1]):
        if cap < required:
            continue
        if product_demands and product_caps_by_mode:
            mode_caps = product_caps_by_mode.get(mode, {})
            if any(
                qty > mode_caps.get(product, float("inf")) * num_working_days
                for product, qty in product_demands.items()
            ):
                continue  # この機種はこのモードでは期間内に作り切れない
        return mode, cap, required
    mode, cap = max(capacities.items(), key=lambda kv: kv[1])
    return mode, cap, required


def apply_actuals(
    demands: list[DemandItem],
    actuals: dict[str, float],
) -> tuple[list[DemandItem], list[str]]:
    """製番別の生産実績を需要から控除し、残数量で再立案できるようにする。

    - 実績が数量以上のロットは「完了済み」として計画から外す(情報として警告に載せる)。
    - 需要に無い製番の実績は無視せず警告する(製番の打ち間違い検知)。
    戻り値: (残数量に調整した需要, 警告一覧)。
    """
    adjusted: list[DemandItem] = []
    warnings: list[str] = []
    matched: set[str] = set()
    completed: list[str] = []

    for d in demands:
        done = actuals.get(d.order_id, 0.0)
        if d.order_id in actuals:
            matched.add(d.order_id)
        if done <= 0:
            adjusted.append(d)
            continue
        rest = d.quantity - done
        if rest <= 0:
            completed.append(d.order_id)
            continue
        adjusted.append(DemandItem(product=d.product, quantity=rest, due_date=d.due_date, order_id=d.order_id, ship_date=d.ship_date))

    # 製番ごとに1行出すと数百行になり、納期遅れなど本当に見るべき警告が埋もれる。
    # 件数 + 先頭いくつかの製番に集約する(全件は 製番別MIL シート側で追える)。
    def _summarize(seibans: list[str], head: str) -> None:
        if not seibans:
            return
        sample = "、".join(sorted(seibans)[:5])
        more = f" ほか{len(seibans) - 5}件" if len(seibans) > 5 else ""
        warnings.append(f"{head}: {len(seibans)}件 ({sample}{more})")

    _summarize(completed, "実績が計画数に達したため計画から除外した製番")
    _summarize(
        sorted(set(actuals) - matched),
        "実績はあるが台帳の対象受注に見つからない製番(製番・対象期間を確認してください)",
    )

    return adjusted, warnings


def _sequence_lots(
    demands: list[DemandItem],
    working_days: list[date],
    product_daily_caps: dict[str, float] | None,
) -> list[DemandItem]:
    """投入順を決める。機種別キャパを考慮した **余裕(スラック)の小さい順**。

    素のEDD(納期順)だと、機種別キャパの小さい機種(例 Lite-S 42,240/日 = 需要を
    流し切るのに21稼働日必要)が、納期が遅いというだけで後回しになり、着手した時には
    もう間に合わない。現場は逆に、そういう機種を早い時期から毎日流し続ける。

    ロットごとに
        スラック = 納期までの稼働日数 − 同一機種で自分より納期の早い分も含めた所要日数
    を出し、小さい順(=余裕が無い順)に並べる。所要日数は機種別キャパで割って求めるので、
    キャパの小さい機種ほど早く前に出る。**機種別キャパが無い場合は所要日数が0となり、
    従来どおりの純粋なEDD順に一致する。**
    """
    ordered = sorted(demands, key=lambda d: (d.due_date, d.product))
    if not working_days:
        return ordered

    days_until: dict[date, int] = {}

    def available(due: date) -> int:
        if due not in days_until:
            days_until[due] = sum(1 for d in working_days if d <= due)
        return days_until[due]

    cumulative: dict[str, float] = {}
    slack: list[tuple[float, date, str]] = []
    for item in ordered:
        cap = (product_daily_caps or {}).get(item.product)
        cum = cumulative.get(item.product, 0.0) + item.quantity
        cumulative[item.product] = cum
        need_days = cum / cap if cap else 0.0
        slack.append((available(item.due_date) - need_days, item.due_date, item.product))

    return [item for _key, item in sorted(zip(slack, ordered), key=lambda pair: pair[0])]


def _assign_to_machines(
    *,
    product: str,
    lot_remaining: float,
    machines: list[MachineSlot],
    machine_today: dict[str, list],
    line_remaining: float,
    product_cap_left: float | None,
    input_unit: float | None,
    a_shift_only_switch: bool,
    a_shift_fraction: float,
    continuing: bool,
    day: date,
    order_id: str,
    allocation: list[DailyCell],
    deferrals: dict[str, list[date]],
) -> float:
    """1ロットぶんを、その機種が使える空き号機へ載せる。載せた合計台数を返す。

    号機の選び方は「既に同じ機種が載っている号機 → 終日空いている号機 → 別機種が
    使っている号機」の順。最後のケースだけが日中の段取り替えで、A勤限定制約の対象。
    終日空いている号機は朝(A勤)に段取りできるので、いつでも立ち上げられる
    (これが現場のTA1計画に毎日3〜5機種が並ぶ理由)。
    `△`(条件付き)の号機は ○ をすべて使い切ってから回す。
    """
    remaining = lot_remaining
    taken = 0.0
    deferred = False

    def rank(slot: MachineSlot) -> tuple:
        state = machine_today[slot.machine_id]
        same = state[0] == product
        free = state[0] is None
        conditional = slot.eligibility.get(product) == "△"
        # 継続 > 空き > 奪取、その中では条件付きを後回し、能力の大きい号機を先に
        return (0 if same else 1 if free else 2, 1 if conditional else 0, -slot.daily_capacity)

    for slot in sorted(
        (m for m in machines if m.can_run(product)), key=rank
    ):
        if remaining <= 0 or line_remaining - taken <= 0:
            break
        if product_cap_left is not None and product_cap_left - taken <= 0:
            break
        state = machine_today[slot.machine_id]
        free_on_machine = slot.daily_capacity - state[1]
        if free_on_machine <= 0:
            continue

        if state[0] is not None and state[0] != product:
            # 稼働中の号機を奪う = 日中の段取り替え。A勤を過ぎていたら翌朝へ。
            if a_shift_only_switch and not continuing:
                if state[1] / slot.daily_capacity > a_shift_fraction:
                    deferred = True
                    continue

        room = min(remaining, free_on_machine, line_remaining - taken)
        if product_cap_left is not None:
            room = min(room, product_cap_left - taken)
        # 投入単位(リール等)の倍数へ切り下げ。残が1単位未満のときだけ端数を許す。
        if input_unit and remaining >= input_unit:
            room = int(room // input_unit) * input_unit
        if room <= 0:
            continue

        allocation.append(
            DailyCell(day=day, product=product, quantity=room, order_id=order_id,
                      machine_id=slot.machine_id)
        )
        state[0] = product
        state[1] += room
        remaining -= room
        taken += room

    if taken <= 0 and deferred:
        _record_deferral(deferrals, product, day)
    return taken


def allocate_bottleneck(
    demands: list[DemandItem],
    working_days: list[date],
    daily_capacity: float,
    a_shift_only_switch: bool = False,
    a_shift_fraction: float = 0.5,
    product_daily_caps: dict[str, float] | None = None,
    daily_capacity_by_day: dict[date, float] | None = None,
    input_unit: float | None = None,
    product_daily_caps_by_day: dict[date, dict[str, float]] | None = None,
    machines: list[MachineSlot] | None = None,
) -> tuple[list[DailyCell], dict[str, date], list[str]]:
    """ボトルネック工程の日次能力を上限に、機種別台数を稼働日へ割り付ける。

    `daily_capacity_by_day` を渡すと、該当日はその値をライン日次能力として使う
    (設備停止マスタによる能力補正)。

    `machines`(CAP表の号機マスタ)を渡すと **号機単位で割り付ける**。どの号機が空いて
    いるかで同日に並行できる機種数が決まるため、機種別キャパだけの近似より現場の
    TA1_生産計画に近い形になる。この場合の切替判定は号機ごと(下記)。

    - 稼働日を1日ずつ埋めていく。各日はEDD(納期の早いロット)順に投入するため、
      機種ごとにまとまったキャンペーンが自然に形成される。
    - 各稼働日の投入合計は daily_capacity(ライン日次能力)を超えない。
    - `product_daily_caps`({機種: 日産キャパ})を渡すと、機種ごとの日次投入もその
      キャパを超えない。キャパの小さい機種(例: Lite-S)が残したライン能力は、同日に
      別機種が別号機グループで並行して使う(現場のTA1_生産計画と同じ形)。
    - `a_shift_only_switch=True` のとき、機種切替(管理者が実施)はA勤中しかできない
      制約を反映する。**号機マスタがある場合**は号機ごとに判定する: その日まだ何も
      流していない号機は朝から段取りできるので新機種を立ち上げられる。既に別機種が
      流れている号機を奪う場合だけ、その号機の消化率が `a_shift_fraction` を超えて
      いたら翌稼働日の朝へ繰り下げる。**号機マスタが無い場合**はライン全体の
      機種別キャパ合計で「別号機グループが空いているか」を近似する。
      いずれも前日から続く機種は段取り済みなので対象外。
    戻り値: (割付セル一覧, 機種->投入完了日, 警告一覧)。
    """
    allocation: list[DailyCell] = []
    completion: dict[str, date] = {}
    warnings: list[str] = []

    queue = _sequence_lots(demands, working_days, product_daily_caps)
    lot_remaining = [item.quantity for item in queue]
    lot_completion: list[date | None] = [None] * len(queue)
    total_left = sum(lot_remaining)
    prev_day_products: set[str] = set()
    # A勤限定切替で開始を繰り下げた日を機種ごとにためる(警告は最後に1機種1行へ集約)
    deferrals: dict[str, list[date]] = {}

    for day in working_days:
        if total_left <= 0:
            break
        cap_today = (daily_capacity_by_day or {}).get(day, daily_capacity)
        if cap_today <= 0:
            prev_day_products = set()  # 全停止日: 生産なし(翌日は切替扱いで再開)
            continue
        line_remaining = cap_today
        # その日の機種別キャパ(一部の日だけシフト増強する場合は日別に上書き)
        caps_today = (product_daily_caps_by_day or {}).get(day, product_daily_caps)
        today_products: set[str] = set()
        product_used_today: dict[str, float] = {}
        blocked_today: set[str] = set()
        # 号機マスタがあるときの当日の号機状態: 号機 -> [載せた機種, 消化台数]
        machine_today: dict[str, list] = (
            {m.machine_id: [None, 0.0] for m in machines} if machines else {}
        )

        for i, item in enumerate(queue):
            if line_remaining <= 0:
                break
            if lot_remaining[i] <= 0:
                continue
            product = item.product
            if product in blocked_today:
                continue

            if machines is not None:
                take = _assign_to_machines(
                    product=product,
                    lot_remaining=lot_remaining[i],
                    machines=machines,
                    machine_today=machine_today,
                    line_remaining=line_remaining,
                    product_cap_left=(
                        None if caps_today is None or caps_today.get(product) is None
                        else caps_today[product] - product_used_today.get(product, 0.0)
                    ),
                    input_unit=input_unit,
                    a_shift_only_switch=a_shift_only_switch,
                    a_shift_fraction=a_shift_fraction,
                    continuing=product in prev_day_products,
                    day=day,
                    order_id=item.order_id,
                    allocation=allocation,
                    deferrals=deferrals,
                )
                if take <= 0:
                    continue
                lot_remaining[i] -= take
                line_remaining -= take
                total_left -= take
                product_used_today[product] = product_used_today.get(product, 0.0) + take
                today_products.add(product)
                if lot_remaining[i] <= 0:
                    lot_completion[i] = day
                    completion[product] = day
                continue

            if (
                a_shift_only_switch
                and product not in today_products
                and product not in prev_day_products
            ):
                # 号機グループの空きを見る。既に流している機種の機種別キャパ合計が
                # ライン能力に届かないなら、別の号機グループが終日空いている =
                # その機種の段取りは朝(A勤)から可能なので、A勤限定制約の対象外。
                # (キャパ未定義=ライン全体を使いうる機種として扱う → 従来どおり飽和扱い)
                if caps_today is None:
                    running_cap = cap_today if today_products else 0.0
                else:
                    running_cap = sum(
                        caps_today.get(p, cap_today) for p in today_products
                    )
                if running_cap >= cap_today:
                    # ラインは既に埋まっている → 新機種は稼働中の号機を奪う=段取り替え
                    used_fraction = 1.0 - line_remaining / cap_today
                    if used_fraction > a_shift_fraction:
                        blocked_today.add(product)
                        _record_deferral(deferrals, product, day)
                        continue

            available = line_remaining
            if caps_today is not None:
                cap = caps_today.get(product)
                if cap is not None:
                    available = min(available, cap - product_used_today.get(product, 0.0))
            if available <= 0:
                continue

            take = min(lot_remaining[i], available)
            # 投入単位(例: HALはリール1本=10,000)の倍数に切り下げる。
            # ロット残が1単位未満のときだけ端数投入を許す(機種の台数による調整)。
            if input_unit and lot_remaining[i] >= input_unit:
                take = int(take // input_unit) * input_unit
            if take <= 0:
                continue
            allocation.append(DailyCell(day=day, product=product, quantity=take, order_id=item.order_id))
            lot_remaining[i] -= take
            line_remaining -= take
            total_left -= take
            product_used_today[product] = product_used_today.get(product, 0.0) + take
            today_products.add(product)
            if lot_remaining[i] <= 0:
                lot_completion[i] = day
                completion[product] = day

        prev_day_products = today_products

    # A勤限定切替の繰り下げは機種ごとに1行へまとめる(日ごとに1行出すと警告欄が埋まるため)
    for product, deferred_days in deferrals.items():
        # 最後に見送った日以降で実際に立ち上がった日(見送り前の稼働は別キャンペーン)
        resumed = min(
            (c.day for c in allocation if c.product == product and c.day > deferred_days[-1]),
            default=None,
        )
        tail = (
            f"次に立ち上げたのは {resumed.isoformat()} です。" if resumed
            else "その後この期間内では立ち上げられませんでした。"
        )
        warnings.append(
            f"{product}: {A_SHIFT_DEFERRAL_TAG}のため "
            f"{deferred_days[0].isoformat()}〜{deferred_days[-1].isoformat()} の"
            f"計{len(deferred_days)}稼働日はその日の立ち上げを見送りました。{tail}"
        )

    # 期間内に投入しきれなかった機種
    leftover: dict[str, float] = {}
    for i, item in enumerate(queue):
        if lot_remaining[i] > 0:
            leftover[item.product] = leftover.get(item.product, 0.0) + lot_remaining[i]
    for product, qty in leftover.items():
        warnings.append(
            f"{product}: 稼働日({len(working_days)}日)の能力では投入しきれない台数が "
            f"{qty:.0f} 残りました。期間延長かシフト増強が必要です。"
        )

    # ボトルネック投入完了ベースの納期チェック(MILの製番別チェックは plan_bottleneck 側)
    warned_products: set[str] = set()
    for i, item in enumerate(queue):
        done = lot_completion[i]
        if done is not None and done > item.due_date and item.product not in warned_products:
            warned_products.add(item.product)
            warnings.append(
                f"{item.product}: ボトルネック投入完了({done.isoformat()})が "
                f"納期({item.due_date.isoformat()})を超過する見込みです。"
            )

    return allocation, completion, warnings


def expand_to_stages(
    bottleneck_allocation: list[DailyCell],
    working_days: list[date],
    stage_flows: list[StageFlowConfig],
    stage_days: list[date] | None = None,
) -> tuple[list[StageDailyCell], list[str]]:
    """ボトルネック(HAL)の日次配分を、各工程へ稼働日オフセットでずらして展開する。

    HALが成り立つように上流(ANT/TAL)を早め・下流(MIL)を後ろへ配置する。各工程の
    日次台数はHALの台数と同じで、投入/完成のタイミングだけがオフセット分だけずれる。

    `stage_days`(前後へ伸ばした稼働日軸。`extend_working_days` で作る)を渡すと、
    オフセットではみ出した投入/完成もその軸の上に置ける。渡さない場合は
    `working_days` の外へ出たセルは破棄し、数量を明示した警告を出す。
    工程の日次上限を超える場合も警告する。
    """
    axis = stage_days or working_days
    day_to_index = {d: i for i, d in enumerate(axis)}
    cells: list[StageDailyCell] = []
    warnings: list[str] = []
    # 期間外に出た台数を 工程 -> ("before"=期間前/"after"=期間後) -> 台数 で集計する。
    # 「期間前」は計画開始時点で既に前段WIPとして存在していなければならない量、
    # 「期間後」は翌期へ繰り越す量。どちらも数量が分からないと手当てできないので明示する。
    out_of_range: dict[str, dict[str, float]] = {}

    for flow in stage_flows:
        # まずオフセット適用済みの(日, 元セル)列を作る
        shifted: list[tuple[date, DailyCell]] = []
        for cell in bottleneck_allocation:
            target_i = day_to_index[cell.day] + flow.offset_for(cell.product)
            if target_i < 0 or target_i >= len(axis):
                side = "before" if target_i < 0 else "after"
                bucket = out_of_range.setdefault(flow.stage_id, {})
                bucket[side] = bucket.get(side, 0.0) + cell.quantity
                continue
            shifted.append((axis[target_i], cell))

        if not flow.input_unit:
            for day, cell in shifted:
                cells.append(
                    StageDailyCell(flow.stage_id, day, cell.product, cell.quantity, cell.order_id)
                )
            continue

        # 投入単位あり(例: TAL=40,000のまとめ投入): ロット(製番)ごとに単位の倍数へ
        # 前倒しでまとめ直す。下流(HAL)が枯れないよう累計は常に元の累計以上とし、
        # 端数(機種の台数による調整)はロット最終日に吸収する。
        unit = flow.input_unit
        by_lot: dict[str, list[tuple[date, DailyCell]]] = {}
        for day, cell in shifted:
            by_lot.setdefault(cell.order_id or cell.product, []).append((day, cell))
        for entries in by_lot.values():
            entries.sort(key=lambda e: e[0])
            total = sum(c.quantity for _d, c in entries)
            need = 0.0
            emitted = 0.0
            for idx, (day, cell) in enumerate(entries):
                need += cell.quantity
                if idx == len(entries) - 1:
                    target = total  # 最終投入で端数を吸収
                else:
                    target = min(-(-need // unit) * unit, total)  # 単位へ切り上げ(前倒し)
                qty = target - emitted
                if qty > 0:
                    cells.append(StageDailyCell(flow.stage_id, day, cell.product, qty, cell.order_id))
                    emitted = target

    for stage_id in sorted(out_of_range):
        before = out_of_range[stage_id].get("before", 0.0)
        after = out_of_range[stage_id].get("after", 0.0)
        parts = []
        if before:
            parts.append(f"期間開始前に {before:,.0f}台(計画開始時点で前段WIPとして必要)")
        if after:
            parts.append(f"期間終了後に {after:,.0f}台(翌期繰越)")
        warnings.append(
            f"工程{stage_id}: オフセット後の投入/完成が計画期間の外に出ます — "
            + "、".join(parts)
            + f"。この分は工程{stage_id}の行に表示されないため、材料手配には計上してください。"
        )

    # 工程別の日次上限チェック
    cap_by_stage = {f.stage_id: f.daily_capacity for f in stage_flows if f.daily_capacity}
    if cap_by_stage:
        totals: dict[tuple[str, date], float] = {}
        for c in cells:
            totals[(c.stage_id, c.day)] = totals.get((c.stage_id, c.day), 0.0) + c.quantity
        for (stage_id, day), total in sorted(totals.items()):
            cap = cap_by_stage.get(stage_id)
            if cap and total > cap + 1e-6:
                warnings.append(
                    f"工程{stage_id} {day.isoformat()}: 日次投入 {total:.0f} が能力 {cap:.0f} を超過しています。"
                )

    return cells, warnings


def mil_completion_by_order(
    stage_allocation: list[StageDailyCell],
    demands: list[DemandItem] | None = None,
    mil_stage_id: str = "MIL",
) -> list[MilLotCompletion]:
    """MIL工程の日次を製番(出荷ロット=注文)単位に集計し、完成日を出す(THM短期投入予定表の形)。

    キャンペーン投入で1製番のMILは連続するため、完成日=その製番のMIL最終日。
    demands を渡すと納期(due_date)と間に合うか(on_time)も付与する。
    """
    due_by_order: dict[str, date] = {}
    ship_by_order: dict[str, date] = {}
    if demands:
        due_by_order = {d.order_id: d.due_date for d in demands if d.order_id}
        ship_by_order = {d.order_id: d.ship_date for d in demands if d.order_id and d.ship_date}

    grouped: dict[str, dict] = {}
    for c in stage_allocation:
        if c.stage_id != mil_stage_id or not c.order_id:
            continue
        g = grouped.setdefault(c.order_id, {"product": c.product, "quantity": 0.0, "completion": c.day})
        g["quantity"] += c.quantity
        if c.day > g["completion"]:
            g["completion"] = c.day

    lots: list[MilLotCompletion] = []
    for order_id, g in grouped.items():
        due = due_by_order.get(order_id)
        on_time = (g["completion"] <= due) if due else None
        lots.append(
            MilLotCompletion(
                order_id=order_id,
                product=g["product"],
                quantity=g["quantity"],
                completion_day=g["completion"],
                due_date=due,
                on_time=on_time,
                ship_date=ship_by_order.get(order_id),
            )
        )
    lots.sort(key=lambda lot: (lot.completion_day, lot.order_id))
    return lots


@dataclass
class Remedy:
    """納期遅れの解消策(意思決定支援)。"""

    kind: str  # shift_escalation / min_high_days / bottleneck_product / horizon_extension / ok
    title: str
    detail: str


def _late_count(result: "BottleneckPlanResult") -> int:
    return sum(1 for lot in result.mil_lots if lot.on_time is False)


def suggest_remedies(
    demands: list[DemandItem],
    working_days: list[date],
    shift_capacities: dict[str, float],
    plan_kwargs: dict,
    base_result: "BottleneckPlanResult",
    high_mode: str = "22h",
) -> list[Remedy]:
    """現計画に納期遅れがあるとき、解消策を自動算出する(HAL#9シナリオ手作業の自動版)。

    - シフト昇格(全期間 high_mode)で遅れが何件解消するか。
    - 全納期を満たす最小の high_mode 稼働日数(先頭から)を二分探索で逆算。
    - それでも残る場合は律速機種の特定と必要な期間延長(稼働日数)を提示。
    plan_kwargs は base の plan_bottleneck に渡したキーワード引数一式(high_mode系を除く)。
    """
    late0 = _late_count(base_result)
    if late0 == 0:
        return [Remedy("ok", "納期遅れなし", "現計画で全ロットが納期内です。追加策は不要です。")]

    remedies: list[Remedy] = []
    base_mode = base_result.shift_mode
    caps_by_mode = plan_kwargs.get("product_caps_by_mode") or {}
    ndays = len(working_days)

    def plan_with(days: list[date], high_days: int) -> "BottleneckPlanResult":
        return plan_bottleneck(
            demands, days, shift_capacities, high_mode=high_mode, high_mode_days=high_days, **plan_kwargs
        )

    can_escalate = high_mode in shift_capacities and base_mode != high_mode

    if can_escalate:
        full = plan_with(working_days, ndays)
        late_full = _late_count(full)
        if late_full < late0:
            remedies.append(
                Remedy(
                    "shift_escalation",
                    f"全期間 {high_mode} に上げる",
                    f"納期遅れ {late0}件 → {late_full}件。"
                    + ("全ロット納期内になります。" if late_full == 0 else f"まだ{late_full}件残ります。"),
                )
            )
        if late_full == 0:
            # 全納期を満たす最小の high_mode 日数を二分探索(先頭からN日を high_mode)
            lo, hi, best = 1, ndays, ndays
            while lo <= hi:
                mid = (lo + hi) // 2
                if _late_count(plan_with(working_days, mid)) == 0:
                    best, hi = mid, mid - 1
                else:
                    lo = mid + 1
            remedies.append(
                Remedy(
                    "min_high_days",
                    f"{high_mode} を最短で何日やればよいか",
                    f"先頭 {best} 稼働日を {high_mode} にすれば全納期を満たせます"
                    f"(残り {ndays - best} 日は現行 {base_mode} のまま)。",
                )
            )
        else:
            # 全期間 high でも解消しない → 期間延長で解消するか探索
            cleared_extra: int | None = None
            for extra in range(1, 41):
                extended = working_days + working_days_in_range(
                    working_days[-1] + timedelta(days=1),
                    working_days[-1] + timedelta(days=extra * 2 + 10),
                )[:extra]
                if _late_count(plan_with(extended, len(extended))) == 0:
                    cleared_extra = extra
                    break
            if cleared_extra is not None:
                remedies.append(
                    Remedy(
                        "horizon_extension",
                        "期間延長が必要",
                        f"全期間 {high_mode} に加え、稼働日を {cleared_extra} 日延長すれば全納期を満たせます。",
                    )
                )
            else:
                remedies.append(
                    Remedy(
                        "due_date_infeasible",
                        "能力増強では取り戻せない遅れ",
                        f"全期間 {high_mode} ＋期間延長でも {late_full}件が残ります。"
                        f"これらは納期が計画開始付近で早く、シフト増強・期間延長では間に合いません。"
                        f"納期調整または着手の前倒しをご検討ください。",
                    )
                )
    else:
        remedies.append(
            Remedy(
                "shift_escalation",
                "シフト昇格の余地なし",
                f"すでに {base_mode} で立案しており、これ以上のシフト増強はできません。期間延長や設備増強を検討してください。",
            )
        )

    # 律速機種の特定: 需要 vs 機種別キャパ×稼働日
    base_caps = caps_by_mode.get(base_mode, {})
    high_caps = caps_by_mode.get(high_mode, {})
    per_product: dict[str, float] = {}
    for d in demands:
        per_product[d.product] = per_product.get(d.product, 0.0) + d.quantity
    binding: list[str] = []
    for product, qty in sorted(per_product.items(), key=lambda kv: -kv[1]):
        cap_b = base_caps.get(product)
        if cap_b and qty > cap_b * ndays:
            need = qty / cap_b
            cap_h = high_caps.get(product)
            hint = f"（{high_mode}でも {qty / cap_h:.0f}日必要）" if cap_h and qty > cap_h * ndays else ""
            binding.append(f"{product}: 需要{qty:.0f} > {base_mode}能力{cap_b:.0f}×{ndays}日。単独で約{need:.0f}稼働日必要{hint}")
    if binding:
        remedies.append(
            Remedy(
                "bottleneck_product",
                "律速となっている機種",
                " / ".join(binding),
            )
        )

    return remedies


def plan_bottleneck(
    demands: list[DemandItem],
    working_days: list[date],
    shift_capacities: dict[str, float],
    stage_flows: list[StageFlowConfig] | None = None,
    mil_stage_id: str = "MIL",
    a_shift_only_switch: bool = False,
    a_shift_fraction: float = 0.5,
    product_caps_by_mode: dict[str, dict[str, float]] | None = None,
    equipment_stops: list[EquipmentStop] | None = None,
    bottleneck_stage: str = "HAL",
    machine_counts: dict[str, int] | None = None,
    high_mode: str | None = None,
    high_mode_days: int = 0,
    holidays: set[date] | None = None,
    machines_by_mode: dict[str, list[MachineSlot]] | None = None,
) -> BottleneckPlanResult:
    """Step 1(シフト/レート決定)＋Step 2(HAL日次配分)を実行する。

    stage_flows を渡すと、HAL配分を各工程(ANT/TAL/HAL/MIL)へオフセット展開し(Step 3)、
    MIL工程を製番別に集計して完成日を出す(Step 4)。
    a_shift_only_switch はTAL/MILの機種切替がA勤限定である制約(allocate_bottleneck参照)。
    product_caps_by_mode({モード: {機種: 日産キャパ}})を渡すと、機種×設備の生産可否を
    織り込んだ機種別キャパで配分を制限し、キャパ定義の無い機種(=生産可能な設備が無い)は
    警告して計画から除外する。シフトモード選択も機種別の実現性を確認する。
    high_mode/high_mode_days を渡すと、先頭 high_mode_days 稼働日だけ high_mode(例 "22h")の
    能力・機種別キャパを使う(納期遅れ解消の「22Hを◯日」検討用)。
    holidays は working_days を作ったときの非稼働日。工程展開の表示軸(`stage_days`)を
    計画期間の前後へ伸ばすときに、同じカレンダーで稼働日を数えるために使う。
    machines_by_mode({モード: [MachineSlot]}, CAP表由来)を渡すと、選択したモードの
    ボトルネック工程の号機で号機単位に割り付ける(同日に並行できる機種数が号機の
    空きで決まる)。
    """
    pre_warnings: list[str] = []

    # 号機マスタがあるときは、機種別キャパを「その機種が使えるボトルネック号機の能力
    # 合計」で上から抑える。CAP表の 機種別キャパ 列が号機の実態より大きいままだと、
    # 実際には出せない日産を前提にスラック(所要日数)を見積もってしまい、その機種の
    # 着手が遅れる。逆に列のほうが小さい場合(人員などの追加制約)はその値を尊重する。
    cap_shortfalls: dict[str, dict[str, tuple[float, float]]] = {}
    if machines_by_mode and product_caps_by_mode:
        clamped: dict[str, dict[str, float]] = {}
        for mode, mode_caps in product_caps_by_mode.items():
            stage_machines = [
                m for m in machines_by_mode.get(mode, []) if m.stage_id == bottleneck_stage
            ]
            if not stage_machines:
                clamped[mode] = dict(mode_caps)
                continue
            new_caps: dict[str, float] = {}
            for product, stated in mode_caps.items():
                usable = sum(m.daily_capacity for m in stage_machines if m.can_run(product))
                new_caps[product] = min(stated, usable) if usable else stated
                if usable and usable + 1e-6 < stated:
                    cap_shortfalls.setdefault(mode, {})[product] = (stated, usable)
            clamped[mode] = new_caps
        product_caps_by_mode = clamped

    if product_caps_by_mode:
        producible = {
            product
            for mode_caps in product_caps_by_mode.values()
            for product, cap in mode_caps.items()
            if cap
        }
        infeasible = sorted({d.product for d in demands} - producible)
        for product in infeasible:
            qty = sum(d.quantity for d in demands if d.product == product)
            pre_warnings.append(
                f"{product}: 生産可能な設備(機種別キャパ)が定義されていないため、"
                f"{qty:.0f}台を計画から除外しました。設備条件マスタを確認してください。"
            )
        demands = [d for d in demands if d.product in producible]

    total = sum(d.quantity for d in demands)
    product_demands: dict[str, float] = {}
    for d in demands:
        product_demands[d.product] = product_demands.get(d.product, 0.0) + d.quantity
    shift_mode, daily_capacity, required = choose_shift_mode(
        total,
        len(working_days),
        shift_capacities,
        product_demands=product_demands or None,
        product_caps_by_mode=product_caps_by_mode,
        required_rate=(
            required_daily_rate(demands, working_days, max_rate=max(shift_capacities.values()))
            if demands and shift_capacities
            else None
        ),
    )

    result = BottleneckPlanResult(
        shift_mode=shift_mode,
        daily_capacity=daily_capacity,
        required_daily_rate=required,
        working_days=working_days,
    )
    result.warnings.extend(pre_warnings)
    if required > daily_capacity:
        result.warnings.append(
            f"必要日次レート({required:.0f}/日)が最大シフト能力({daily_capacity:.0f}/日)を超えています。"
            f"稼働日追加・設備増強を検討してください。"
        )

    # 設備停止マスタをボトルネック日次能力へ反映(選択したシフトモードの時間長で控除)
    day_caps: dict[date, float] | None = None
    if equipment_stops:
        digits = "".join(ch for ch in shift_mode if ch.isdigit())
        daily_hours = float(digits) if digits else 16.0
        day_caps, stop_warnings = apply_equipment_stops(
            working_days,
            daily_capacity,
            equipment_stops,
            bottleneck_stage=bottleneck_stage,
            machine_counts=machine_counts,
            daily_hours=daily_hours,
        )
        result.warnings.extend(stop_warnings)

    # 先頭 N 稼働日だけ high_mode(例 22h)に増強する日別上書き(納期遅れ解消の検討用)
    caps_by_day: dict[date, float] | None = day_caps
    pcaps_by_day: dict[date, dict[str, float]] | None = None
    if high_mode and high_mode_days > 0 and high_mode in shift_capacities and high_mode != shift_mode:
        high_days = working_days[: min(high_mode_days, len(working_days))]
        high_cap = shift_capacities[high_mode]
        merged = dict(day_caps or {})
        for d in high_days:
            merged.setdefault(d, high_cap)  # 設備停止で下げた日は据え置き
        caps_by_day = merged
        high_pcaps = (product_caps_by_mode or {}).get(high_mode)
        if high_pcaps:
            pcaps_by_day = {d: high_pcaps for d in high_days}

    # 機種別キャパを号機能力まで抑えた件は、実際に選ばれたモードのぶんだけ知らせる
    demanded = {d.product for d in demands}
    for product, (stated, usable) in sorted(cap_shortfalls.get(shift_mode, {}).items()):
        if product not in demanded:
            continue
        result.warnings.append(
            f"{product}: CAP表の機種別キャパ {stated:,.0f}/日({shift_mode})は、稼働号機で"
            f"{bottleneck_stage}に使える能力 {usable:,.0f}/日 を超えています"
            f"(差 {stated - usable:,.0f})。出せる {usable:,.0f}/日 で計画しました。"
            f"機種別キャパ列か、機種×号機の可否(○/×)のどちらかが実態と合っていないので"
            f"確認してください。"
        )

    allocation, completion, warnings = allocate_bottleneck(
        demands,
        working_days,
        daily_capacity,
        a_shift_only_switch=a_shift_only_switch,
        a_shift_fraction=a_shift_fraction,
        product_daily_caps=(product_caps_by_mode or {}).get(shift_mode),
        daily_capacity_by_day=caps_by_day,
        input_unit=next(
            (f.input_unit for f in (stage_flows or []) if f.stage_id == bottleneck_stage), None
        ),
        product_daily_caps_by_day=pcaps_by_day,
        machines=(
            [
                m for m in (machines_by_mode or {}).get(shift_mode, [])
                if m.stage_id == bottleneck_stage
            ]
            or None
        ),
    )
    result.allocation = allocation
    result.completion = completion
    result.warnings.extend(warnings)

    if stage_flows:
        # 工程展開はオフセットで前後にはみ出すので、表示軸を伸ばして受け止める
        lead, trail = stage_offset_span(stage_flows)
        result.stage_days = extend_working_days(working_days, lead, trail, holidays)
        stage_cells, stage_warnings = expand_to_stages(
            allocation, working_days, stage_flows, stage_days=result.stage_days
        )
        result.stage_allocation = stage_cells
        result.warnings.extend(stage_warnings)

        if any(f.stage_id == mil_stage_id for f in stage_flows):
            result.mil_lots = mil_completion_by_order(stage_cells, demands, mil_stage_id)
            # 遅れロットは遅れ日数の大きい順。全件は 製番別MIL シート/表で追えるので、
            # 警告欄には上位だけ出し、残りは1行にまとめる(数十行あると他が読めない)。
            late = sorted(
                (lot for lot in result.mil_lots if lot.on_time is False),
                key=lambda lot: (lot.completion_day - lot.due_date).days,
                reverse=True,
            )
            head, rest = late[:_LATE_WARNING_LIMIT], late[_LATE_WARNING_LIMIT:]
            for lot in head:
                result.warnings.append(
                    f"製番{lot.order_id}({lot.product}): MIL完成予定 {lot.completion_day.isoformat()} が "
                    f"完成目標 {lot.due_date.isoformat()} を "
                    f"{(lot.completion_day - lot.due_date).days}日 超過します。"
                )
            if rest:
                result.warnings.append(
                    f"完成目標を超過する製番は他に {len(rest)}件 あります"
                    f"(合計 {sum(l.quantity for l in late):,.0f}台)。全件は製番別MILの表で確認してください。"
                )

    # 段取り(切替)キャンペーン: 工程展開があれば全工程、無ければボトルネック工程のみ。
    if result.stage_allocation:
        result.campaigns = derive_campaigns(
            result.stage_allocation,
            result.stage_days or working_days,  # 期間外へ伸びた工程日も連続性の判定に含める
            stage_order=[f.stage_id for f in stage_flows],
        )
    else:
        base_cells = [
            StageDailyCell(bottleneck_stage, c.day, c.product, c.quantity, c.order_id)
            for c in allocation
        ]
        result.campaigns = derive_campaigns(base_cells, working_days, stage_order=[bottleneck_stage])

    return result

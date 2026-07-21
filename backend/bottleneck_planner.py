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


@dataclass
class DemandItem:
    """一定期間に生産すべき機種と数量・納期。"""

    product: str
    quantity: float
    due_date: date
    order_id: str = ""


@dataclass
class StageFlowConfig:
    """ボトルネック(HAL)基準で各工程をどれだけずらして流すかの設定。

    lead_offset_days は稼働日数のオフセット。上流(ANT/TAL)は負(HALより早く投入)、
    ボトルネック自身は0、下流(MIL)は正(HALより後で完成)。
    daily_capacity を与えると、その工程の日次合計が超過した日に警告を出す。
    """

    stage_id: str
    lead_offset_days: int
    daily_capacity: float | None = None


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
    """MIL(最終工程)を製番(出荷ロット)単位で見た完成日と納期充足。"""

    order_id: str
    product: str
    quantity: float
    completion_day: date
    due_date: date | None = None
    on_time: bool | None = None


@dataclass
class DailyCell:
    """ある稼働日・ある機種にボトルネック工程で投入する台数。"""

    day: date
    product: str
    quantity: float
    order_id: str = ""


@dataclass
class BottleneckPlanResult:
    shift_mode: str
    daily_capacity: float
    required_daily_rate: float
    working_days: list[date]
    allocation: list[DailyCell] = field(default_factory=list)  # ボトルネック(HAL)の日次配分
    completion: dict[str, date] = field(default_factory=dict)  # 機種 -> 投入完了日
    stage_allocation: list[StageDailyCell] = field(default_factory=list)  # 全工程(ANT/TAL/HAL/MIL)の日次
    mil_lots: list[MilLotCompletion] = field(default_factory=list)  # MILの製番別完成日
    warnings: list[str] = field(default_factory=list)


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


def choose_shift_mode(
    total_demand: float,
    num_working_days: int,
    capacities: dict[str, float],
    product_demands: dict[str, float] | None = None,
    product_caps_by_mode: dict[str, dict[str, float]] | None = None,
) -> tuple[str, float, float]:
    """必要日次レートを賄える最小のシフトモードを選ぶ。

    capacities は {シフトモード名: 日次能力}(例 {"16h": 90000, "22h": 120000})。
    product_demands と product_caps_by_mode({モード: {機種: 日産キャパ}})を渡すと、
    ライン合計だけでなく **機種別にも期間内に作り切れるか** を確認する
    (例: Lite-Sだけ需要が大きい月は、合計では16Hで足りても22Hへ上げる)。
    どのモードでも足りない場合は最大能力のモードを返す(呼び出し側で警告)。
    戻り値: (シフトモード, 日次能力, 必要日次レート)。
    """
    if num_working_days <= 0:
        raise ValueError("稼働日が0日です。期間・カレンダーを確認してください。")
    required = total_demand / num_working_days
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

    for d in demands:
        done = actuals.get(d.order_id, 0.0)
        if d.order_id in actuals:
            matched.add(d.order_id)
        if done <= 0:
            adjusted.append(d)
            continue
        rest = d.quantity - done
        if rest <= 0:
            warnings.append(
                f"製番{d.order_id}({d.product}): 実績{done:.0f}で計画数{d.quantity:.0f}を満たしたため計画から除外しました。"
            )
            continue
        adjusted.append(DemandItem(product=d.product, quantity=rest, due_date=d.due_date, order_id=d.order_id))

    for seiban in sorted(set(actuals) - matched):
        warnings.append(f"実績の製番{seiban}が台帳の対象受注に見つかりません(製番・対象期間を確認してください)。")

    return adjusted, warnings


def allocate_bottleneck(
    demands: list[DemandItem],
    working_days: list[date],
    daily_capacity: float,
    a_shift_only_switch: bool = False,
    a_shift_fraction: float = 0.5,
    product_daily_caps: dict[str, float] | None = None,
    daily_capacity_by_day: dict[date, float] | None = None,
) -> tuple[list[DailyCell], dict[str, date], list[str]]:
    """ボトルネック工程の日次能力を上限に、機種別台数を稼働日へ割り付ける。

    `daily_capacity_by_day` を渡すと、該当日はその値をライン日次能力として使う
    (設備停止マスタによる能力補正)。

    - 稼働日を1日ずつ埋めていく。各日はEDD(納期の早いロット)順に投入するため、
      機種ごとにまとまったキャンペーンが自然に形成される。
    - 各稼働日の投入合計は daily_capacity(ライン日次能力)を超えない。
    - `product_daily_caps`({機種: 日産キャパ})を渡すと、機種ごとの日次投入もその
      キャパを超えない。キャパの小さい機種(例: Lite-S)が残したライン能力は、同日に
      別機種が別号機グループで並行して使う(現場のTA1_生産計画と同じ形)。
    - `a_shift_only_switch=True` のとき、機種切替(管理者が実施)はA勤中しかできない
      制約を反映する: **前稼働日から継続していない機種** がその日に新規に立ち上がる
      場合、その時点までのライン消化率が `a_shift_fraction`(既定=日能力の半分=A勤相当)
      を超えていたら開始を翌稼働日の朝(A勤)へ繰り下げる。前日から続く機種は号機の
      段取りが済んでいるため対象外。工程展開は稼働日単位のオフセットなので、この
      境界はTAL/MILにも同じ位置で伝播する。
    戻り値: (割付セル一覧, 機種->投入完了日, 警告一覧)。
    """
    allocation: list[DailyCell] = []
    completion: dict[str, date] = {}
    warnings: list[str] = []

    queue = sorted(demands, key=lambda d: (d.due_date, d.product))
    lot_remaining = [item.quantity for item in queue]
    lot_completion: list[date | None] = [None] * len(queue)
    total_left = sum(lot_remaining)
    prev_day_products: set[str] = set()

    for day in working_days:
        if total_left <= 0:
            break
        cap_today = (daily_capacity_by_day or {}).get(day, daily_capacity)
        if cap_today <= 0:
            prev_day_products = set()  # 全停止日: 生産なし(翌日は切替扱いで再開)
            continue
        line_remaining = cap_today
        today_products: set[str] = set()
        product_used_today: dict[str, float] = {}
        blocked_today: set[str] = set()

        for i, item in enumerate(queue):
            if line_remaining <= 0:
                break
            if lot_remaining[i] <= 0:
                continue
            product = item.product
            if product in blocked_today:
                continue

            if (
                a_shift_only_switch
                and product not in today_products
                and product not in prev_day_products
            ):
                used_fraction = 1.0 - line_remaining / cap_today
                if used_fraction > a_shift_fraction:
                    blocked_today.add(product)
                    warnings.append(
                        f"{product}: 機種切替(管理者作業)はA勤のみのため、"
                        f"{day.isoformat()}中の切替を避け翌稼働日の朝に開始します。"
                    )
                    continue

            available = line_remaining
            if product_daily_caps is not None:
                cap = product_daily_caps.get(product)
                if cap is not None:
                    available = min(available, cap - product_used_today.get(product, 0.0))
            if available <= 0:
                continue

            take = min(lot_remaining[i], available)
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
) -> tuple[list[StageDailyCell], list[str]]:
    """ボトルネック(HAL)の日次配分を、各工程へ稼働日オフセットでずらして展開する。

    HALが成り立つように上流(ANT/TAL)を早め・下流(MIL)を後ろへ配置する。各工程の
    日次台数はHALの台数と同じで、投入/完成のタイミングだけがオフセット分だけずれる。
    オフセットが計画期間の外へ出る場合や、工程の日次上限を超える場合は警告する。
    """
    day_to_index = {d: i for i, d in enumerate(working_days)}
    cells: list[StageDailyCell] = []
    warnings: list[str] = []
    out_of_range: set[str] = set()

    for flow in stage_flows:
        for cell in bottleneck_allocation:
            base_i = day_to_index[cell.day]
            target_i = base_i + flow.lead_offset_days
            if target_i < 0 or target_i >= len(working_days):
                out_of_range.add(flow.stage_id)
                continue
            cells.append(
                StageDailyCell(
                    stage_id=flow.stage_id,
                    day=working_days[target_i],
                    product=cell.product,
                    quantity=cell.quantity,
                    order_id=cell.order_id,
                )
            )

    for stage_id in sorted(out_of_range):
        warnings.append(
            f"工程{stage_id}: オフセット後の投入/完成が計画期間の外に出る台数があります。"
            f"期間を広げるか前段WIPで吸収してください。"
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
    if demands:
        due_by_order = {d.order_id: d.due_date for d in demands if d.order_id}

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
            )
        )
    lots.sort(key=lambda lot: (lot.completion_day, lot.order_id))
    return lots


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
) -> BottleneckPlanResult:
    """Step 1(シフト/レート決定)＋Step 2(HAL日次配分)を実行する。

    stage_flows を渡すと、HAL配分を各工程(ANT/TAL/HAL/MIL)へオフセット展開し(Step 3)、
    MIL工程を製番別に集計して完成日を出す(Step 4)。
    a_shift_only_switch はTAL/MILの機種切替がA勤限定である制約(allocate_bottleneck参照)。
    product_caps_by_mode({モード: {機種: 日産キャパ}})を渡すと、機種×設備の生産可否を
    織り込んだ機種別キャパで配分を制限し、キャパ定義の無い機種(=生産可能な設備が無い)は
    警告して計画から除外する。シフトモード選択も機種別の実現性を確認する。
    """
    pre_warnings: list[str] = []
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

    allocation, completion, warnings = allocate_bottleneck(
        demands,
        working_days,
        daily_capacity,
        a_shift_only_switch=a_shift_only_switch,
        a_shift_fraction=a_shift_fraction,
        product_daily_caps=(product_caps_by_mode or {}).get(shift_mode),
        daily_capacity_by_day=day_caps,
    )
    result.allocation = allocation
    result.completion = completion
    result.warnings.extend(warnings)

    if stage_flows:
        stage_cells, stage_warnings = expand_to_stages(allocation, working_days, stage_flows)
        result.stage_allocation = stage_cells
        result.warnings.extend(stage_warnings)

        if any(f.stage_id == mil_stage_id for f in stage_flows):
            result.mil_lots = mil_completion_by_order(stage_cells, demands, mil_stage_id)
            late = [lot for lot in result.mil_lots if lot.on_time is False]
            for lot in late:
                result.warnings.append(
                    f"製番{lot.order_id}({lot.product}): MIL完成予定 {lot.completion_day.isoformat()} が "
                    f"納期 {lot.due_date.isoformat()} を超過します。"
                )

    return result

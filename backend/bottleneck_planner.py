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
) -> tuple[str, float, float]:
    """必要日次レートを賄える最小のシフトモードを選ぶ。

    capacities は {シフトモード名: 日次能力}(例 {"16h": 90000, "22h": 120000})。
    どのモードでも足りない場合は最大能力のモードを返す(呼び出し側で警告)。
    戻り値: (シフトモード, 日次能力, 必要日次レート)。
    """
    if num_working_days <= 0:
        raise ValueError("稼働日が0日です。期間・カレンダーを確認してください。")
    required = total_demand / num_working_days
    for mode, cap in sorted(capacities.items(), key=lambda kv: kv[1]):
        if cap >= required:
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
) -> tuple[list[DailyCell], dict[str, date], list[str]]:
    """ボトルネック工程の日次能力を上限に、機種別台数を稼働日へ割り付ける。

    - 納期の早い機種から順(EDD)に処理する。
    - 切替を減らすため、1機種を投入し切ってから次の機種に移る(キャンペーン投入)。
    - 各稼働日の投入合計は daily_capacity を超えない。
    - `a_shift_only_switch=True` のとき、機種切替(管理者が実施)はA勤中しかできない制約を
      反映する: 前の機種がその日の `a_shift_fraction`(既定=日能力の半分=A勤相当)より後に
      終わる場合、次の機種の開始を翌稼働日の朝(A勤)へ繰り下げる。工程展開は稼働日単位の
      オフセットなので、この境界はTAL/MILにも同じ位置で伝播する。
    戻り値: (割付セル一覧, 機種->投入完了日, 警告一覧)。
    """
    allocation: list[DailyCell] = []
    completion: dict[str, date] = {}
    warnings: list[str] = []

    queue = sorted(demands, key=lambda d: (d.due_date, d.product))
    day_idx = 0
    day_remaining = daily_capacity
    last_product: str | None = None

    for item in queue:
        remaining = item.quantity
        while remaining > 0:
            if day_idx >= len(working_days):
                warnings.append(
                    f"{item.product}: 稼働日({len(working_days)}日)の能力では投入しきれない台数が "
                    f"{remaining:.0f} 残りました。期間延長かシフト増強が必要です。"
                )
                break
            if day_remaining <= 0:
                day_idx += 1
                day_remaining = daily_capacity
                continue
            if (
                a_shift_only_switch
                and last_product is not None
                and item.product != last_product
                and day_remaining < daily_capacity
            ):
                used_fraction = 1.0 - day_remaining / daily_capacity
                if used_fraction > a_shift_fraction:
                    warnings.append(
                        f"{item.product}: 機種切替(管理者作業)はA勤のみのため、"
                        f"{working_days[day_idx].isoformat()}中の切替を避け翌稼働日の朝に開始します。"
                    )
                    day_idx += 1
                    day_remaining = daily_capacity
                    continue
            take = min(remaining, day_remaining)
            allocation.append(
                DailyCell(day=working_days[day_idx], product=item.product, quantity=take, order_id=item.order_id)
            )
            remaining -= take
            day_remaining -= take
            last_product = item.product
            if remaining <= 0:
                completion[item.product] = working_days[day_idx]

        if item.product in completion and completion[item.product] > item.due_date:
            warnings.append(
                f"{item.product}: ボトルネック投入完了({completion[item.product].isoformat()})が "
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
) -> BottleneckPlanResult:
    """Step 1(シフト/レート決定)＋Step 2(HAL日次配分)を実行する。

    stage_flows を渡すと、HAL配分を各工程(ANT/TAL/HAL/MIL)へオフセット展開し(Step 3)、
    MIL工程を製番別に集計して完成日を出す(Step 4)。
    a_shift_only_switch はTAL/MILの機種切替がA勤限定である制約(allocate_bottleneck参照)。
    """
    total = sum(d.quantity for d in demands)
    shift_mode, daily_capacity, required = choose_shift_mode(total, len(working_days), shift_capacities)

    result = BottleneckPlanResult(
        shift_mode=shift_mode,
        daily_capacity=daily_capacity,
        required_daily_rate=required,
        working_days=working_days,
    )
    if required > daily_capacity:
        result.warnings.append(
            f"必要日次レート({required:.0f}/日)が最大シフト能力({daily_capacity:.0f}/日)を超えています。"
            f"稼働日追加・設備増強を検討してください。"
        )

    allocation, completion, warnings = allocate_bottleneck(
        demands,
        working_days,
        daily_capacity,
        a_shift_only_switch=a_shift_only_switch,
        a_shift_fraction=a_shift_fraction,
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

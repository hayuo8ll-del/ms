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


@dataclass
class DailyCell:
    """ある稼働日・ある機種にボトルネック工程で投入する台数。"""

    day: date
    product: str
    quantity: float


@dataclass
class BottleneckPlanResult:
    shift_mode: str
    daily_capacity: float
    required_daily_rate: float
    working_days: list[date]
    allocation: list[DailyCell] = field(default_factory=list)
    completion: dict[str, date] = field(default_factory=dict)  # 機種 -> 投入完了日
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


def allocate_bottleneck(
    demands: list[DemandItem],
    working_days: list[date],
    daily_capacity: float,
) -> tuple[list[DailyCell], dict[str, date], list[str]]:
    """ボトルネック工程の日次能力を上限に、機種別台数を稼働日へ割り付ける。

    - 納期の早い機種から順(EDD)に処理する。
    - 切替を減らすため、1機種を投入し切ってから次の機種に移る(キャンペーン投入)。
    - 各稼働日の投入合計は daily_capacity を超えない。
    戻り値: (割付セル一覧, 機種->投入完了日, 警告一覧)。
    """
    allocation: list[DailyCell] = []
    completion: dict[str, date] = {}
    warnings: list[str] = []

    queue = sorted(demands, key=lambda d: (d.due_date, d.product))
    day_idx = 0
    day_remaining = daily_capacity

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
            take = min(remaining, day_remaining)
            allocation.append(DailyCell(day=working_days[day_idx], product=item.product, quantity=take))
            remaining -= take
            day_remaining -= take
            if remaining <= 0:
                completion[item.product] = working_days[day_idx]

        if item.product in completion and completion[item.product] > item.due_date:
            warnings.append(
                f"{item.product}: ボトルネック投入完了({completion[item.product].isoformat()})が "
                f"納期({item.due_date.isoformat()})を超過する見込みです。"
            )

    return allocation, completion, warnings


def plan_bottleneck(
    demands: list[DemandItem],
    working_days: list[date],
    shift_capacities: dict[str, float],
) -> BottleneckPlanResult:
    """Step 1(シフト/レート決定)＋Step 2(HAL日次配分)を実行する。"""
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

    allocation, completion, warnings = allocate_bottleneck(demands, working_days, daily_capacity)
    result.allocation = allocation
    result.completion = completion
    result.warnings.extend(warnings)
    return result

"""生産計画の自動立案エンジン。

有限能力（工程ごとの日次稼働時間）を前提に、納期の早い受注から順に
（EDD: Earliest Due Date）各工程へ時間を割り付けていく前進スケジューリング。
定時能力を使い切った分は残業枠に割り付け、コストを積み上げる。

CI ではこのファイルを直接 `python3 scheduler.py` で実行し、
サンプルデータで例外なく立案できることをスモークテストしている。
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from models import (
    DailyAllocation,
    Order,
    OrderSchedule,
    PlanResult,
    PlanSummary,
    StepSchedule,
    WorkCenter,
)

_EPSILON = 1e-9


def _is_business_day(day: date) -> bool:
    return day.weekday() < 5


def _next_business_day(day: date) -> date:
    day += timedelta(days=1)
    while not _is_business_day(day):
        day += timedelta(days=1)
    return day


def _first_business_day_on_or_after(day: date) -> date:
    while not _is_business_day(day):
        day += timedelta(days=1)
    return day


class Scheduler:
    """工程の空き能力を管理しながら受注群を前進スケジューリングする。"""

    def __init__(self, work_centers: list[WorkCenter]):
        self.work_centers: dict[str, WorkCenter] = {wc.process_id: wc for wc in work_centers}
        # (process_id, day) -> [regular_used, overtime_used]
        self._usage: dict[tuple[str, date], list[float]] = defaultdict(lambda: [0.0, 0.0])

    def _available_capacity(self, process_id: str, day: date) -> tuple[float, float]:
        wc = self.work_centers[process_id]
        used_regular, used_overtime = self._usage[(process_id, day)]
        return (
            max(wc.daily_regular_hours - used_regular, 0.0),
            max(wc.daily_overtime_hours - used_overtime, 0.0),
        )

    def _consume(self, process_id: str, day: date, regular: float, overtime: float) -> None:
        usage = self._usage[(process_id, day)]
        usage[0] += regular
        usage[1] += overtime

    def _schedule_step(self, process_id: str, hours_needed: float, earliest_start: date) -> StepSchedule:
        if process_id not in self.work_centers:
            raise ValueError(f"未定義の工程です: {process_id}")

        wc = self.work_centers[process_id]
        day = _first_business_day_on_or_after(earliest_start)
        remaining = hours_needed
        allocations: list[DailyAllocation] = []
        total_regular = 0.0
        total_overtime = 0.0
        cost = 0.0

        # 割り付ける時間が0（工程スキップ相当）でも安全に終了する
        while remaining > _EPSILON:
            reg_avail, ot_avail = self._available_capacity(process_id, day)
            reg_use = min(remaining, reg_avail)
            remaining -= reg_use

            ot_use = 0.0
            if remaining > _EPSILON:
                ot_use = min(remaining, ot_avail)
                remaining -= ot_use

            if reg_use > _EPSILON or ot_use > _EPSILON:
                self._consume(process_id, day, reg_use, ot_use)
                allocations.append(DailyAllocation(day, round(reg_use, 4), round(ot_use, 4)))
                total_regular += reg_use
                total_overtime += ot_use
                cost += reg_use * wc.regular_cost_per_hour + ot_use * wc.overtime_cost_per_hour

            if remaining > _EPSILON:
                day = _next_business_day(day)

        start_date = allocations[0].day if allocations else earliest_start
        end_date = allocations[-1].day if allocations else earliest_start
        return StepSchedule(
            process_id=process_id,
            start_date=start_date,
            end_date=end_date,
            allocations=allocations,
            regular_hours=round(total_regular, 4),
            overtime_hours=round(total_overtime, 4),
            cost=round(cost, 4),
        )

    def plan(self, orders: list[Order], start_date: date) -> PlanResult:
        """納期優先(EDD) → 優先度 → 受注ID の順に前進スケジューリングする。"""
        ordered = sorted(orders, key=lambda o: (o.due_date, o.priority, o.order_id))
        order_schedules: list[OrderSchedule] = []

        for order in ordered:
            next_start = start_date
            step_schedules: list[StepSchedule] = []
            order_cost = 0.0

            for step in order.routing:
                hours_needed = step.hours_per_unit * order.quantity
                step_sched = self._schedule_step(step.process_id, hours_needed, next_start)
                step_schedules.append(step_sched)
                order_cost += step_sched.cost
                # 後工程は前工程が完了した翌営業日以降にしか着手できない
                next_start = _next_business_day(step_sched.end_date)

            completion_date = step_schedules[-1].end_date if step_schedules else start_date
            delay_days = max((completion_date - order.due_date).days, 0)

            order_schedules.append(
                OrderSchedule(
                    order_id=order.order_id,
                    product_name=order.product_name,
                    due_date=order.due_date,
                    completion_date=completion_date,
                    delay_days=delay_days,
                    steps=step_schedules,
                    total_cost=round(order_cost, 4),
                )
            )

        return PlanResult(orders=order_schedules, summary=self._summarize(order_schedules))

    @staticmethod
    def _summarize(order_schedules: list[OrderSchedule]) -> PlanSummary:
        total = len(order_schedules)
        delayed = sum(1 for o in order_schedules if o.delay_days > 0)
        total_cost = sum(o.total_cost for o in order_schedules)
        total_regular = sum(s.regular_hours for o in order_schedules for s in o.steps)
        total_overtime = sum(s.overtime_hours for o in order_schedules for s in o.steps)
        return PlanSummary(
            total_orders=total,
            on_time_orders=total - delayed,
            delayed_orders=delayed,
            total_cost=round(total_cost, 2),
            total_regular_hours=round(total_regular, 2),
            total_overtime_hours=round(total_overtime, 2),
        )


def _print_demo_result() -> None:
    from mock_data import sample_orders, sample_work_centers

    scheduler = Scheduler(sample_work_centers())
    result = scheduler.plan(sample_orders(), start_date=date.today())

    print("=== 生産計画 自動立案結果（サンプルデータ） ===")
    for order_sched in result.orders:
        status = "遅延" if order_sched.delay_days > 0 else "順調"
        print(
            f"[{status}] {order_sched.order_id} {order_sched.product_name}: "
            f"納期={order_sched.due_date} 完了予定={order_sched.completion_date} "
            f"遅延={order_sched.delay_days}日 コスト={order_sched.total_cost:.0f}円"
        )

    summary = result.summary
    print("---")
    print(f"受注数: {summary.total_orders} 件")
    print(f"納期遵守: {summary.on_time_orders} 件 / 遅延: {summary.delayed_orders} 件")
    print(f"総コスト: {summary.total_cost:.0f} 円")
    print(f"定時稼働: {summary.total_regular_hours:.1f}h / 残業: {summary.total_overtime_hours:.1f}h")


if __name__ == "__main__":
    _print_demo_result()

import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import Order, ProcessStep, WorkCenter  # noqa: E402
from scheduler import Scheduler  # noqa: E402

MONDAY = date(2026, 7, 20)  # 月曜始まりで検証を安定させる


def make_work_center(**overrides) -> WorkCenter:
    defaults = dict(
        process_id="cutting",
        name="裁断工程",
        daily_regular_hours=8,
        daily_overtime_hours=2,
        regular_cost_per_hour=1000,
        overtime_cost_per_hour=1500,
    )
    defaults.update(overrides)
    return WorkCenter(**defaults)


def test_single_order_within_regular_capacity():
    scheduler = Scheduler([make_work_center()])
    order = Order(
        order_id="SO-1",
        product_name="部品A",
        quantity=10,
        due_date=MONDAY + timedelta(days=5),
        routing=[ProcessStep("cutting", 0.5)],  # 5h
    )

    result = scheduler.plan([order], MONDAY)
    step = result.orders[0].steps[0]

    assert step.regular_hours == 5.0
    assert step.overtime_hours == 0.0
    assert step.start_date == MONDAY
    assert step.end_date == MONDAY
    assert result.orders[0].delay_days == 0
    assert result.summary.on_time_orders == 1


def test_overflow_spills_into_overtime_then_next_day():
    scheduler = Scheduler([make_work_center(daily_regular_hours=8, daily_overtime_hours=2)])
    order = Order(
        order_id="SO-1",
        product_name="部品A",
        quantity=1,
        due_date=MONDAY + timedelta(days=5),
        routing=[ProcessStep("cutting", 11.0)],  # 8h(定時)+2h(残業)+1h(翌日)
    )

    result = scheduler.plan([order], MONDAY)
    step = result.orders[0].steps[0]

    assert len(step.allocations) == 2
    first, second = step.allocations
    assert first.day == MONDAY
    assert first.regular_hours == 8.0
    assert first.overtime_hours == 2.0
    assert second.regular_hours == 1.0
    assert second.overtime_hours == 0.0
    assert step.regular_hours == 9.0
    assert step.overtime_hours == 2.0


def test_edd_priority_gives_earlier_due_date_the_capacity():
    """同じ工程を取り合う場合、納期が早い受注が先に能力を確保できる。"""
    wc = make_work_center(daily_regular_hours=8, daily_overtime_hours=0)
    scheduler = Scheduler([wc])

    urgent = Order(
        order_id="SO-URGENT",
        product_name="緊急品",
        quantity=1,
        due_date=MONDAY + timedelta(days=1),
        routing=[ProcessStep("cutting", 8.0)],
        priority=5,
    )
    relaxed = Order(
        order_id="SO-RELAXED",
        product_name="余裕品",
        quantity=1,
        due_date=MONDAY + timedelta(days=10),
        routing=[ProcessStep("cutting", 8.0)],
        priority=0,
    )

    # 入力順を逆にしても、納期が早い方が先に処理されることを確認する
    result = scheduler.plan([relaxed, urgent], MONDAY)
    order_ids = [o.order_id for o in result.orders]

    assert order_ids == ["SO-URGENT", "SO-RELAXED"]
    urgent_step = result.orders[0].steps[0]
    relaxed_step = result.orders[1].steps[0]
    assert urgent_step.start_date == MONDAY
    assert relaxed_step.start_date == MONDAY + timedelta(days=1)


def test_skips_weekend_when_capacity_full():
    wc = make_work_center(daily_regular_hours=8, daily_overtime_hours=0)
    scheduler = Scheduler([wc])
    friday = date(2026, 7, 24)
    order = Order(
        order_id="SO-1",
        product_name="部品A",
        quantity=1,
        due_date=friday + timedelta(days=10),
        routing=[ProcessStep("cutting", 16.0)],  # 金曜8h + 週末スキップ + 月曜8h
    )

    result = scheduler.plan([order], friday)
    step = result.orders[0].steps[0]

    assert [a.day for a in step.allocations] == [friday, date(2026, 7, 27)]


def test_multi_step_routing_waits_for_previous_step_to_finish():
    cutting = make_work_center(process_id="cutting", daily_regular_hours=8, daily_overtime_hours=0)
    assembly = make_work_center(process_id="assembly", daily_regular_hours=8, daily_overtime_hours=0)
    scheduler = Scheduler([cutting, assembly])

    order = Order(
        order_id="SO-1",
        product_name="部品A",
        quantity=1,
        due_date=MONDAY + timedelta(days=10),
        routing=[ProcessStep("cutting", 8.0), ProcessStep("assembly", 4.0)],
    )

    result = scheduler.plan([order], MONDAY)
    cutting_step, assembly_step = result.orders[0].steps

    assert cutting_step.end_date == MONDAY
    assert assembly_step.start_date == MONDAY + timedelta(days=1)


def test_delay_is_detected_when_due_date_is_exceeded():
    wc = make_work_center(daily_regular_hours=1, daily_overtime_hours=0)
    scheduler = Scheduler([wc])
    order = Order(
        order_id="SO-1",
        product_name="部品A",
        quantity=1,
        due_date=MONDAY,
        routing=[ProcessStep("cutting", 3.0)],  # 1h/日なので3営業日かかる
    )

    result = scheduler.plan([order], MONDAY)
    order_sched = result.orders[0]

    assert order_sched.completion_date > order_sched.due_date
    assert order_sched.delay_days > 0
    assert result.summary.delayed_orders == 1


def test_unknown_process_raises_value_error():
    scheduler = Scheduler([make_work_center(process_id="cutting")])
    order = Order(
        order_id="SO-1",
        product_name="部品A",
        quantity=1,
        due_date=MONDAY,
        routing=[ProcessStep("unknown_process", 1.0)],
    )

    try:
        scheduler.plan([order], MONDAY)
        assert False, "ValueError が発生するはず"
    except ValueError:
        pass

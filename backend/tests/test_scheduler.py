import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import (  # noqa: E402
    ChangeoverConfig,
    EquipmentConfig,
    Inventory,
    MachineConfig,
    Order,
    OrdersData,
    RawMaterial,
    StageConfig,
)
from scheduler import Scheduler  # noqa: E402

# シフト定義: 08:00-16:00 の8時間A勤のみ("TEST"モード)。テストの計算を単純にするため。
ONE_SHIFT = {"TEST": [{"shiftName": "A勤", "start": "08:00", "end": "16:00"}]}
PLAN_START = datetime(2026, 7, 20, 8, 0)  # 月曜 08:00


def make_machine(machine_id: str, capacity_per_hour: float) -> MachineConfig:
    return MachineConfig(machine_id, machine_id, capacity_per_hour)


def make_stage(stage_id, machines, order=1, uninterruptible=False, batch_rounding=None) -> StageConfig:
    return StageConfig(
        stage_id=stage_id,
        name=stage_id,
        order=order,
        machines=machines,
        uninterruptible=uninterruptible,
        batch_rounding=batch_rounding,
    )


def make_equipment(stages, lot_split_after=None, lot_split_into=1, shift_modes=None) -> EquipmentConfig:
    return EquipmentConfig(
        stages=stages,
        lot_split_after=lot_split_after,
        lot_split_into=lot_split_into,
        shift_modes=shift_modes or ONE_SHIFT,
        default_shift_mode="TEST",
    )


def make_changeover(matrix=None, a_shift_only=None) -> ChangeoverConfig:
    return ChangeoverConfig(matrix=matrix or {}, a_shift_only_transitions=a_shift_only or {})


def make_orders_data(orders, inventory=None, raw_materials=None, plan_start=PLAN_START) -> OrdersData:
    return OrdersData(
        orders=orders, inventory=inventory or {}, raw_materials=raw_materials or {}, plan_start=plan_start
    )


def test_picks_earliest_ready_machine_among_multiple():
    stage = make_stage("S1", [make_machine("M1", 10), make_machine("M2", 10)])
    equipment = make_equipment([stage])
    changeover = make_changeover()
    orders = [
        Order("O1", "X", 50, date(2026, 7, 25)),  # 5h
        Order("O2", "X", 30, date(2026, 7, 25)),  # 3h
    ]
    result = Scheduler(equipment, changeover, make_orders_data(orders)).run()

    op1 = next(op for op in result.schedule if op.order_id == "O1")
    op2 = next(op for op in result.schedule if op.order_id == "O2")

    assert op1.machine_id != op2.machine_id
    assert op1.start == PLAN_START
    assert op2.start == PLAN_START  # 別の号機が空いているので同時に着手できる


def test_changeover_time_is_consumed_before_the_run_start():
    stage = make_stage("S1", [make_machine("M1", 60)])  # 60個/時 = 1個/分
    equipment = make_equipment([stage])
    changeover = make_changeover(matrix={"S1": {"X": {"Y": 30}}})
    orders = [
        Order("O1", "X", 60, date(2026, 7, 25)),  # 1h
        Order("O2", "Y", 60, date(2026, 7, 26)),  # 品種切替で+30分
    ]
    result = Scheduler(equipment, changeover, make_orders_data(orders)).run()

    op1 = next(op for op in result.schedule if op.order_id == "O1")
    op2 = next(op for op in result.schedule if op.order_id == "O2")

    assert op1.start == PLAN_START
    assert op1.end == PLAN_START + timedelta(hours=1)
    assert op2.changeover_minutes == 30
    assert op2.start == op1.end + timedelta(minutes=30)
    assert op2.end == op2.start + timedelta(hours=1)


def test_a_shift_only_transition_pushes_start_to_next_a_shift():
    two_shifts = {
        "TEST": [
            {"shiftName": "A勤", "start": "08:00", "end": "16:00"},
            {"shiftName": "B勤", "start": "16:00", "end": "24:00"},
        ]
    }
    stage = make_stage("S1", [make_machine("M1", 60)])
    equipment = make_equipment([stage], shift_modes=two_shifts)
    changeover = make_changeover(
        matrix={"S1": {"X": {"Y": 10}}},
        a_shift_only={"S1": [{"from": "X", "to": "Y"}]},
    )
    # O1(X)をB勤に食い込むまで実行させ、O2(Y)への切替がA勤限定に押し出されることを確認する
    orders = [
        Order("O1", "X", 60 * 8.5, date(2026, 7, 25)),  # 8.5h: 08:00始まりで16:30終了(B勤に突入)
        Order("O2", "Y", 60, date(2026, 7, 26)),
    ]
    result = Scheduler(equipment, changeover, make_orders_data(orders)).run()

    op2 = next(op for op in result.schedule if op.order_id == "O2")
    # X完了は16:30(B勤中)。切替はA勤限定のため、B勤中には開始できず
    # 翌日のA勤開始(08:00)まで押し出される。
    assert op2.start.time().hour == 8
    assert op2.start.date() == PLAN_START.date() + timedelta(days=1)


def test_lot_splitting_creates_configured_number_of_parallel_reels():
    stage1 = make_stage("S1", [make_machine("A1", 100)], order=1)
    stage2 = make_stage("S2", [make_machine(f"B{i}", 100) for i in range(1, 5)], order=2)
    equipment = make_equipment([stage1, stage2], lot_split_after="S1", lot_split_into=3)
    changeover = make_changeover()
    orders = [Order("O1", "X", 90, date(2026, 7, 30))]
    result = Scheduler(equipment, changeover, make_orders_data(orders)).run()

    stage2_ops = [op for op in result.schedule if op.stage_id == "S2"]
    assert len(stage2_ops) == 3
    assert {op.lot_id for op in stage2_ops} == {"O1-R1", "O1-R2", "O1-R3"}
    assert sum(op.quantity for op in stage2_ops) == 90


def test_uninterruptible_stage_pushes_to_next_shift_when_it_does_not_fit():
    two_shifts = {
        "TEST": [
            {"shiftName": "A勤", "start": "08:00", "end": "16:00"},
            {"shiftName": "B勤", "start": "16:00", "end": "24:00"},
        ]
    }
    # 7時間分の仕事量(A勤の残り時間ちょうどでは収まらない量)を用意する
    stage = make_stage("S1", [make_machine("M1", 10)], uninterruptible=True)
    equipment = make_equipment([stage], shift_modes=two_shifts)
    changeover = make_changeover()

    late_start = datetime(2026, 7, 20, 14, 0)  # A勤残り2時間しかない状態から開始
    orders = [Order("O1", "X", 50, date(2026, 7, 25))]  # 5h仕事 -> A勤(残2h)にもB勤(8h)にも要検討
    result = Scheduler(equipment, changeover, make_orders_data(orders, plan_start=late_start)).run()

    op = result.schedule[0]
    # A勤残り2hには収まらないため、5h全体が収まるB勤(16:00-24:00)まで押し出される
    assert op.start == datetime(2026, 7, 20, 16, 0)
    assert op.end == datetime(2026, 7, 20, 21, 0)
    assert "連続作業" in op.note


def test_batch_rounding_rounds_quantity_up_and_extends_duration():
    stage = make_stage("S1", [make_machine("M1", 100)], batch_rounding=50)
    equipment = make_equipment([stage])
    changeover = make_changeover()
    orders = [Order("O1", "X", 120, date(2026, 7, 25))]
    result = Scheduler(equipment, changeover, make_orders_data(orders)).run()

    op = result.schedule[0]
    assert op.quantity == 150  # ceil(120/50)*50
    assert op.end - op.start == timedelta(hours=1.5)


def test_material_shortage_delays_start_until_incoming_arrives():
    stage = make_stage("S1", [make_machine("M1", 100)])
    equipment = make_equipment([stage])
    changeover = make_changeover()
    raw_materials = {
        "X": RawMaterial(material_id="MAT-X", on_hand=30, incoming=[(date(2026, 7, 22), 100)]),
    }
    orders = [Order("O1", "X", 80, date(2026, 7, 30))]
    result = Scheduler(equipment, changeover, make_orders_data(orders, raw_materials=raw_materials)).run()

    op = result.schedule[0]
    assert op.start == datetime(2026, 7, 22, 8, 30)
    assert not result.warnings  # 入荷予定でまかなえるので警告は出ない


def test_material_shortage_warns_when_incoming_is_insufficient():
    stage = make_stage("S1", [make_machine("M1", 100)])
    equipment = make_equipment([stage])
    changeover = make_changeover()
    raw_materials = {
        "X": RawMaterial(material_id="MAT-X", on_hand=10, incoming=[(date(2026, 7, 22), 5)]),
    }
    orders = [Order("O1", "X", 80, date(2026, 7, 30))]
    result = Scheduler(equipment, changeover, make_orders_data(orders, raw_materials=raw_materials)).run()

    assert any("MAT-X" in w.message for w in result.warnings)


def test_safety_stock_warning_when_inventory_below_threshold():
    stage = make_stage("S1", [make_machine("M1", 100)])
    equipment = make_equipment([stage])
    changeover = make_changeover()
    inventory = {"X": Inventory(current_stock=10, safety_stock=50)}
    result = Scheduler(equipment, changeover, make_orders_data([], inventory=inventory)).run()

    assert any(w.order_id == "X" and "安全在庫" in w.message for w in result.warnings)


def test_edd_orders_orders_are_scheduled_by_earliest_due_date_first():
    stage = make_stage("S1", [make_machine("M1", 10)])  # 1台のみ、取り合いになる
    equipment = make_equipment([stage])
    changeover = make_changeover()
    urgent = Order("O-URGENT", "X", 10, date(2026, 7, 21))
    relaxed = Order("O-RELAXED", "X", 10, date(2026, 7, 29))

    result = Scheduler(equipment, changeover, make_orders_data([relaxed, urgent])).run()

    urgent_op = next(op for op in result.schedule if op.order_id == "O-URGENT")
    relaxed_op = next(op for op in result.schedule if op.order_id == "O-RELAXED")
    assert urgent_op.start == PLAN_START
    assert relaxed_op.start == urgent_op.end


def test_delay_warning_is_reported_when_due_date_is_missed():
    stage = make_stage("S1", [make_machine("M1", 1)])  # 極端に遅い設備
    equipment = make_equipment([stage])
    changeover = make_changeover()
    orders = [Order("O1", "X", 100, date(2026, 7, 20))]  # 当日納期・100時間かかる
    result = Scheduler(equipment, changeover, make_orders_data(orders)).run()

    assert any(w.order_id == "O1" and "遅延見込み" in w.message for w in result.warnings)

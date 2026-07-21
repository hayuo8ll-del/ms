"""生産計画の自動立案エンジン(多設備ルーティング版)。

工程A→B→Cの複数号機・段取り替え・原材料在庫・シフトカレンダーを考慮した
有限能力の前進スケジューリング。納期の早い受注から順に(EDD)処理する。

  - 各工程は複数の号機(設備)を持ち、段取り替え込みで最も早く着手できる号機を選ぶ
  - 品種切替時は工程ごとの段取り替え時間マトリクスを適用し、シフト制約付き切替にも対応
  - 工程Aの完了後、ロットを分割して後工程(B/C)へ並行投入する
  - 「連続作業必須」工程は、シフト(勤務時間帯)をまたいで作業を中断できない
  - 最終工程は指定単位への数量丸め(切り上げ)を行う
  - 原材料の在庫・入庫予定によって着手可能時刻が制約される
  - 安全在庫を下回る品目があれば警告を出す

CI ではこのファイルを直接 `python3 scheduler.py` で実行し、config/ のサンプル
データで例外なく立案できることをスモークテストしている。
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, time, timedelta

from models import (
    ChangeoverConfig,
    EquipmentConfig,
    MachineConfig,
    MachineUtilization,
    Order,
    OrdersData,
    PlanResult,
    PlanWarning,
    ScheduledOp,
    StageConfig,
)
from shift_calendar import ShiftCalendar


@dataclass
class _MachineState:
    config: MachineConfig
    free_at: datetime
    last_product: str | None = None


class Scheduler:
    """設備(号機)の空き状況とシフトカレンダーを管理しながら受注群を前進スケジューリングする。"""

    def __init__(
        self,
        equipment: EquipmentConfig,
        changeover: ChangeoverConfig,
        orders_data: OrdersData,
        start_override: datetime | None = None,
    ):
        self.equipment = equipment
        self.changeover = changeover
        self.orders_data = orders_data
        self.plan_start = start_override or orders_data.plan_start
        self.stage_order: list[StageConfig] = equipment.stages_in_order()
        self.calendar = ShiftCalendar(equipment.active_shift_defs(), self.plan_start)

        self._machines: dict[str, _MachineState] = {
            m.machine_id: _MachineState(config=m, free_at=self.plan_start)
            for stage in self.stage_order
            for m in stage.machines
        }

        self.schedule: list[ScheduledOp] = []
        self.warnings: list[PlanWarning] = []
        self._material_consumed: dict[str, float] = {}

    # -- 設備選択・段取り替え -------------------------------------------------

    def _machines_for(self, stage: StageConfig, product: str) -> list[_MachineState]:
        """当該工程の号機のうち、その製品を生産可能(○/△)な号機だけを返す。"""
        allowed = self.equipment.eligible_machine_ids(product, stage.stage_id)
        machines = [self._machines[m.machine_id] for m in stage.machines]
        if allowed is None:
            return machines
        return [mach for mach in machines if mach.config.machine_id in allowed]

    def _first_infeasible_stage(self, product: str) -> str | None:
        """全工程を通して、その製品を生産できる号機が1台も無い工程があれば工程IDを返す。"""
        for stage in self.stage_order:
            if not self._machines_for(stage, product):
                return stage.stage_id
        return None

    def _pick_machine(self, stage: StageConfig, product: str, earliest_start: datetime) -> _MachineState:
        """段取り替え込みで最も早く着手できる号機を、生産可能な号機の中から選ぶ。"""
        best: _MachineState | None = None
        best_ready: datetime | None = None
        for mach in self._machines_for(stage, product):
            co_minutes = self.changeover.minutes(stage.stage_id, mach.last_product, product)
            candidate_earliest = max(mach.free_at, earliest_start)
            ready = candidate_earliest + timedelta(minutes=co_minutes)
            if best_ready is None or ready < best_ready:
                best, best_ready = mach, ready
        # 呼び出し前に _first_infeasible_stage で生産可否を確認済み(必ず1台以上ある)。
        assert best is not None
        return best

    # -- 原材料制約 -----------------------------------------------------------

    def _material_available_at(self, product: str, needed_qty: float) -> datetime:
        """材料の在庫・入庫予定から、必要数量が揃うタイミングを返す。不足時は警告を出す。"""
        mat = self.orders_data.raw_materials.get(product)
        if mat is None:
            return self.plan_start

        already_used = self._material_consumed.get(product, 0.0)
        available = mat.on_hand - already_used
        if available >= needed_qty:
            return self.plan_start

        for inc_date, inc_qty in sorted(mat.incoming, key=lambda x: x[0]):
            available += inc_qty
            if available >= needed_qty:
                return datetime.combine(inc_date, time(8, 30))

        self.warnings.append(
            PlanWarning(
                order_id=product,
                message=(
                    f"{product} の原材料({mat.material_id})が入庫予定を含めても不足しています"
                    f"(必要 {needed_qty:.0f} に対し見込み {available:.0f})。計画開始時刻のまま暫定的に立案しています。"
                ),
            )
        )
        return self.plan_start

    # -- 1工程分の割り付け ------------------------------------------------------

    def _schedule_op(
        self,
        stage: StageConfig,
        order_id: str,
        lot_id: str,
        product: str,
        qty: float,
        earliest_start: datetime,
    ) -> tuple[datetime, datetime]:
        eff_qty = qty
        note_parts: list[str] = []
        if stage.batch_rounding:
            eff_qty = math.ceil(qty / stage.batch_rounding) * stage.batch_rounding
            if eff_qty != qty:
                note_parts.append(f"数量を{stage.batch_rounding}単位に丸め({qty:.0f}→{eff_qty:.0f})")

        machine = self._pick_machine(stage, product, earliest_start)
        if self.equipment.is_conditional(product, stage.stage_id, machine.config.machine_id):
            note_parts.append("条件付き設備(△・要確認)")
        co_minutes = self.changeover.minutes(stage.stage_id, machine.last_product, product)
        requires_a_shift = self.changeover.requires_a_shift(stage.stage_id, machine.last_product, product)
        co_duration = timedelta(minutes=co_minutes)
        run_duration = timedelta(hours=eff_qty / machine.config.capacity_per_hour)

        base_earliest = max(machine.free_at, earliest_start)

        # start/end は正味の加工時間のみを表す(段取り替え時間は changeover_minutes に別記録し、
        # start より前に消費される時間として扱う)。
        if stage.uninterruptible:
            total_duration = co_duration + run_duration
            block_start = self.calendar.next_valid_start(base_earliest, total_duration, require_a_shift=requires_a_shift)
            start = block_start + co_duration
            end = start + run_duration
            note_parts.append("連続作業(シフトをまたいで中断不可)")
        else:
            if requires_a_shift:
                block_start = self.calendar.next_valid_start(base_earliest, timedelta(0), require_a_shift=True)
            else:
                block_start = self.calendar.next_available(base_earliest)
            start = self.calendar.advance(block_start, co_duration) if co_minutes > 0 else block_start
            end = self.calendar.advance(start, run_duration)

        machine.free_at = end
        machine.last_product = product

        self.schedule.append(
            ScheduledOp(
                order_id=order_id,
                lot_id=lot_id,
                stage_id=stage.stage_id,
                machine_id=machine.config.machine_id,
                product=product,
                quantity=eff_qty,
                start=start,
                end=end,
                changeover_minutes=co_minutes,
                note="; ".join(note_parts),
            )
        )
        return start, end

    # -- 受注単位のスケジューリング ---------------------------------------------

    def _schedule_order(self, order: Order) -> None:
        # 生産可否チェック: どこかの工程で生産可能な号機が1台も無ければ、この受注は割付できない。
        # 途中まで割り付けた状態のロールバックを避けるため、着手前に全工程を確認する。
        infeasible_stage = self._first_infeasible_stage(order.product)
        if infeasible_stage is not None:
            self.warnings.append(
                PlanWarning(
                    order_id=order.order_id,
                    message=(
                        f"{order.product} は工程{infeasible_stage}で生産可能な号機が無いため、"
                        f"計画から除外しました(設備条件マスタを確認してください)。"
                    ),
                )
            )
            return

        due = datetime.combine(order.due_date, time(20, 30))

        material_ready = self._material_available_at(order.product, order.quantity)
        self._material_consumed[order.product] = self._material_consumed.get(order.product, 0.0) + order.quantity

        split_index = None
        for idx, stage in enumerate(self.stage_order):
            if stage.stage_id == self.equipment.lot_split_after:
                split_index = idx
                break

        pre_split_stages = self.stage_order[: split_index + 1] if split_index is not None else self.stage_order
        post_split_stages = self.stage_order[split_index + 1 :] if split_index is not None else []

        cursor = material_ready
        lot_id = f"{order.order_id}-LOT"
        for stage in pre_split_stages:
            _start, cursor = self._schedule_op(stage, order.order_id, lot_id, order.product, order.quantity, cursor)

        completion = cursor
        if post_split_stages:
            split_into = max(self.equipment.lot_split_into, 1)
            reel_qty = math.ceil(order.quantity / split_into)
            reel_end_times: list[datetime] = []
            for i in range(split_into):
                qty = min(reel_qty, order.quantity - reel_qty * i)
                if qty <= 0:
                    continue
                reel_id = f"{order.order_id}-R{i + 1}"
                reel_cursor = cursor
                for stage in post_split_stages:
                    _start, reel_cursor = self._schedule_op(stage, order.order_id, reel_id, order.product, qty, reel_cursor)
                reel_end_times.append(reel_cursor)
            completion = max(reel_end_times) if reel_end_times else cursor

        if completion > due:
            delay = completion - due
            delay_days = delay.days + (1 if delay.seconds > 0 else 0)
            self.warnings.append(
                PlanWarning(
                    order_id=order.order_id,
                    message=(
                        f"納期({order.due_date.isoformat()})に対して完了予定が "
                        f"{completion.strftime('%Y-%m-%d %H:%M')} となり、約{delay_days}日の遅延見込みです。"
                    ),
                )
            )

    # -- 在庫警告・稼働率 --------------------------------------------------------

    def _check_safety_stock(self) -> None:
        for product, inv in self.orders_data.inventory.items():
            if inv.current_stock < inv.safety_stock:
                self.warnings.append(
                    PlanWarning(
                        order_id=product,
                        message=f"{product} の現在庫({inv.current_stock:.0f})が安全在庫({inv.safety_stock:.0f})を下回っています。",
                    )
                )

    def _utilization_summary(self) -> list[MachineUtilization]:
        result = []
        for stage in self.stage_order:
            for m_cfg in stage.machines:
                mach = self._machines[m_cfg.machine_id]
                busy_minutes = sum(
                    (op.end - op.start).total_seconds() / 60
                    for op in self.schedule
                    if op.machine_id == m_cfg.machine_id
                )
                available_minutes = max(self.calendar.available_minutes_between(self.plan_start, mach.free_at), 1.0)
                result.append(
                    MachineUtilization(
                        machine_id=m_cfg.machine_id,
                        name=m_cfg.name,
                        stage_id=stage.stage_id,
                        stage_name=stage.name,
                        utilization_pct=round(min(busy_minutes / available_minutes, 1.0) * 100, 1),
                    )
                )
        return result

    # -- エントリポイント --------------------------------------------------------

    def run(self) -> PlanResult:
        orders_sorted = sorted(self.orders_data.orders, key=lambda o: o.due_date)  # EDD
        for order in orders_sorted:
            self._schedule_order(order)

        self._check_safety_stock()

        return PlanResult(
            plan_start=self.plan_start,
            schedule=self.schedule,
            warnings=self.warnings,
            machine_utilization=self._utilization_summary(),
        )


def _print_demo_result() -> None:
    from datetime import date as _date

    from config_loader import load_changeover_config, load_equipment_config, load_orders_data

    equipment = load_equipment_config()
    changeover = load_changeover_config()
    orders_data = load_orders_data()

    start_override = datetime.combine(_date.today(), time(8, 30))
    scheduler = Scheduler(equipment, changeover, orders_data, start_override=start_override)
    result = scheduler.run()

    print("=== 生産計画 自動立案結果(サンプルデータ) ===")
    print(f"スケジュール件数: {len(result.schedule)}")
    print(f"警告件数: {len(result.warnings)}")
    for w in result.warnings:
        print(f"  - [{w.order_id}] {w.message}")
    print("--- 設備稼働率 ---")
    for u in result.machine_utilization:
        print(f"  [{u.stage_name}] {u.name}: {u.utilization_pct}%")


if __name__ == "__main__":
    _print_demo_result()

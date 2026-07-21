"""生産計画自動立案機能で使用するデータモデル群。

工程A→B→Cの多設備ルーティング、段取り替え、ロット分割、原材料制約に対応する。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime


@dataclass
class MachineConfig:
    machine_id: str
    name: str
    capacity_per_hour: float


@dataclass
class StageConfig:
    """1工程(号機グループ)の設定。"""

    stage_id: str
    name: str
    order: int
    machines: list[MachineConfig]
    uninterruptible: bool = False
    batch_rounding: int | None = None


@dataclass
class EquipmentConfig:
    stages: list[StageConfig]
    lot_split_after: str | None
    lot_split_into: int
    shift_modes: dict[str, list[dict]]
    default_shift_mode: str
    # 機種×設備の生産可否。{product: {stage_id: {machine_id: "○" | "△"}}}。
    # ある製品×工程のエントリが無い場合は「その工程の全号機で生産可」とみなす(後方互換)。
    eligibility: dict[str, dict[str, dict[str, str]]] = field(default_factory=dict)

    def stages_in_order(self) -> list[StageConfig]:
        return sorted(self.stages, key=lambda s: s.order)

    def active_shift_defs(self) -> list[dict]:
        return self.shift_modes[self.default_shift_mode]

    def eligible_machine_ids(self, product: str, stage_id: str) -> set[str] | None:
        """その製品を当該工程で生産できる号機IDの集合を返す。

        可否定義が無い(製品または工程のエントリが存在しない)場合は None を返し、
        呼び出し側は「全号機が生産可」として扱う。
        """
        marks = self.eligibility.get(product, {}).get(stage_id)
        if not marks:
            return None
        return set(marks.keys())

    def is_conditional(self, product: str, stage_id: str, machine_id: str) -> bool:
        """その割付が条件付き可(△)かどうか。"""
        return self.eligibility.get(product, {}).get(stage_id, {}).get(machine_id) == "△"


@dataclass
class ChangeoverConfig:
    """品種切替時の段取り替え時間(分)。stage_id -> {from_product: {to_product: minutes}}"""

    matrix: dict
    a_shift_only_transitions: dict

    def minutes(self, stage_id: str, from_product: str | None, to_product: str) -> float:
        if from_product is None or from_product == to_product:
            return 0.0
        return float(self.matrix.get(stage_id, {}).get(from_product, {}).get(to_product, 0.0))

    def requires_a_shift(self, stage_id: str, from_product: str | None, to_product: str) -> bool:
        if from_product is None or from_product == to_product:
            return False
        for transition in self.a_shift_only_transitions.get(stage_id, []):
            if transition["from"] == from_product and transition["to"] == to_product:
                return True
        return False


@dataclass
class Order:
    order_id: str
    product: str
    quantity: float
    due_date: date


@dataclass
class Inventory:
    current_stock: float
    safety_stock: float


@dataclass
class RawMaterial:
    material_id: str
    on_hand: float
    incoming: list[tuple[date, float]]


@dataclass
class OrdersData:
    orders: list[Order]
    inventory: dict[str, Inventory]
    raw_materials: dict[str, RawMaterial]
    plan_start: datetime


@dataclass
class ScheduledOp:
    order_id: str
    lot_id: str
    stage_id: str
    machine_id: str
    product: str
    quantity: float
    start: datetime
    end: datetime
    changeover_minutes: float = 0.0
    note: str = ""


@dataclass
class PlanWarning:
    order_id: str
    message: str


@dataclass
class MachineUtilization:
    machine_id: str
    name: str
    stage_id: str
    stage_name: str
    utilization_pct: float


@dataclass
class PlanResult:
    plan_start: datetime
    schedule: list[ScheduledOp] = field(default_factory=list)
    warnings: list[PlanWarning] = field(default_factory=list)
    machine_utilization: list[MachineUtilization] = field(default_factory=list)

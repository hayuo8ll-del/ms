"""生産計画自動立案機能で使用するデータモデル群。"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date


@dataclass
class ProcessStep:
    """受注の製造ルーティングを構成する1工程。"""

    process_id: str
    hours_per_unit: float


@dataclass
class Order:
    """製造すべき受注（製造オーダー）。"""

    order_id: str
    product_name: str
    quantity: int
    due_date: date
    routing: list[ProcessStep]
    priority: int = 0


@dataclass
class WorkCenter:
    """工程（設備・ライン単位の能力定義）。"""

    process_id: str
    name: str
    daily_regular_hours: float
    daily_overtime_hours: float = 0.0
    regular_cost_per_hour: float = 0.0
    overtime_cost_per_hour: float = 0.0


@dataclass
class DailyAllocation:
    day: date
    regular_hours: float
    overtime_hours: float


@dataclass
class StepSchedule:
    process_id: str
    start_date: date
    end_date: date
    allocations: list[DailyAllocation]
    regular_hours: float
    overtime_hours: float
    cost: float


@dataclass
class OrderSchedule:
    order_id: str
    product_name: str
    due_date: date
    completion_date: date
    delay_days: int
    steps: list[StepSchedule]
    total_cost: float


@dataclass
class PlanSummary:
    total_orders: int
    on_time_orders: int
    delayed_orders: int
    total_cost: float
    total_regular_hours: float
    total_overtime_hours: float


@dataclass
class PlanResult:
    orders: list[OrderSchedule] = field(default_factory=list)
    summary: PlanSummary | None = None

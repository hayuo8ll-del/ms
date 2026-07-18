"""立案ロジックの動作確認用サンプル（仮）データ。

将来的にDB/CSV/外部APIからの取得に置き換える想定。
"""
from __future__ import annotations

from datetime import date, timedelta

from models import Order, ProcessStep, WorkCenter


def sample_work_centers() -> list[WorkCenter]:
    return [
        WorkCenter(
            process_id="cutting",
            name="裁断工程",
            daily_regular_hours=8,
            daily_overtime_hours=2,
            regular_cost_per_hour=2000,
            overtime_cost_per_hour=3000,
        ),
        WorkCenter(
            process_id="assembly",
            name="組立工程",
            daily_regular_hours=8,
            daily_overtime_hours=2,
            regular_cost_per_hour=2200,
            overtime_cost_per_hour=3300,
        ),
        WorkCenter(
            process_id="painting",
            name="塗装工程",
            daily_regular_hours=6,
            daily_overtime_hours=2,
            regular_cost_per_hour=2500,
            overtime_cost_per_hour=3800,
        ),
        WorkCenter(
            process_id="inspection",
            name="検査工程",
            daily_regular_hours=8,
            daily_overtime_hours=1,
            regular_cost_per_hour=1800,
            overtime_cost_per_hour=2700,
        ),
    ]


def sample_orders() -> list[Order]:
    today = date.today()
    return [
        Order(
            order_id="SO-1001",
            product_name="ブラケットA",
            quantity=120,
            due_date=today + timedelta(days=6),
            routing=[
                ProcessStep("cutting", 0.05),
                ProcessStep("assembly", 0.08),
                ProcessStep("inspection", 0.02),
            ],
            priority=1,
        ),
        Order(
            order_id="SO-1002",
            product_name="パネルB",
            quantity=300,
            due_date=today + timedelta(days=4),
            routing=[
                ProcessStep("cutting", 0.03),
                ProcessStep("painting", 0.04),
                ProcessStep("inspection", 0.015),
            ],
            priority=1,
        ),
        Order(
            order_id="SO-1003",
            product_name="フレームC",
            quantity=80,
            due_date=today + timedelta(days=12),
            routing=[
                ProcessStep("cutting", 0.1),
                ProcessStep("assembly", 0.15),
                ProcessStep("painting", 0.06),
                ProcessStep("inspection", 0.03),
            ],
            priority=2,
        ),
        Order(
            order_id="SO-1004",
            product_name="カバーD",
            quantity=200,
            due_date=today + timedelta(days=3),
            routing=[
                ProcessStep("cutting", 0.02),
                ProcessStep("assembly", 0.05),
                ProcessStep("inspection", 0.01),
            ],
            priority=1,
        ),
        Order(
            order_id="SO-1005",
            product_name="ユニットE",
            quantity=60,
            due_date=today + timedelta(days=16),
            routing=[
                ProcessStep("assembly", 0.2),
                ProcessStep("painting", 0.08),
                ProcessStep("inspection", 0.04),
            ],
            priority=3,
        ),
    ]

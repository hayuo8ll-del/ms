"""生産計画自動立案APIサーバー。

`cd backend && uvicorn main:app --reload` で起動し、http://localhost:8000/
で画面（frontend/）を、`/api/*` でAPIを提供する。
"""
from __future__ import annotations

from datetime import date
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from mock_data import sample_orders, sample_work_centers
from models import Order, ProcessStep, WorkCenter
from scheduler import Scheduler

app = FastAPI(title="生産計画自動立案API")


class ProcessStepIn(BaseModel):
    process_id: str
    hours_per_unit: float


class OrderIn(BaseModel):
    order_id: str
    product_name: str
    quantity: int
    due_date: date
    routing: list[ProcessStepIn]
    priority: int = 0


class WorkCenterIn(BaseModel):
    process_id: str
    name: str
    daily_regular_hours: float
    daily_overtime_hours: float = 0.0
    regular_cost_per_hour: float = 0.0
    overtime_cost_per_hour: float = 0.0


class PlanRequest(BaseModel):
    orders: list[OrderIn] | None = None
    work_centers: list[WorkCenterIn] | None = None
    start_date: date | None = None


def _to_domain_orders(orders_in: list[OrderIn]) -> list[Order]:
    return [
        Order(
            order_id=o.order_id,
            product_name=o.product_name,
            quantity=o.quantity,
            due_date=o.due_date,
            routing=[ProcessStep(s.process_id, s.hours_per_unit) for s in o.routing],
            priority=o.priority,
        )
        for o in orders_in
    ]


def _to_domain_work_centers(work_centers_in: list[WorkCenterIn]) -> list[WorkCenter]:
    return [WorkCenter(**wc.model_dump()) for wc in work_centers_in]


@app.get("/api/orders")
def get_orders() -> list[Order]:
    """立案対象の受注一覧（現状は仮データ）。"""
    return sample_orders()


@app.get("/api/work-centers")
def get_work_centers() -> list[WorkCenter]:
    """工程マスタ（能力・コスト、現状は仮データ）。"""
    return sample_work_centers()


@app.post("/api/plan")
def create_plan(req: PlanRequest):
    """受注・工程マスタから生産計画を自動立案する。

    orders / work_centers を省略した場合は仮データで立案する。
    """
    orders = _to_domain_orders(req.orders) if req.orders else sample_orders()
    work_centers = _to_domain_work_centers(req.work_centers) if req.work_centers else sample_work_centers()
    start = req.start_date or date.today()

    scheduler = Scheduler(work_centers)
    return scheduler.plan(orders, start)


_FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
if _FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(_FRONTEND_DIR), html=True), name="frontend")

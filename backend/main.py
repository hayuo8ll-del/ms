"""生産計画自動立案APIサーバー。

config/ 配下のJSON(equipment_master.json / changeover_matrix.json / orders_sample.json)を
読み込んでスケジューリングする。実データへ移行する際は config/ の中身を差し替えるだけでよい。

`cd backend && uvicorn main:app --reload` で起動し、http://localhost:8000/ で画面を提供する。
"""
from __future__ import annotations

import io
from datetime import date, datetime, time
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from config_loader import load_changeover_config, load_equipment_config, load_orders_data
from excel_import import ImportValidationError, WorkbookReadError, export_workbook, parse_workbook, save_config
from scheduler import Scheduler

app = FastAPI(title="生産計画自動立案API")


class PlanRequest(BaseModel):
    start_date: date | None = None


@app.get("/api/equipment")
def get_equipment():
    """工程・号機構成、シフト設定(config/equipment_master.json)。"""
    return load_equipment_config()


@app.get("/api/orders")
def get_orders():
    """受注・在庫・原材料データ(config/orders_sample.json)。"""
    return load_orders_data()


@app.post("/api/plan")
def create_plan(req: PlanRequest):
    """受注・設備・段取り替え設定から生産計画を自動立案する。

    start_date を省略した場合は当日をプラン開始日とする。
    """
    equipment = load_equipment_config()
    changeover = load_changeover_config()
    orders_data = load_orders_data()

    start_override = datetime.combine(req.start_date or date.today(), time(8, 30))
    scheduler = Scheduler(equipment, changeover, orders_data, start_override=start_override)
    return scheduler.run()


@app.post("/api/import")
async def import_excel(file: UploadFile = File(...)):
    """Excelワークブック(設備・段取り替え・受注/在庫/原材料)を取り込み、config/*.jsonを差し替える。

    検証エラーがあれば422を返し、config/*.jsonは一切変更しない。
    """
    content = await file.read()
    try:
        equipment, changeover, orders_doc, summary = parse_workbook(io.BytesIO(content))
    except WorkbookReadError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ImportValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail=[{"sheet": i.sheet, "row": i.row, "message": i.message} for i in exc.issues],
        ) from exc

    save_config(equipment, changeover, orders_doc)
    return {
        "message": "取り込みが完了しました。",
        "stages": summary.stages,
        "machines": summary.machines,
        "changeover_rules": summary.changeover_rules,
        "orders": summary.orders,
        "inventory_items": summary.inventory_items,
        "raw_materials": summary.raw_materials,
    }


@app.get("/api/import/template")
def download_import_template():
    """現在のconfig/*.jsonの内容を埋め込んだExcelテンプレートをダウンロードする。"""
    wb = export_workbook()
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=production_planner_template.xlsx"},
    )


_FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
if _FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(_FRONTEND_DIR), html=True), name="frontend")

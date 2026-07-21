"""生産計画自動立案APIサーバー。

config/ 配下のJSON(equipment_master.json / changeover_matrix.json / orders_sample.json)を
読み込んでスケジューリングする。実データへ移行する際は config/ の中身を差し替えるだけでよい。

`cd backend && uvicorn main:app --reload` で起動し、http://localhost:8000/ で画面を提供する。
"""
from __future__ import annotations

import io
from datetime import date, datetime, time, timedelta
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from bottleneck_export import export_bottleneck_workbook
from bottleneck_planner import apply_actuals, plan_bottleneck, working_days_in_range
from config_loader import (
    load_bottleneck_planning,
    load_changeover_config,
    load_equipment_config,
    load_orders_data,
)
from excel_import import ImportValidationError, WorkbookReadError, export_workbook, parse_workbook, save_config
from plan_export import export_plan_workbook
from scheduler import Scheduler
from thm_ledger_import import parse_actuals, parse_equipment_stops, parse_thm_ledger

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


@app.post("/api/plan/export")
def export_plan(req: PlanRequest):
    """立案結果をExcelワークブック(.xlsx)としてダウンロードさせる。

    シート: サマリー / スケジュール明細 / 日付×シフト台数 / 警告(稼働率は含めない)。
    start_date を省略した場合は当日をプラン開始日とする。
    """
    equipment = load_equipment_config()
    changeover = load_changeover_config()
    orders_data = load_orders_data()

    start_override = datetime.combine(req.start_date or date.today(), time(8, 30))
    result = Scheduler(equipment, changeover, orders_data, start_override=start_override).run()

    wb = export_plan_workbook(result, equipment)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = f"production_plan_{start_override:%Y%m%d}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


async def _build_bottleneck_plan(
    file: UploadFile,
    stops_file: UploadFile | None,
    start_date: date | None,
    end_date: date | None,
    lines: str | None,
    future_only: bool,
):
    """台帳アップロードからボトルネック計画を立てる(export/plan で共通)。

    戻り値: (result, demands, extra_summary, cfg, plan_start)。
    """
    cfg = load_bottleneck_planning()
    plan_start = start_date or date.today()
    plan_end = end_date or (plan_start + timedelta(days=45))
    line_set = {s.strip() for s in lines.split(",")} if lines else None

    content = await file.read()
    try:
        demands, unmapped = parse_thm_ledger(
            io.BytesIO(content),
            aliases=cfg.product_aliases,
            only_due_on_or_after=plan_start if future_only else None,
            lines=line_set,
        )
        actuals = parse_actuals(io.BytesIO(content))
        if stops_file is not None:
            stops = parse_equipment_stops(io.BytesIO(await stops_file.read()))
        else:
            stops = parse_equipment_stops(io.BytesIO(content))
    except Exception as exc:  # noqa: BLE001 - 壊れたファイル/非対応形式を一律400にする
        raise HTTPException(status_code=400, detail=f"台帳ファイルを読み込めませんでした: {exc}") from exc

    actual_warnings: list[str] = []
    actuals_total = 0.0
    if actuals:
        before = {d.order_id: d.quantity for d in demands}
        demands, actual_warnings = apply_actuals(demands, actuals)
        after = {d.order_id: d.quantity for d in demands}
        actuals_total = sum(before.values()) - sum(after.values())

    if not demands:
        raise HTTPException(status_code=422, detail="対象となる受注が台帳から見つかりませんでした(期間・ライン・実績反映の条件を確認してください)。")

    working_days = working_days_in_range(plan_start, plan_end)
    result = plan_bottleneck(
        demands,
        working_days,
        cfg.line_daily_capacities,
        stage_flows=cfg.stage_flows,
        a_shift_only_switch=True,
        a_shift_fraction=cfg.a_shift_fraction,
        product_caps_by_mode=cfg.product_daily_caps_by_mode,
        equipment_stops=stops or None,
        bottleneck_stage=cfg.bottleneck_stage,
        machine_counts=cfg.machine_counts,
    )
    result.warnings.extend(actual_warnings)
    if unmapped:
        result.warnings.append(
            f"機種を解決できなかった台帳行が {len(unmapped)} 件あり、計画から除外しました。"
        )

    extra_summary: list[tuple[str, object]] = []
    if actuals:
        extra_summary += [("実績反映製番数", len(actuals)), ("実績控除数量", actuals_total)]
    if stops:
        extra_summary.append(("設備停止反映件数", len(stops)))
    return result, demands, extra_summary, cfg, plan_start


@app.post("/api/bottleneck/plan")
async def bottleneck_plan(
    file: UploadFile = File(...),
    stops_file: UploadFile | None = File(None),
    start_date: date | None = Form(None),
    end_date: date | None = Form(None),
    lines: str | None = Form(None),
    future_only: bool = Form(True),
):
    """THM生産台帳をアップロードし、HALボトルネック計画をJSONで返す(画面表示用)。

    入力・制約は /api/bottleneck/export と同じ。工程×日の配分と製番別MIL完成日を返す。
    """
    result, demands, extra_summary, cfg, plan_start = await _build_bottleneck_plan(
        file, stops_file, start_date, end_date, lines, future_only
    )
    return {
        "plan_start": plan_start.isoformat(),
        "shift_mode": result.shift_mode,
        "daily_capacity": result.daily_capacity,
        "required_daily_rate": round(result.required_daily_rate),
        "stage_order": cfg.stage_order,
        "working_days": [d.isoformat() for d in result.working_days],
        "stage_allocation": [
            {"stage_id": c.stage_id, "day": c.day.isoformat(), "product": c.product,
             "quantity": c.quantity, "order_id": c.order_id}
            for c in result.stage_allocation
        ],
        "mil_lots": [
            {"order_id": lot.order_id, "product": lot.product, "quantity": lot.quantity,
             "completion_day": lot.completion_day.isoformat(),
             "due_date": lot.due_date.isoformat() if lot.due_date else None,
             "on_time": lot.on_time}
            for lot in result.mil_lots
        ],
        "warnings": result.warnings,
        "summary": {
            "lot_count": len(demands),
            "total_qty": sum(d.quantity for d in demands),
            "late_count": sum(1 for lot in result.mil_lots if lot.on_time is False),
            "extra": [[label, value] for label, value in extra_summary],
        },
    }


@app.post("/api/bottleneck/export")
async def export_bottleneck_plan(
    file: UploadFile = File(...),
    stops_file: UploadFile | None = File(None),
    start_date: date | None = Form(None),
    end_date: date | None = Form(None),
    lines: str | None = Form(None),
    future_only: bool = Form(True),
):
    """THM生産台帳(.xlsx)をアップロードし、HALボトルネック基準の日次フロー計画を
    立ててExcel(.xlsx)を返す。

    シート: サマリー / 生産計画(機種×日) / 製番別MIL / 警告。
    - start_date/end_date: 計画期間(省略時は当日〜+45日)。
    - lines: 対象ラインをカンマ区切りで指定(例 "CTA1,CTA2")。省略時は全ライン。
    - future_only: True なら完成予定日が start_date 以降の受注のみを対象にする。
    - 台帳ワークブックに「実績」シート(製番/実績数)があれば残数量に控除して再立案する。
    - 機種切替(管理者作業)はA勤限定として扱い、A勤内に収まらない切替は翌朝へ繰り下げる。
    - 機種別キャパ(CAP表由来・設備可否の帰結)で機種ごとの日次投入を制限し、
      キャパ未定義の機種(例: Suica4=全設備×)は警告して計画から除外する。
    - 設備停止マスタ(別ファイル stops_file、または台帳内の「設備停止/01_設備停止マスタ」
      シート)の有効=Y行をHAL日次能力へ反映する(全停止/時間控除/停止率控除/補正後Cap)。
    - 計画パラメータ(ライン能力・機種別キャパ・工程オフセット等)は
      config/bottleneck_planning.json で差し替えられる。
    """
    result, demands, extra_summary, cfg, plan_start = await _build_bottleneck_plan(
        file, stops_file, start_date, end_date, lines, future_only
    )
    wb = export_bottleneck_workbook(result, demands, cfg.stage_order, extra_summary=extra_summary or None)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = f"bottleneck_plan_{plan_start:%Y%m%d}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


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

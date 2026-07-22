import io
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from openpyxl import Workbook  # noqa: E402

from config_loader import load_bottleneck_planning  # noqa: E402
from thm_ledger_import import (  # noqa: E402
    parse_actuals,
    parse_daily_actuals,
    parse_equipment_stops,
    parse_thm_ledger,
    resolve_product,
)


def test_resolve_product_uses_longest_prefix_match():
    # RC-コードの最長一致で呼称を解決する
    assert resolve_product("RC-SA02F/5  J") == "さそり金融"
    assert resolve_product("RC-S100/HNA5HK") == "さそり金融"
    assert resolve_product("RC-SA05A/5") == "さそり交通"
    assert resolve_product("RC-S105/JE16 J INLAY") == "SuicaⅢ"
    assert resolve_product("RC-S982F/5 J") == "Lite-S(Mies)"
    assert resolve_product("RC-SA10A J") == "部分リライト"  # スラッシュ無し・末尾サフィックス
    assert resolve_product("RC-S140     WW") == "SD3"
    assert resolve_product("まったく不明な品目") is None


def _ledger_workbook(rows):
    """台帳形式(1行目空・2行目ヘッダー・3行目以降データ)のブックを作る。"""
    wb = Workbook()
    ws = wb.active
    ws.title = "台帳"
    headers = ["№", "ライン", "完成品名", "x", "完成品コード", "製番", "ICチップ", "y", "着手予定日", "完成予定日", "完成予定数"]
    for c, h in enumerate(headers, start=1):
        ws.cell(row=2, column=c, value=h)
    for i, row in enumerate(rows, start=3):
        for c, v in enumerate(row, start=1):
            ws.cell(row=i, column=c, value=v)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


def test_parse_ledger_uses_seiban_as_order_id():
    rows = [
        ["THM1", "CTA1", "RC-SA02F/5  J", None, "98x", "6F5Z9FRY", "東芝さそり（6K8pF）", None, None, date(2026, 7, 15), 12000],
        ["THM2", "CTA2", "RC-SA05A/5", None, "98y", "6RAZ9EEO", "東芝さそり（6K7pF）", None, None, date(2026, 7, 20), 8000],
        ["THM3", "CRC1", "謎の品目", None, "98z", "s3", "?", None, None, date(2026, 7, 22), 5000],
    ]
    demands, unmapped = parse_thm_ledger(_ledger_workbook(rows))

    assert {d.product for d in demands} == {"さそり金融", "さそり交通"}
    # 出荷ロットの識別子は製番列(現場MIL表と同じキー)
    assert {d.order_id for d in demands} == {"6F5Z9FRY", "6RAZ9EEO"}
    assert demands[0].quantity == 12000
    assert demands[0].due_date == date(2026, 7, 15)
    # マップできなかった行は unmapped に載る
    assert len(unmapped) == 1 and unmapped[0].order_id == "s3"


def test_parse_ledger_falls_back_to_no_when_seiban_empty():
    rows = [
        ["THM9", "CTA1", "RC-SA02F/5", None, None, "-", None, None, None, date(2026, 7, 15), 100],
    ]
    demands, _ = parse_thm_ledger(_ledger_workbook(rows))
    assert demands[0].order_id == "THM9"


def test_parse_ledger_filters_future_due_and_lines():
    rows = [
        ["THM1", "CTA1", "RC-SA02F/5", None, None, None, None, None, None, date(2026, 6, 30), 100],  # 過去納期
        ["THM2", "CTA1", "RC-SA02F/5", None, None, None, None, None, None, date(2026, 7, 25), 200],  # 未来・CTA1
        ["THM3", "CRC1", "RC-SA02F/5", None, None, None, None, None, None, date(2026, 7, 25), 300],  # 未来・CRC1
    ]
    demands, _ = parse_thm_ledger(
        _ledger_workbook(rows),
        only_due_on_or_after=date(2026, 7, 21),
        lines={"CTA1", "CTA2"},
    )
    assert [d.order_id for d in demands] == ["THM2"]


def _with_actuals_sheet(buf, rows):
    """既存ブックに「実績」シート(製番/実績数)を追加して返す。"""
    from openpyxl import load_workbook

    wb = load_workbook(buf)
    ws = wb.create_sheet("実績")
    ws.append(["製番", "実績数"])
    for row in rows:
        ws.append(row)
    out = io.BytesIO()
    wb.save(out)
    out.seek(0)
    return out


def test_parse_actuals_reads_seiban_quantities_and_sums_duplicates():
    base = _ledger_workbook([])
    buf = _with_actuals_sheet(base, [["6F5Z9FRY", 5000], ["6F5Z9FRY", 2000], ["6RAZ9EEO", 800], ["", 999]])
    actuals = parse_actuals(buf)
    assert actuals == {"6F5Z9FRY": 7000.0, "6RAZ9EEO": 800.0}


def test_parse_actuals_returns_empty_when_sheet_missing():
    assert parse_actuals(_ledger_workbook([])) == {}


def test_parse_daily_actuals_sums_per_day_across_stages():
    base = _ledger_workbook([])
    from openpyxl import load_workbook

    wb = load_workbook(base)
    ws = wb.create_sheet("日次実績")
    ws.append(["日付", "工程", "実績数"])
    ws.append([date(2026, 7, 21), "HAL", 50000])
    ws.append([date(2026, 7, 21), "HAL", 30000])  # 同日は合算
    ws.append([date(2026, 7, 22), "HAL", 90000])
    out = io.BytesIO()
    wb.save(out)
    out.seek(0)

    daily = parse_daily_actuals(out)
    assert daily == {date(2026, 7, 21): 80000.0, date(2026, 7, 22): 90000.0}


def test_parse_daily_actuals_empty_when_sheet_missing():
    assert parse_daily_actuals(_ledger_workbook([])) == {}


def test_parse_equipment_stops_reads_enabled_rows_only():
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "設備停止"
    headers = ["停止ID", "有効", "停止区分", "工程", "設備", "開始日", "開始勤務", "終了日", "終了勤務",
               "停止率_%", "停止時間_h", "補正後Cap_台", "停止Cap控除方法"]
    ws.append(headers)
    ws.append(["S0001", "Y", "オーバーホール", "HAL", "HAL#9", date(2026, 7, 22), "A勤", date(2026, 7, 24), "B勤",
               100, 0, None, "全停止"])
    ws.append(["S0002", "N", "試作", "HAL", "HAL#8", date(2026, 7, 20), "A勤", date(2026, 7, 20), "B勤",
               100, 0, None, "全停止"])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    stops = parse_equipment_stops(buf)
    assert len(stops) == 1
    s = stops[0]
    assert (s.stop_id, s.stage_id, s.machine_id, s.method) == ("S0001", "HAL", "HAL#9", "全停止")
    assert (s.start_day, s.end_day, s.start_shift, s.end_shift) == (date(2026, 7, 22), date(2026, 7, 24), "A勤", "B勤")


def test_parse_equipment_stops_empty_when_sheet_missing():
    assert parse_equipment_stops(_ledger_workbook([])) == []


def test_load_bottleneck_planning_reads_config_file():
    cfg = load_bottleneck_planning()
    # config/bottleneck_planning.json の内容(≒組み込み既定値)が読める
    assert cfg.line_daily_capacities["16h"] == 90000
    assert cfg.bottleneck_stage == "HAL"
    assert cfg.stage_order == ["ANT", "TAL", "HAL", "MIL"]
    assert cfg.product_daily_caps_by_mode["16h"]["Lite-S(Mies)"] == 30720
    assert cfg.product_aliases["RC-SA02F"] == "さそり金融"
    assert cfg.machine_counts["HAL"] == 5

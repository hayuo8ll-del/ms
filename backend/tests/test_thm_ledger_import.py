import io
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from openpyxl import Workbook  # noqa: E402

from thm_ledger_import import parse_actuals, parse_thm_ledger, resolve_product  # noqa: E402


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

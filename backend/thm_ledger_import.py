"""THM 生産台帳(受注/納期の実データ)を、ボトルネック計画エンジンの需要入力へ変換する。

台帳シートは1行目が空、2行目がヘッダー、3行目以降が1行1受注:
  № / ライン / 完成品名 / 完成品コード / 製番 / ICチップ / … /
  着手予定日 / 完成予定日 / 完成予定数 / …

機種(呼称)は、ICチップ列(「東芝さそり」等は金融/交通を区別できない)ではなく、
**完成品コード/完成品名(RC-コード)→呼称** の対応で解決する(最長一致)。既定の対応表
`PRODUCT_ALIASES` は機種一覧(CAP)から生成したもの。会社データでずれる場合は差し替え可。
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from typing import BinaryIO

from openpyxl import load_workbook

from bottleneck_planner import DemandItem

# 完成品コード(RC-…の基底)→ 機種呼称。機種一覧(CAP)から生成。
PRODUCT_ALIASES: dict[str, str] = {
    "RC-S100": "さそり金融",
    "RC-SA02F": "さそり金融",
    "RC-S103": "さそり交通",
    "RC-S104": "さそり交通",
    "RC-SA05A": "さそり交通",
    "RC-S105": "SuicaⅢ",
    "RC-S106": "SuicaⅢ",
    "RC-SA06A": "SuicaⅢ",
    "RC-S982F": "Lite-S(Mies)",
    "RC-SA10A": "部分リライト",
    "RC-S123": "SD-T1",
    "RC-SA15A": "SD-T1",
    "RC-S125": "Suica4",
    "RC-S127": "MOT2",
    "RC-S140": "SD3",
    "RC-SA42F": "SD3",
}


@dataclass
class UnmappedRow:
    row: int
    order_id: str
    name: str


def _norm(value: object) -> str:
    if value is None:
        return ""
    return re.sub(r"[\s　]", "", str(value)).upper()


def resolve_product(name: object, aliases: dict[str, str] | None = None) -> str | None:
    """完成品名/コードから機種呼称を最長一致で解決する。該当なしは None。"""
    aliases = aliases or PRODUCT_ALIASES
    n = _norm(name)
    best: str | None = None
    for key in aliases:
        if n.startswith(key) and (best is None or len(key) > len(best)):
            best = key
    return aliases[best] if best else None


def _as_date(value: object) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return None


def _header_index(ws, header_row: int) -> dict[str, int]:
    idx: dict[str, int] = {}
    for c in range(1, ws.max_column + 1):
        name = ws.cell(row=header_row, column=c).value
        if name is not None:
            idx[str(name).strip()] = c
    return idx


def parse_thm_ledger(
    file_obj: BinaryIO,
    aliases: dict[str, str] | None = None,
    sheet_name: str = "台帳",
    header_row: int = 2,
    only_due_on_or_after: date | None = None,
    lines: set[str] | None = None,
) -> tuple[list[DemandItem], list[UnmappedRow]]:
    """台帳ワークブックを需要(DemandItem)一覧へ変換する。

    - `only_due_on_or_after`: 完成予定日がこの日以降の受注だけを対象にする(未来分のみ等)。
    - `lines`: ライン名の集合を渡すと、その受注だけに絞る(例: {"CTA1", "CTA2"})。
    戻り値: (需要一覧, 呼称解決できなかった行一覧)。
    """
    wb = load_workbook(file_obj, data_only=True)
    ws = wb[sheet_name] if sheet_name in wb.sheetnames else wb[wb.sheetnames[0]]
    idx = _header_index(ws, header_row)

    def col(*names: str) -> int | None:
        for n in names:
            if n in idx:
                return idx[n]
        return None

    c_no = col("№", "No", "No.")
    c_line = col("ライン")
    c_name = col("完成品名")
    c_code = col("完成品コード")
    c_qty = col("完成予定数")
    c_due = col("完成予定日")

    demands: list[DemandItem] = []
    unmapped: list[UnmappedRow] = []

    for r in range(header_row + 1, ws.max_row + 1):
        order_id = ws.cell(row=r, column=c_no).value if c_no else None
        if not order_id:
            continue
        order_id = str(order_id).strip()

        if lines and c_line:
            line = ws.cell(row=r, column=c_line).value
            if str(line).strip() not in lines:
                continue

        qty = ws.cell(row=r, column=c_qty).value if c_qty else None
        due = _as_date(ws.cell(row=r, column=c_due).value) if c_due else None
        if not isinstance(qty, (int, float)) or qty <= 0 or due is None:
            continue
        if only_due_on_or_after and due < only_due_on_or_after:
            continue

        name = ws.cell(row=r, column=c_name).value if c_name else None
        code = ws.cell(row=r, column=c_code).value if c_code else None
        product = resolve_product(name, aliases) or resolve_product(code, aliases)
        if product is None:
            unmapped.append(UnmappedRow(row=r, order_id=order_id, name=str(name)))
            continue

        demands.append(DemandItem(product=product, quantity=float(qty), due_date=due, order_id=order_id))

    return demands, unmapped

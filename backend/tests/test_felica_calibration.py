import io
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from openpyxl import Workbook  # noqa: E402

from bottleneck_planner import DemandItem, StageFlowConfig, plan_bottleneck, working_days_in_range  # noqa: E402
from felica_calibration import calibrate, compare_plans, parse_felica_plan  # noqa: E402

CAPS = {"16h": 90000, "22h": 120000}


def _felica_workbook(rows):
    """FeliCa形式(行3ヘッダ, 製番=col4, Line-In/Completion=col8 の2行ペア)のブックを作る。

    rows: list of (seiban, product, lot, {date: line_in}, {date: completion})
    """
    wb = Workbook()
    ws = wb.active
    ws.title = "202607_CTA1"
    dates = sorted({d for _s, _p, _l, li, co in rows for d in list(li) + list(co)})
    # 行3: A..H はラベル、col9以降が日付
    for c, label in enumerate(["Planner", "WS", "Item Desc", "Plan", "Item No", "Before", "Lot", "Date"], 1):
        ws.cell(row=3, column=c, value=label)
    date_col = {d: 9 + i for i, d in enumerate(dates)}
    for d, c in date_col.items():
        ws.cell(row=3, column=c, value=d)
    r = 5
    for seiban, product, lot, li, co in rows:
        ws.cell(row=r, column=3, value=product)
        ws.cell(row=r, column=4, value=seiban)
        ws.cell(row=r, column=7, value=lot)
        ws.cell(row=r, column=8, value="Line-In")
        ws.cell(row=r + 1, column=8, value="Completion")
        for d, q in li.items():
            ws.cell(row=r, column=date_col[d], value=q)
        for d, q in co.items():
            ws.cell(row=r + 1, column=date_col[d], value=q)
        r += 2
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


def test_parse_felica_plan_extracts_line_in_and_completion():
    buf = _felica_workbook([
        ("S1", "RC-S982F/5", 40000, {date(2026, 7, 23): 40000}, {date(2026, 7, 28): 40000}),
    ])
    felica = parse_felica_plan(buf)
    assert set(felica) == {"S1"}
    lot = felica["S1"]
    assert lot.line_in_first == date(2026, 7, 23)
    assert lot.completion_last == date(2026, 7, 28)
    assert lot.lot == 40000


def test_compare_plans_reports_completion_day_diff():
    days = working_days_in_range(date(2026, 7, 1), date(2026, 7, 31))
    flows = [StageFlowConfig("ANT", -1), StageFlowConfig("HAL", 0), StageFlowConfig("MIL", 1)]
    demands = [DemandItem("さそり金融", 90000, date(2026, 7, 31), order_id="S1")]
    caps = {"16h": {"さそり金融": 90000}, "22h": {"さそり金融": 120000}}
    result = plan_bottleneck(demands, days, CAPS, stage_flows=flows, product_caps_by_mode=caps)
    our_comp = {lot.order_id: lot.completion_day for lot in result.mil_lots}["S1"]

    # FeliCaの完成日を our より2稼働日後ろに置く → 完成日差 = -2 (ourが早い)
    fi = days.index(our_comp)
    felica_comp = days[fi + 2]
    buf = _felica_workbook([("S1", "RC-SA02F/5", 90000, {days[0]: 90000}, {felica_comp: 90000})])
    felica = parse_felica_plan(buf)

    rep = compare_plans(result, felica, days)
    assert rep.matched == 1
    assert rep.completion_mae == 2.0
    assert rep.completion_bias == -2.0  # our - felica = 早い


def test_calibrate_picks_offsets_reducing_error():
    days = working_days_in_range(date(2026, 7, 1), date(2026, 8, 15))
    base_flows = [StageFlowConfig("ANT", -3), StageFlowConfig("TAL", -2),
                  StageFlowConfig("HAL", 0), StageFlowConfig("MIL", 2)]
    caps = {"16h": {"X": 30000}, "22h": {"X": 45000}}
    demands = [DemandItem("X", 60000, date(2026, 8, 15), order_id="S1")]
    plan_kwargs = dict(stage_flows=base_flows, product_caps_by_mode=caps, a_shift_only_switch=False,
                       a_shift_fraction=0.5)

    # 真値: ANT=-1, MIL=0 で計画した完成日/投入日を FeliCa とする
    truth_flows = [StageFlowConfig("ANT", -1), StageFlowConfig("TAL", -1),
                   StageFlowConfig("HAL", 0), StageFlowConfig("MIL", 0)]
    truth = plan_bottleneck(demands, days, CAPS, stage_flows=truth_flows, product_caps_by_mode=caps)
    comp = {lot.order_id: lot.completion_day for lot in truth.mil_lots}["S1"]
    ant_start = min(c.day for c in truth.stage_allocation if c.stage_id == "ANT" and c.order_id == "S1")
    buf = _felica_workbook([("S1", "RC-S100/5", 60000, {ant_start: 60000}, {comp: 60000})])
    felica = parse_felica_plan(buf)

    cal = calibrate(demands, days, CAPS, plan_kwargs, felica)
    # 較正後の誤差は現状以下
    assert cal.recommended.completion_mae + cal.recommended.start_mae <= cal.current.completion_mae + cal.current.start_mae
    # 真値(MIL=0)に近いオフセットが選ばれる
    assert cal.recommended_offsets["MIL"] == 0

import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bottleneck_planner import (  # noqa: E402
    DemandItem,
    allocate_bottleneck,
    choose_shift_mode,
    plan_bottleneck,
    working_days_in_range,
)

# 現場の実能力に相当: HAL日次能力 16H=9万/日, 22H=12万/日
CAPS = {"16h": 90000, "22h": 120000}


def test_working_days_exclude_weekends():
    days = working_days_in_range(date(2026, 7, 1), date(2026, 7, 7))
    # 7/1(水)〜7/7(火) のうち 7/4(土),7/5(日) を除く5日
    assert days == [date(2026, 7, 1), date(2026, 7, 2), date(2026, 7, 3), date(2026, 7, 6), date(2026, 7, 7)]


def test_choose_shift_mode_picks_smallest_sufficient():
    # 稼働日22日で総需要 1,800,000 → 必要日次 ~81,818 → 16H(9万)で足りる
    mode, cap, req = choose_shift_mode(1_800_000, 22, CAPS)
    assert mode == "16h"
    assert cap == 90000
    assert round(req) == 81818


def test_choose_shift_mode_escalates_to_22h_when_needed():
    # 必要日次が9万を超えると22Hを選ぶ
    mode, cap, _req = choose_shift_mode(2_400_000, 22, CAPS)
    assert mode == "22h"
    assert cap == 120000


def test_allocation_never_exceeds_daily_capacity():
    demands = [
        DemandItem("A", 200000, date(2026, 7, 31)),
        DemandItem("B", 100000, date(2026, 7, 31)),
    ]
    days = working_days_in_range(date(2026, 7, 1), date(2026, 7, 31))
    alloc, _completion, _warn = allocate_bottleneck(demands, days, 90000)

    per_day = {}
    for cell in alloc:
        per_day[cell.day] = per_day.get(cell.day, 0) + cell.quantity
    assert all(total <= 90000 + 1e-6 for total in per_day.values())
    # 総量は保存される
    assert round(sum(c.quantity for c in alloc)) == 300000


def test_allocation_is_campaign_style_edd_order():
    # 納期の早い B を先に投入し切ってから A に移る(キャンペーン)
    demands = [
        DemandItem("A", 90000, date(2026, 7, 31)),
        DemandItem("B", 90000, date(2026, 7, 10)),
    ]
    days = working_days_in_range(date(2026, 7, 1), date(2026, 7, 31))
    alloc, completion, _warn = allocate_bottleneck(demands, days, 90000)

    # 1日目=B(9万), 2日目=A(9万)
    assert alloc[0].product == "B" and alloc[0].day == date(2026, 7, 1)
    assert alloc[1].product == "A" and alloc[1].day == date(2026, 7, 2)
    assert completion["B"] == date(2026, 7, 1)
    assert completion["A"] == date(2026, 7, 2)


def test_due_date_overrun_warning():
    # 1日9万・稼働日1日しかないのに18万必要 → 完了が納期を超過
    demands = [DemandItem("A", 180000, date(2026, 7, 1))]
    days = [date(2026, 7, 1)]
    _alloc, _completion, warnings = allocate_bottleneck(demands, days, 90000)
    assert any("投入しきれない" in w for w in warnings)


def test_plan_bottleneck_end_to_end_july_like():
    # 7月(平日22日)・16Hで9万/日 → 総需要 ~180万を配分できる
    days = working_days_in_range(date(2026, 7, 1), date(2026, 7, 31))
    demands = [
        DemandItem("さそり金融", 500000, date(2026, 7, 20)),
        DemandItem("さそり交通", 600000, date(2026, 7, 25)),
        DemandItem("SuicaⅢ", 700000, date(2026, 7, 31)),
    ]
    result = plan_bottleneck(demands, days, CAPS)
    assert result.shift_mode == "16h"
    assert result.daily_capacity == 90000
    # 全機種の投入完了日が算出される
    assert set(result.completion.keys()) == {"さそり金融", "さそり交通", "SuicaⅢ"}
    # 日次上限は超えない
    per_day = {}
    for cell in result.allocation:
        per_day[cell.day] = per_day.get(cell.day, 0) + cell.quantity
    assert all(v <= 90000 + 1e-6 for v in per_day.values())

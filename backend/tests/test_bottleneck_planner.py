import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bottleneck_planner import (  # noqa: E402
    DemandItem,
    EquipmentStop,
    StageFlowConfig,
    allocate_bottleneck,
    apply_actuals,
    apply_equipment_stops,
    choose_shift_mode,
    compute_progress,
    expand_to_stages,
    mil_completion_by_order,
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


def test_expand_to_stages_offsets_upstream_and_downstream():
    # HAL基準: ANTは2日早く、TALは1日早く、MILは1日遅く流す
    days = working_days_in_range(date(2026, 7, 1), date(2026, 7, 31))
    demands = [DemandItem("A", 270000, date(2026, 7, 31))]  # 90k×3日
    flows = [
        StageFlowConfig("ANT", -2),
        StageFlowConfig("TAL", -1),
        StageFlowConfig("HAL", 0),
        StageFlowConfig("MIL", +1),
    ]
    result = plan_bottleneck(demands, days, CAPS, stage_flows=flows)

    # HALは 7/1,7/2,7/3 に9万ずつ
    hal = {c.day: c.quantity for c in result.stage_allocation if c.stage_id == "HAL"}
    assert hal[date(2026, 7, 1)] == 90000
    # TALは1日前倒し → HALの7/2ぶんがTALでは7/1になる。オフセットで期間外に出た分は警告。
    tal_days = sorted(c.day for c in result.stage_allocation if c.stage_id == "TAL")
    hal_days = sorted(c.day for c in result.stage_allocation if c.stage_id == "HAL")
    assert tal_days[0] < hal_days[0] or any("ANT" in w or "TAL" in w for w in result.warnings)
    # MILは1日後ろ倒し → 最終MIL日はHAL最終日より後
    mil_days = sorted(c.day for c in result.stage_allocation if c.stage_id == "MIL")
    assert mil_days[-1] > hal_days[-1]


def test_expand_to_stages_warns_when_stage_capacity_exceeded():
    days = working_days_in_range(date(2026, 7, 1), date(2026, 7, 31))
    # HALは9万/日で流すが、MILの日次能力を8万に設定 → 超過警告
    demands = [DemandItem("A", 180000, date(2026, 7, 31))]
    flows = [StageFlowConfig("HAL", 0), StageFlowConfig("MIL", 0, daily_capacity=80000)]
    result = plan_bottleneck(demands, days, CAPS, stage_flows=flows)
    assert any("工程MIL" in w and "超過" in w for w in result.warnings)


def test_mil_completion_is_reported_per_serial_lot():
    # 製番(出荷ロット)別にMIL完成日が出る
    days = working_days_in_range(date(2026, 7, 1), date(2026, 7, 31))
    demands = [
        DemandItem("さそり金融", 90000, date(2026, 7, 10), order_id="THM-A"),
        DemandItem("さそり金融", 90000, date(2026, 7, 10), order_id="THM-B"),
        DemandItem("SuicaⅢ", 90000, date(2026, 7, 20), order_id="THM-C"),
    ]
    flows = [StageFlowConfig("HAL", 0), StageFlowConfig("MIL", 1)]
    result = plan_bottleneck(demands, days, CAPS, stage_flows=flows)

    lots = {lot.order_id: lot for lot in result.mil_lots}
    assert set(lots) == {"THM-A", "THM-B", "THM-C"}
    # 各ロットの数量が保存される
    assert lots["THM-A"].quantity == 90000
    # HAL 7/1(A),7/2(B),7/3(C) → MILは+1営業日 = 7/2,7/3,7/6
    assert lots["THM-A"].completion_day == date(2026, 7, 2)
    assert lots["THM-C"].completion_day == date(2026, 7, 6)
    # 全ロット納期内
    assert all(lot.on_time for lot in result.mil_lots)


def test_mil_lot_due_date_overrun_is_flagged_and_warned():
    days = working_days_in_range(date(2026, 7, 1), date(2026, 7, 31))
    # 2ロット目のMIL完成が納期(7/1)を過ぎる
    demands = [
        DemandItem("A", 90000, date(2026, 7, 10), order_id="L1"),
        DemandItem("B", 90000, date(2026, 7, 1), order_id="L2"),
    ]
    flows = [StageFlowConfig("HAL", 0), StageFlowConfig("MIL", 1)]
    result = plan_bottleneck(demands, days, CAPS, stage_flows=flows)

    late = [lot for lot in result.mil_lots if lot.on_time is False]
    assert any(lot.order_id == "L2" for lot in late)
    assert any("製番L2" in w and "納期" in w for w in result.warnings)


def test_apply_actuals_reduces_remaining_and_drops_completed():
    demands = [
        DemandItem("A", 90000, date(2026, 7, 10), order_id="L1"),
        DemandItem("B", 50000, date(2026, 7, 12), order_id="L2"),
        DemandItem("C", 30000, date(2026, 7, 15), order_id="L3"),
    ]
    adjusted, warnings = apply_actuals(demands, {"L1": 30000, "L2": 50000, "L9": 100})

    by_id = {d.order_id: d for d in adjusted}
    assert by_id["L1"].quantity == 60000  # 残数量に控除
    assert "L2" not in by_id  # 完了済みは除外
    assert by_id["L3"].quantity == 30000  # 実績なしはそのまま
    assert any("L2" in w and "除外" in w for w in warnings)
    assert any("L9" in w and "見つかりません" in w for w in warnings)


def test_a_shift_only_switch_defers_changeover_past_a_shift():
    # 1日9万。L1(A)が5万でA勤相当(50%)を超えて終わる → L2(B)への切替は翌朝に繰り下げ
    days = working_days_in_range(date(2026, 7, 1), date(2026, 7, 31))
    demands = [
        DemandItem("A", 50000, date(2026, 7, 3), order_id="L1"),
        DemandItem("B", 90000, date(2026, 7, 10), order_id="L2"),
    ]
    alloc, completion, warnings = allocate_bottleneck(
        demands, days, 90000, a_shift_only_switch=True, a_shift_fraction=0.5
    )
    b_days = sorted(c.day for c in alloc if c.product == "B")
    assert b_days[0] == date(2026, 7, 2)  # 7/1中には切り替えない
    assert completion["B"] == date(2026, 7, 2)
    assert any("A勤" in w and "切替" in w for w in warnings)

    # 制約オフなら同日中に切り替わる
    alloc2, _c2, _w2 = allocate_bottleneck(demands, days, 90000)
    b_days2 = sorted(c.day for c in alloc2 if c.product == "B")
    assert b_days2[0] == date(2026, 7, 1)


def test_a_shift_switch_allowed_when_previous_ends_within_a_shift():
    # L1(A)が3.6万(=40%)で終わる → A勤内なので同日中にBへ切替できる
    days = working_days_in_range(date(2026, 7, 1), date(2026, 7, 31))
    demands = [
        DemandItem("A", 36000, date(2026, 7, 3), order_id="L1"),
        DemandItem("B", 90000, date(2026, 7, 10), order_id="L2"),
    ]
    alloc, _completion, warnings = allocate_bottleneck(
        demands, days, 90000, a_shift_only_switch=True, a_shift_fraction=0.5
    )
    b_first = min(c.day for c in alloc if c.product == "B")
    assert b_first == date(2026, 7, 1)
    assert not any("切替" in w for w in warnings)


def test_product_daily_cap_limits_and_allows_parallel_fill():
    # Lite-Sは30,720/日が上限。残ったライン能力(90k-30,720)は同日に金融が並行して使う。
    days = working_days_in_range(date(2026, 7, 1), date(2026, 7, 31))
    demands = [
        DemandItem("Lite-S(Mies)", 61440, date(2026, 7, 3), order_id="L1"),
        DemandItem("さそり金融", 100000, date(2026, 7, 10), order_id="L2"),
    ]
    caps = {"Lite-S(Mies)": 30720, "さそり金融": 80000}
    alloc, completion, _warn = allocate_bottleneck(demands, days, 90000, product_daily_caps=caps)

    per_day_product: dict[tuple, float] = {}
    per_day_total: dict = {}
    for c in alloc:
        per_day_product[(c.day, c.product)] = per_day_product.get((c.day, c.product), 0) + c.quantity
        per_day_total[c.day] = per_day_total.get(c.day, 0) + c.quantity
    # 機種別キャパを1日も超えない
    assert all(q <= caps[p] + 1e-6 for (_d, p), q in per_day_product.items())
    # ライン日次能力も超えない
    assert all(q <= 90000 + 1e-6 for q in per_day_total.values())
    # 7/1: Lite-S 30,720 + 金融 59,280 の並行生産
    assert per_day_product[(date(2026, 7, 1), "Lite-S(Mies)")] == 30720
    assert per_day_product[(date(2026, 7, 1), "さそり金融")] == 59280
    # Lite-Sは2日(30,720×2=61,440)で完了
    assert completion["Lite-S(Mies)"] == date(2026, 7, 2)
    # 総量保存
    assert round(sum(c.quantity for c in alloc)) == 161440


def test_plan_excludes_products_without_capacity_definition():
    # キャパ未定義(=生産可能な設備が無い; Suica4相当)の機種は警告して除外する
    days = working_days_in_range(date(2026, 7, 1), date(2026, 7, 31))
    demands = [
        DemandItem("さそり金融", 90000, date(2026, 7, 10), order_id="L1"),
        DemandItem("Suica4", 50000, date(2026, 7, 15), order_id="L2"),
    ]
    caps_by_mode = {"16h": {"さそり金融": 80000}, "22h": {"さそり金融": 120000}}
    result = plan_bottleneck(demands, days, CAPS, product_caps_by_mode=caps_by_mode)

    assert not any(c.product == "Suica4" for c in result.allocation)
    assert any("Suica4" in w and "除外" in w for w in result.warnings)
    # 除外後の機種は普通に配分される
    assert "さそり金融" in result.completion


def test_shift_mode_escalates_when_single_product_cannot_finish():
    # 合計は16Hのライン能力で足りるが、X単独では16Hキャパ×稼働日で作り切れない → 22Hへ
    days = working_days_in_range(date(2026, 7, 1), date(2026, 7, 14))  # 10稼働日
    demands = [DemandItem("X", 350000, date(2026, 7, 31), order_id="L1")]
    caps_by_mode = {"16h": {"X": 30000}, "22h": {"X": 42000}}
    result = plan_bottleneck(demands, days, CAPS, product_caps_by_mode=caps_by_mode)

    assert result.shift_mode == "22h"
    # 22Hのキャパ42,000/日で配分される
    per_day = {}
    for c in result.allocation:
        per_day[c.day] = per_day.get(c.day, 0) + c.quantity
    assert max(per_day.values()) == 42000


def test_equipment_stop_full_stop_deducts_machine_share_with_shift_bounds():
    # HAL5台構成でライン9万/日 → 1台の寄与は18,000/日。
    # 7/2 B勤〜7/3 A勤 の全停止: 7/2は半日(9,000)・7/3も半日(9,000)控除。
    days = working_days_in_range(date(2026, 7, 1), date(2026, 7, 10))
    stop = EquipmentStop(
        stop_id="S1", stage_id="HAL", machine_id="HAL#9",
        start_day=date(2026, 7, 2), end_day=date(2026, 7, 3),
        start_shift="B勤", end_shift="A勤", method="全停止",
    )
    day_caps, warnings = apply_equipment_stops(days, 90000, [stop], machine_counts={"HAL": 5})
    assert day_caps[date(2026, 7, 2)] == 81000
    assert day_caps[date(2026, 7, 3)] == 81000
    assert date(2026, 7, 1) not in day_caps
    assert any("S1" in w and "反映しました" in w for w in warnings)


def test_equipment_stop_corrected_cap_and_rate_and_non_bottleneck():
    days = working_days_in_range(date(2026, 7, 1), date(2026, 7, 10))
    stops = [
        # 停止率控除50% × 1台分(18,000) = 9,000控除 → ただし補正後Cap=70,000が上限で勝つ
        EquipmentStop("S2", "HAL", "HAL#5", date(2026, 7, 6), date(2026, 7, 6),
                      method="停止率控除", stop_rate_pct=50, corrected_cap=70000),
        # ボトルネック外(MIL)は能力反映せず警告のみ
        EquipmentStop("S3", "MIL", "MIL#7", date(2026, 7, 7), date(2026, 7, 8), method="全停止"),
    ]
    day_caps, warnings = apply_equipment_stops(days, 90000, stops, machine_counts={"HAL": 5, "MIL": 4})
    assert day_caps[date(2026, 7, 6)] == 70000
    assert date(2026, 7, 7) not in day_caps
    assert any("S3" in w and "反映していません" in w for w in warnings)


def test_plan_bottleneck_uses_reduced_capacity_on_stop_days():
    days = working_days_in_range(date(2026, 7, 1), date(2026, 7, 31))
    demands = [DemandItem("A", 270000, date(2026, 7, 31), order_id="L1")]
    stop = EquipmentStop("S1", "HAL", "HAL#9", date(2026, 7, 1), date(2026, 7, 1), method="全停止")
    result = plan_bottleneck(demands, days, CAPS, equipment_stops=[stop], machine_counts={"HAL": 5})

    per_day = {}
    for c in result.allocation:
        per_day[c.day] = per_day.get(c.day, 0) + c.quantity
    assert per_day[date(2026, 7, 1)] == 72000  # 90,000 - 18,000
    assert per_day[date(2026, 7, 2)] == 90000


def test_compute_progress_plan_cumulative_only_without_actuals():
    days = working_days_in_range(date(2026, 7, 1), date(2026, 7, 31))
    demands = [DemandItem("A", 180000, date(2026, 7, 31), order_id="L1")]
    result = plan_bottleneck(demands, days, CAPS)
    rows = compute_progress(result, None)

    # 計画累計は日次の累積
    assert rows[0].plan == 90000 and rows[0].plan_cum == 90000
    assert rows[1].plan_cum == 180000
    # 実績なしなので実績系はNone
    assert all(r.actual is None and r.diff is None and r.progress_cum is None for r in rows)


def test_compute_progress_with_daily_actuals_diff_and_cumulative():
    days = working_days_in_range(date(2026, 7, 1), date(2026, 7, 31))
    demands = [DemandItem("A", 180000, date(2026, 7, 31), order_id="L1")]
    result = plan_bottleneck(demands, days, CAPS)  # 計画 90k, 90k
    # 実績: 1日目80,000(計画比 -10,000), 2日目95,000(+5,000)
    actuals = {days[0]: 80000, days[1]: 95000}
    rows = compute_progress(result, actuals)

    assert rows[0].actual == 80000 and rows[0].diff == -10000 and rows[0].progress_cum == -10000
    assert rows[1].actual == 95000 and rows[1].diff == 5000 and rows[1].progress_cum == -5000
    assert rows[0].actual_cum == 80000 and rows[1].actual_cum == 175000
    # 実績未入力の日(3日目)は実績系None、計画は0(180,000=2日で投入完了)、計画累計は180,000で頭打ち
    assert rows[2].actual is None and rows[2].plan == 0 and rows[2].plan_cum == 180000


def test_hal_input_is_quantized_to_reel_units_with_final_remainder():
    # HALはリール1本=10,000単位。35,000のロットは 30,000(3本) + 端数5,000 で投入される。
    days = working_days_in_range(date(2026, 7, 1), date(2026, 7, 10))
    demands = [DemandItem("A", 35000, date(2026, 7, 31), order_id="L1")]
    # 日次能力32,000: 1日目はリール3本(30,000)のみ、端数5,000は2日目
    alloc, completion, _w = allocate_bottleneck(demands, days, 32000, input_unit=10000)

    assert [(c.day, c.quantity) for c in alloc] == [
        (date(2026, 7, 1), 30000),
        (date(2026, 7, 2), 5000),
    ]
    assert completion["A"] == date(2026, 7, 2)


def test_reel_smaller_than_capacity_gap_waits_for_next_day():
    # 残能力が1本(10,000)未満の日にはそのロットは投入しない(リールは分割不可)
    days = working_days_in_range(date(2026, 7, 1), date(2026, 7, 10))
    demands = [
        DemandItem("A", 25000, date(2026, 7, 3), order_id="L1"),
        DemandItem("B", 20000, date(2026, 7, 5), order_id="L2"),
    ]
    alloc, _c, _w = allocate_bottleneck(demands, days, 30000, input_unit=10000)
    day1 = [(c.product, c.quantity) for c in alloc if c.day == date(2026, 7, 1)]
    # A: 2本(20,000)。残10,000にAの3本目は入らず(残5,000は端数でない)、B 1本が並行投入
    assert ("A", 20000) in day1
    assert ("B", 10000) in day1


def test_tal_batches_in_40k_units_front_loaded():
    # 30,000/日×3日のHAL流れ(7/2,7/3,7/6)は、TAL(4万まとめ投入・1日前)では
    # 7/1: 40,000 / 7/2: 40,000 / 7/3: 端数10,000 になる
    from bottleneck_planner import DailyCell

    days = working_days_in_range(date(2026, 7, 1), date(2026, 7, 31))
    allocation = [
        DailyCell(date(2026, 7, 2), "A", 30000, "L1"),
        DailyCell(date(2026, 7, 3), "A", 30000, "L1"),
        DailyCell(date(2026, 7, 6), "A", 30000, "L1"),
    ]
    flows = [StageFlowConfig("TAL", -1, input_unit=40000), StageFlowConfig("HAL", 0)]
    cells, warnings = expand_to_stages(allocation, days, flows)

    tal = sorted((c.day, c.quantity) for c in cells if c.stage_id == "TAL")
    assert tal == [
        (date(2026, 7, 1), 40000),
        (date(2026, 7, 2), 40000),
        (date(2026, 7, 3), 10000),
    ]
    # HAL側は量子化せずそのまま、総量は一致
    hal_total = sum(c.quantity for c in cells if c.stage_id == "HAL")
    assert hal_total == sum(q for _d, q in tal) == 90000
    assert not warnings


def test_same_product_lots_do_not_trigger_switch_deferral():
    # 同一機種のロット切替は管理者切替ではないため、A勤制約の対象外
    days = working_days_in_range(date(2026, 7, 1), date(2026, 7, 31))
    demands = [
        DemandItem("A", 60000, date(2026, 7, 3), order_id="L1"),
        DemandItem("A", 60000, date(2026, 7, 5), order_id="L2"),
    ]
    alloc, _completion, warnings = allocate_bottleneck(
        demands, days, 90000, a_shift_only_switch=True, a_shift_fraction=0.5
    )
    # L2は7/1の残り3万から始まる(繰り下げ無し)
    l2_first = min(c.day for c in alloc if c.order_id == "L2")
    assert l2_first == date(2026, 7, 1)
    assert not any("切替" in w for w in warnings)

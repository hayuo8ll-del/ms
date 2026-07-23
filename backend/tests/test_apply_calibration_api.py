import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from config_loader import CONFIG_DIR  # noqa: E402

client = TestClient(main.app)
CFG = CONFIG_DIR / "bottleneck_planning.json"


def test_apply_calibration_writes_offsets_then_restores():
    """推奨較正値を config に反映するAPI(実configをバックアップ→検証→復元)。"""
    original = CFG.read_bytes()
    try:
        resp = client.post(
            "/api/bottleneck/apply-calibration",
            json={"offsets": {"ANT": -3, "TAL": -2, "HAL": 0, "MIL": 1}, "a_shift_fraction": 0.6},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["applied"] is True
        assert body["offsets"] == {"ANT": -3, "TAL": -2, "HAL": 0, "MIL": 1}
        assert body["a_shift_fraction"] == 0.6

        data = json.loads(CFG.read_text(encoding="utf-8"))
        flows = {f["stageId"]: f["leadOffsetDays"] for f in data["stageFlows"]}
        assert flows == {"ANT": -3, "TAL": -2, "HAL": 0, "MIL": 1}
        assert data["aShiftFraction"] == 0.6
        # 機種別キャパ等が保持されている(反映が破壊的でない)
        assert "productDailyCapsByMode" in data
    finally:
        CFG.write_bytes(original)


def test_apply_calibration_rejects_bad_stage_key():
    resp = client.post(
        "/api/bottleneck/apply-calibration",
        json={"offsets": {"XXX": 0}, "a_shift_fraction": 0.5},
    )
    assert resp.status_code == 422


def test_apply_calibration_rejects_out_of_range_fraction():
    resp = client.post(
        "/api/bottleneck/apply-calibration",
        json={"offsets": {"ANT": -1, "TAL": -2, "HAL": 0, "MIL": 2}, "a_shift_fraction": 1.5},
    )
    assert resp.status_code == 422


def test_apply_calibration_rejects_extreme_offset():
    resp = client.post(
        "/api/bottleneck/apply-calibration",
        json={"offsets": {"ANT": -99, "TAL": -2, "HAL": 0, "MIL": 2}, "a_shift_fraction": 0.5},
    )
    assert resp.status_code == 422

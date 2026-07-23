"""config/ 配下のJSON設定を読み込み、ドメインモデルに変換する。

会社PCへ移行する際は config/ 配下のJSONを実際のデータに差し替えるだけでよい
(このファイル・scheduler.py 自体の変更は原則不要)。
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

from models import (
    ChangeoverConfig,
    EquipmentConfig,
    Inventory,
    MachineConfig,
    Order,
    OrdersData,
    RawMaterial,
    StageConfig,
)

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"


def _load_json(name: str) -> dict:
    with open(CONFIG_DIR / name, encoding="utf-8") as f:
        return json.load(f)


def load_equipment_config() -> EquipmentConfig:
    data = _load_json("equipment_master.json")
    stages = [
        StageConfig(
            stage_id=s["stageId"],
            name=s["stageName"],
            order=s["order"],
            machines=[
                MachineConfig(m["machineId"], m["name"], m["capacityPerHour"]) for m in s["machines"]
            ],
            uninterruptible=s.get("uninterruptible", False),
            batch_rounding=s.get("batchRounding"),
        )
        for s in data["stages"]
    ]
    lot_splitting = data.get("lotSplitting", {})
    return EquipmentConfig(
        stages=stages,
        lot_split_after=lot_splitting.get("stageAfter"),
        lot_split_into=lot_splitting.get("splitInto", 1),
        shift_modes=data["shiftModes"],
        default_shift_mode=data["defaultShiftMode"],
        eligibility=data.get("eligibility", {}),
    )


def load_changeover_config() -> ChangeoverConfig:
    data = _load_json("changeover_matrix.json")
    return ChangeoverConfig(
        matrix=data,
        a_shift_only_transitions=data.get("aShiftOnlyTransitions", {}),
    )


@dataclass
class BottleneckPlanningConfig:
    """ボトルネック日次フロー計画のパラメータ(config/bottleneck_planning.json)。"""

    line_daily_capacities: dict[str, float]
    bottleneck_stage: str
    stage_flows: list  # list[StageFlowConfig]
    machine_counts: dict[str, int]
    a_shift_fraction: float
    product_aliases: dict[str, str]
    product_daily_caps_by_mode: dict[str, dict[str, float]]
    non_working_days: list[date]  # 平日の非稼働日(祝日/計画休); 週末は別途除外
    shipment_buffer_days: int  # 完成目標=出荷日−この日数(暦日)。既定2

    @property
    def stage_order(self) -> list[str]:
        return [f.stage_id for f in self.stage_flows]


def load_bottleneck_planning() -> BottleneckPlanningConfig:
    """ボトルネック計画パラメータを読み込む。ファイルが無ければ組み込み既定値を使う。"""
    from bottleneck_planner import StageFlowConfig
    from thm_ledger_import import PRODUCT_ALIASES, PRODUCT_DAILY_CAPS_BY_MODE

    path = CONFIG_DIR / "bottleneck_planning.json"
    data: dict = {}
    if path.exists():
        with open(path, encoding="utf-8") as f:
            data = json.load(f)

    flows = [
        StageFlowConfig(
            f["stageId"],
            int(f["leadOffsetDays"]),
            f.get("dailyCapacity"),
            f.get("inputUnit"),
            {k: int(v) for k, v in (f.get("leadOffsetByProduct") or {}).items()} or None,
        )
        for f in data.get(
            "stageFlows",
            [
                {"stageId": "ANT", "leadOffsetDays": -2},
                {"stageId": "TAL", "leadOffsetDays": -1},
                {"stageId": "HAL", "leadOffsetDays": 0},
                {"stageId": "MIL", "leadOffsetDays": 1},
            ],
        )
    ]
    return BottleneckPlanningConfig(
        line_daily_capacities={k: float(v) for k, v in data.get("lineDailyCapacities", {"16h": 90000, "22h": 120000}).items()},
        bottleneck_stage=data.get("bottleneckStage", "HAL"),
        stage_flows=flows,
        machine_counts={k: int(v) for k, v in data.get("machineCounts", {"ANT": 1, "TAL": 2, "HAL": 5, "MIL": 4}).items()},
        a_shift_fraction=float(data.get("aShiftFraction", 0.5)),
        product_aliases=data.get("productAliases") or dict(PRODUCT_ALIASES),
        product_daily_caps_by_mode=data.get("productDailyCapsByMode") or {
            mode: dict(caps) for mode, caps in PRODUCT_DAILY_CAPS_BY_MODE.items()
        },
        non_working_days=[date.fromisoformat(d) for d in data.get("nonWorkingDays", [])],
        shipment_buffer_days=int(data.get("shipmentBufferDays", 2)),
    )


def save_nonworking_days(days: list[date], path: Path | None = None) -> list[str]:
    """FeliCa由来の非稼働日(祝日/計画休)を bottleneck_planning.json に書き戻す。

    `nonWorkingDays` を昇順ISO文字列で上書きし、他フィールドは保持する
    (テスト用に `path` 差し替え可)。書き込んだ日付一覧(ISO)を返す。
    """
    path = path or (CONFIG_DIR / "bottleneck_planning.json")
    data: dict = {}
    if path.exists():
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    iso = sorted({d.isoformat() for d in days})
    data["nonWorkingDays"] = iso
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return iso


def save_bottleneck_calibration(
    offsets: dict[str, int],
    a_shift_fraction: float,
    path: Path | None = None,
) -> dict:
    """較正で得た工程オフセット/A勤割合を bottleneck_planning.json に書き戻す。

    `stageFlows[].leadOffsetDays` を stageId 一致で更新し、`aShiftFraction` を上書きする。
    その他のフィールド(inputUnit / productDailyCapsByMode / productAliases / コメント等)は
    保持する。テスト用に書き込み先 `path` を差し替えられる(既定は config/ の実ファイル)。
    更新後の {offsets, aShiftFraction} を返す。
    """
    path = path or (CONFIG_DIR / "bottleneck_planning.json")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    for flow in data.get("stageFlows", []):
        sid = flow.get("stageId")
        if sid in offsets:
            flow["leadOffsetDays"] = int(offsets[sid])
    data["aShiftFraction"] = float(a_shift_fraction)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return {
        "offsets": {fl["stageId"]: fl["leadOffsetDays"] for fl in data.get("stageFlows", [])},
        "a_shift_fraction": data["aShiftFraction"],
    }


def load_orders_data() -> OrdersData:
    data = _load_json("orders_sample.json")
    orders = [
        Order(o["orderId"], o["product"], o["quantity"], date.fromisoformat(o["dueDate"]))
        for o in data["orders"]
    ]
    inventory = {
        product: Inventory(levels["currentStock"], levels["safetyStock"])
        for product, levels in data.get("inventory", {}).items()
    }
    raw_materials = {
        product: RawMaterial(
            material_id=m["materialId"],
            on_hand=m["onHand"],
            incoming=[(date.fromisoformat(i["date"]), i["quantity"]) for i in m.get("incoming", [])],
        )
        for product, m in data.get("rawMaterials", {}).items()
    }
    plan_start = datetime.fromisoformat(data["planStart"])
    return OrdersData(orders=orders, inventory=inventory, raw_materials=raw_materials, plan_start=plan_start)

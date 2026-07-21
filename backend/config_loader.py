"""config/ 配下のJSON設定を読み込み、ドメインモデルに変換する。

会社PCへ移行する際は config/ 配下のJSONを実際のデータに差し替えるだけでよい
(このファイル・scheduler.py 自体の変更は原則不要)。
"""
from __future__ import annotations

import json
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

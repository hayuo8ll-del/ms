# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current State

`ms` is a production planning automation ("生産計画の自動立案") tool: a Python/FastAPI
backend with a finite-capacity, multi-machine scheduling engine, and a static HTML/JS
Gantt-chart frontend that calls the API. It models a 3-stage routing (工程A→B→C, e.g.
mounting → encapsulation → inspection), each stage having several machines, with
changeover time between product types, lot splitting into parallel sub-lots after stage
1, a "must finish within one shift" constraint on stage 2, batch-size rounding on stage
3, raw-material/inventory availability, and a real shift calendar (configurable
day/night shift windows). Master data (equipment, changeover times, orders/inventory)
lives in `config/*.json`; swapping in real data means replacing those files only — no
code changes. Real data can be brought in either by editing those JSON files directly,
or via the web UI's Excel import (download a template, edit it, upload it — see
`backend/excel_import.py`).

## Commands

All backend commands assume `cd backend` first (imports are plain, non-package-relative,
matching the existing CI workflow at `.github/workflows/scheduler-test.yml`).

- Install dependencies: `pip install -r backend/requirements.txt`
- Run the scheduler smoke test directly: `cd backend && python3 scheduler.py`
- Run the API + frontend locally: `cd backend && uvicorn main:app --reload` then open
  `http://localhost:8000/`
- Run tests: `cd backend && pytest` (or a single test:
  `cd backend && pytest tests/test_scheduler.py::test_lot_splitting_creates_configured_number_of_parallel_reels`)
- Download a fresh Excel import template (reflecting the current `config/*.json`):
  `curl -o template.xlsx http://localhost:8000/api/import/template` while the API is
  running.

There is no separate frontend build step — `frontend/` is static HTML/CSS/JS served
directly by FastAPI's `StaticFiles` mount.

## Architecture

- `config/equipment_master.json` — stages (`STAGE1`/`STAGE2`/`STAGE3`) in process order,
  each with its machines (`machineId`/`name`/`capacityPerHour`), optional
  `uninterruptible` flag (stage 2: a lot must complete within a single shift window once
  started) and `batchRounding` (stage 3: completed quantity rounds up to this unit).
  Also defines `lotSplitting` (which stage's output gets split, and into how many
  parallel sub-lots for the downstream stages) and `shiftModes`/`defaultShiftMode` (named
  shift patterns, e.g. `"16h"` = two 8.5h shifts/day with gaps; `"22h"` = near-continuous
  two-shift coverage).
- `config/changeover_matrix.json` — per-stage, per-product-pair changeover minutes, plus
  `aShiftOnlyTransitions` (some product transitions on some stages may only start during
  the day shift).
- `config/orders_sample.json` — sample orders (id/product/quantity/due date), current
  inventory vs. safety stock per product, raw-material on-hand + incoming shipments per
  product, and `planStart`. All "仮データ" (placeholder) — swap this file for a real
  order-intake feed.
- `backend/models.py` — dataclasses for equipment/changeover/order config
  (`MachineConfig`, `StageConfig`, `EquipmentConfig`, `ChangeoverConfig`, `Order`,
  `Inventory`, `RawMaterial`, `OrdersData`) and the scheduling output
  (`ScheduledOp`, `PlanWarning`, `MachineUtilization`, `PlanResult`).
- `backend/config_loader.py` — reads `config/*.json` into those dataclasses. This is the
  only place that needs to change if the config file *shapes* change; swapping the JSON
  *contents* needs no code change at all.
- `backend/shift_calendar.py` — `ShiftCalendar`: turns a named shift pattern into a list
  of concrete datetime windows (handles overnight-wrapping shifts like `20:30`→`05:30`)
  and answers "when can a task next start", "does a duration fit in one window"
  (for the stage-2 uninterruptible constraint), and "how much working time exists between
  two timestamps" (used for utilization %).
- `backend/scheduler.py` — the `Scheduler` class: finite-capacity, multi-machine forward
  scheduling. Orders are sorted by **EDD** (earliest due date). For each order: raw
  material availability may push back the earliest start; each pre-split stage picks
  whichever machine is ready soonest (accounting for that machine's changeover time from
  its last product); after the configured split stage, the order is divided into
  parallel sub-lots that flow independently through the remaining stages (each may land
  on a different machine); the uninterruptible stage must fit entirely in one shift
  window (pushing to the next valid window otherwise); the rounding stage rounds
  quantity up before computing duration. Warns when a product's on-hand + incoming
  material can't cover demand, when an order's completion misses its due date, and when
  current stock is below safety stock. Also has a `__main__` block used as a CI smoke
  test (`python3 scheduler.py`) that runs the algorithm against `config/` and prints a
  summary — must keep working without exceptions.
- `backend/excel_import.py` — converts between `config/*.json` and a single `.xlsx`
  workbook with fixed sheet names/columns: `Stages`, `Machines`, `LotSplitting`,
  `ShiftModes`, `Settings` (key/value: `defaultShiftMode`, `planStart`), `Changeover`,
  `AShiftOnlyTransitions`, `Orders`, `Inventory`, `RawMaterials`,
  `RawMaterialIncoming`. `export_workbook()` builds a workbook pre-filled with the
  current `config/*.json` contents (used as a downloadable template).
  `parse_workbook()` reads an uploaded workbook, validates every row (collecting all
  issues — sheet name, row number, message — rather than stopping at the first one),
  and returns JSON-shaped dicts; on any validation failure it raises
  `ImportValidationError` and *nothing* is written. `save_config()` writes the parsed
  dicts to `config/*.json` (only called after validation succeeds).
- `backend/main.py` — FastAPI app. `GET /api/equipment`, `GET /api/orders`,
  `POST /api/plan` (optional `start_date`, defaults to today; reloads `config/*.json`
  fresh on every call and returns the `PlanResult`), `POST /api/import` (multipart
  `.xlsx` upload; 422 with a list of `{sheet, row, message}` on validation failure,
  otherwise overwrites `config/*.json` and returns import counts), and
  `GET /api/import/template` (downloads the current config as a pre-filled `.xlsx`).
  Mounts `frontend/` at `/`.
- `backend/tests/test_scheduler.py` — unit tests using small synthetic
  equipment/changeover/orders fixtures (not the sample config) covering: earliest-ready
  machine selection, changeover time being consumed before a run starts, A-shift-only
  transitions, lot-splitting fan-out count, the uninterruptible-stage/shift-boundary
  push, batch rounding, material-availability delay (and shortage warning), safety-stock
  warning, EDD ordering, and due-date delay warnings.
- `backend/tests/test_excel_import.py` — covers a minimal-workbook round trip through
  the scheduler, an export→import round trip against the real `config/*.json`, and
  validation-error cases (missing required sheet, non-numeric field with row number,
  unknown stage reference, duplicate order ID, a stage with no machines, a corrupted
  file).
- `frontend/` — static `index.html` + `app.js` + `style.css`. On load (and on button
  click, with an optional plan-start date) calls `POST /api/plan` and renders: KPI cards,
  a warnings panel, a per-stage/per-machine Gantt chart (each `ScheduledOp` drawn as
  a bar positioned/sized by its start/end time), a **date×shift machine-count matrix**
  (see below), plus per-machine utilization cards. The
  header also has an Excel template download link and an upload button that posts to
  `/api/import`, shows a success summary or a detailed per-row error list, and
  automatically re-runs the plan on success. The date×shift matrix (`renderShiftMatrix`)
  fetches the active shift pattern from `GET /api/equipment`
  (`shift_modes[default_shift_mode]`, cached), rebuilds the concrete shift windows
  client-side (mirroring `shift_calendar.py`'s `_build_windows`, incl. overnight wrap),
  keeps only windows that overlap some op, and shows one row per order with a per-stage
  (工程A/B/C) count of distinct machines running that order in each shift window.

## Known limitations / next steps

- Master data lives in `config/*.json` with no persistence layer / no order-intake
  integration yet.
- The shift calendar assumes the same shift pattern applies to every machine (no
  per-machine or per-day calendar overrides, no holidays).
- Changeover time is charged only against the stage it occurs on; it does not model
  shared setup crews/tooling across machines.

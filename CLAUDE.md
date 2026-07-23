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
  two-shift coverage). Optional `eligibility` (`{product: {stageId: {machineId: "○"|"△"}}}`)
  encodes machine×product producibility: when a product+stage entry exists, only the listed
  machines can run that product there (`△` = conditional, tagged with a note on the op);
  when absent, every machine in the stage is allowed (backward-compatible default). Used by
  real-data lines where not every machine can make every product.
- `config/bottleneck_planning.json` — parameters for the bottleneck daily-flow planner
  (`load_bottleneck_planning` in `config_loader.py`, embedded defaults when absent):
  `lineDailyCapacities` (per shift mode), `bottleneckStage`, `stageFlows` (per-stage
  working-day offsets, plus optional `inputUnit` and `leadOffsetByProduct` (`{機種: offset}`
  — per-product offset overrides that replace the fixed one for those products, the
  WIP/実リード dynamic offsets from Phase 4) — **input granularity**: HAL feeds in
  10,000-unit reels, TAL in 40,000-unit batches, MIL in 1,920-unit inspection lots;
  allocations are multiples of the unit with each lot's remainder absorbed by its final
  feed (機種の台数による調整); TAL/MIL batching is front-loaded per lot in `expand_to_stages`
  so cumulative upstream input never starves the next stage and the lot's completion day is
  preserved), `machineCounts` (per-machine share approximation for stop
  deductions), `aShiftFraction`, `productAliases` (RC-code → 呼称),
  `productDailyCapsByMode` (機種別キャパ) and `nonWorkingDays` (ISO dates — weekday
  非稼働日/祝日/計画休 that `working_days_in_range` excludes on top of weekends; populated from
  the FeliCa 短期投入予定表's grey cells via `/api/bottleneck/apply-calendar`) and
  `shipmentBufferDays` (完成目標 = 出荷日 − this many calendar days; default 2 — the 納期 model,
  see `thm_ledger_import`). Swapping capacities/aliases needs only this file.
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
  *contents* needs no code change at all. `save_bottleneck_calibration(offsets,
  a_shift_fraction, path=None)` writes calibration results back into
  `config/bottleneck_planning.json` (updates `stageFlows[].leadOffsetDays` by stageId +
  `aShiftFraction`, preserves every other field; `path` overridable for tests) — used by
  `/api/bottleneck/apply-calibration`. `save_nonworking_days(days, path=None)` writes the
  FeliCa-derived 非稼働日 list into `nonWorkingDays` (sorted ISO, other fields preserved),
  used by `/api/bottleneck/apply-calendar`. These two are the only code paths that *write*
  the bottleneck config.
- `backend/shift_calendar.py` — `ShiftCalendar`: turns a named shift pattern into a list
  of concrete datetime windows (handles overnight-wrapping shifts like `20:30`→`05:30`)
  and answers "when can a task next start", "does a duration fit in one window"
  (for the stage-2 uninterruptible constraint), and "how much working time exists between
  two timestamps" (used for utilization %).
- `backend/bottleneck_planner.py` — an **alternative planning paradigm** matching how the
  real line is actually planned: rate-based, bottleneck-anchored daily flow (distinct from
  `scheduler.py`'s discrete forward-EDD job scheduling). `plan_bottleneck(demands,
  working_days, shift_capacities)` runs Step 1 (`choose_shift_mode`: period demand ÷
  working days → required daily rate → smallest shift mode that covers it, e.g. 16H=90k/day
  vs 22H=120k/day; when per-product caps are supplied it also checks each product can
  finish within the horizon at that mode's per-product rate, escalating otherwise) and
  Step 2 (`allocate_bottleneck`: fill each working day up to the
  bottleneck/HAL daily capacity, EDD across lots — campaigns form naturally; with
  `product_daily_caps` each product's daily fill is additionally capped by its 機種別キャパ
  (the machine-eligibility consequence), and line capacity a slow product leaves unused is
  filled the same day by other products running in parallel on other machine groups, as on
  the real TA1 plan), returning a per-day×product allocation, per-
  product completion dates, and over-capacity/due-date warnings.
  `plan_bottleneck(..., product_caps_by_mode={mode: {product: daily_cap}})` applies both,
  and **excludes** (with a warning) demands for products with no capacity entry — i.e. no
  eligible machine, like Suica4 (all ×). `working_days_in_range`
  enumerates weekday working days. **Step 3** (`expand_to_stages` / `StageFlowConfig`):
  the HAL daily allocation is expanded to every stage (ANT/TAL/HAL/MIL) by a per-stage
  working-day `lead_offset_days` (upstream negative = fed earlier, bottleneck 0, downstream
  positive = completed later; `StageFlowConfig.offset_for(product)` applies an optional
  per-product `lead_offset_by_product` override — the Phase-4 dynamic offsets), with
  out-of-horizon and per-stage-capacity warnings —
  `plan_bottleneck(..., stage_flows=[...])` attaches `stage_allocation`. **Step 4**
  (`mil_completion_by_order`): the MIL stage's daily flow is grouped by 製番 (出荷ロット =
  `order_id`) into `MilLotCompletion`s (completion day = the lot's last MIL day, plus the
  完成目標 `due_date`=出荷日−buffer / `ship_date`=出荷日 / on-time = completion ≤ 完成目標 when
  demands carry them), attached as `mil_lots` and surfaced as the per-製番 completion table
  (THM 短期投入予定表 form); lots missing the 完成目標 also raise warnings.
  **A-shift-only changeover** (`allocate_bottleneck(..., a_shift_only_switch=True,
  a_shift_fraction=0.5)`): product changeovers (performed by supervisors on TAL/MIL) can
  only happen during the day shift — if the previous campaign ends past `a_shift_fraction`
  of a day's capacity, the next product's start is deferred to the next working morning
  (with a warning); since stage expansion shifts whole days, the boundary lands at the
  same in-day position on TAL/MIL too. Same-product lot changes are exempt.
  **Actuals** (`apply_actuals(demands, actuals)`): subtracts per-製番 production actuals
  from demand so the plan is re-drawn on remaining quantities; fully-covered lots are
  dropped (reported), and actuals whose 製番 matches no demand raise a warning.
  **Progress** (`compute_progress(result, daily_actuals)` → `ProgressRow`s on
  `result.progress`): per-working-day 計画(bottleneck daily total)/計画累計, and — when
  daily actuals are given — 実績/実績累計/差(実績−計画)/進捗(Σ差), matching the 現場 THM 短期
  投入予定表 Sheet1 (計画/実績/差/進捗). Days with no actual leave the actual columns blank.
  **Remedies** (`suggest_remedies(demands, working_days, shift_capacities, plan_kwargs,
  base_result, high_mode="22h")` → `Remedy`s on `result.remedies`): decision support when
  lots miss due dates — how many lates clear if the whole horizon runs 22H
  (`shift_escalation`), the minimum leading working-days to run 22H that clears all
  (`min_high_days`, binary search), the binding 機種 (demand vs 機種別キャパ×working-days,
  `bottleneck_product`), horizon extension (`horizon_extension`) or, when no capacity move
  helps, a due-date-infeasible note (`due_date_infeasible`); on-time plans yield a single
  `ok`. Backed by `plan_bottleneck(..., high_mode, high_mode_days)` — the first N working
  days use `high_mode`'s line + per-product caps (via `allocate_bottleneck`'s
  `product_daily_caps_by_day` / `daily_capacity_by_day`; stop-reduced days are left as-is).
  **Equipment stops** (`EquipmentStop` / `apply_equipment_stops`): enabled (有効=Y) stop
  rows (期間×勤務×設備, methods 全停止/時間控除/停止率控除, plus 補正後Cap as a per-day
  ceiling) are converted into per-day bottleneck capacity overrides — one machine's share
  is approximated as line capacity ÷ the stage's machine count, half-days honoured via
  開始/終了勤務; stops on non-bottleneck stages emit an advisory warning only.
  `plan_bottleneck(..., equipment_stops=[...], machine_counts=...)` applies them via
  `allocate_bottleneck(daily_capacity_by_day=...)` (a zero-capacity day produces nothing
  and the next day's restart counts as a changeover).
  **Changeovers/campaigns** (`Campaign` / `derive_campaigns(cells, working_days,
  stage_order)` → `result.campaigns`): from the final per-stage×機種×day allocation, groups
  each 機種 into campaigns = maximal runs of consecutive working days (a skipped working day
  starts a new campaign = re-setup). `is_changeover` = the working day immediately before the
  campaign's start had production on that stage (a switch *from* another 機種); a first-day or
  post-idle start is a 立上げ, not a changeover. `plan_bottleneck` fills `result.campaigns`
  from `stage_allocation` (all stages) or, without stage expansion, the bottleneck stage.
  The A-shift-only switch deferrals stay as warnings tagged `A_SHIFT_DEFERRAL_TAG` (module
  constant, counted for the summary).
- `backend/thm_ledger_import.py` — converts the real **THM 生産台帳** (`.xlsx`, orders with
  完成品名/完成予定数/完成予定日) into `DemandItem`s for the bottleneck planner. The lot
  identifier (`order_id`) is the **製番 column** (same key as the shop-floor MIL tables;
  falls back to № only when 製番 is empty/"-"). Also holds
  `PRODUCT_DAILY_CAPS_BY_MODE` (`{shift mode: {機種呼称: daily cap}}` for 22h/16h/11h/8h,
  from the CAP 表's 機種別キャパ column — the per-product line rate that already embodies
  the machine×product eligibility, e.g. Lite-S 30,720/day at 16H; Suica4 absent = not
  producible), fed to `plan_bottleneck(product_caps_by_mode=...)`. `resolve_product` maps a 完成品名/コード to
  a 機種呼称 by longest-prefix match against
  `PRODUCT_ALIASES` (RC-code → 呼称, derived from the CAP 機種一覧; the ICチップ column is
  deliberately not used since it can't distinguish さそり金融/交通). `parse_thm_ledger`
  reads the 台帳 sheet (header row 2), optionally filters to future-due orders and specific
  production lines, and returns `(demands, unmapped_rows)`. **納期の捉え方**: the true 納期 is
  the ledger's **出荷日**; completion should finish `shipment_buffer_days` (default 2, calendar
  days) earlier, so each `DemandItem.due_date` (= completion target used for EDD / lateness) =
  出荷日 − buffer, and `ship_date` carries the raw 出荷日 for display. Rows with no 出荷日 fall
  back to 完成予定日 (no buffer). The future-due filter (`only_due_on_or_after`) is applied to
  this completion target. `parse_actuals` reads an
  optional 「実績」 sheet (columns 製番/実績数, duplicates summed) from the same workbook,
  feeding `apply_actuals` for plan revision against actuals. `parse_daily_actuals` reads an
  optional 「日次実績」 sheet (日付/[工程]/実績数, summed per day across stages) for the
  progress view (distinct from the per-製番 `parse_actuals`). `parse_equipment_stops` reads
  a 設備停止マスタ sheet (`01_設備停止マスタ` or `設備停止`, 有効=Y rows only) from either
  the ledger workbook or the real stop-master workbook into `EquipmentStop`s.
  **実績 from the shop-floor plan files** (red font = 実績, black = 予定):
  `parse_thm_shortterm_actuals` reads the **THM短期投入予定表** (sheet `TA1`; per-製番
  Line-In=TAL / Completion=MIL row pairs) and sums each row's **red-font** date cells into
  `{製番: {"TAL", "MIL"}}` — the MIL total is the per-製番 完成実績 (→ `apply_actuals` demand
  reduction). `parse_ta1_hal_actuals(file, year)` reads the **TA1_投入計画** (sheet `生産計画`;
  per-機種 blocks, col1 stage labels, row1 月 carried forward + row2 日) and sums the **HAL**
  rows' red-font cells into `{date: HAL実績}` (→ the 進捗 daily 実績 line). Both are robust to
  layout (row-role / stage-label + red-font), no fixed date-column mapping for THM短期.
- `backend/felica_calibration.py` — validates a generated plan against the real production
  plan (FeliCa) and calibrates the stage offsets / A-shift fraction. `parse_felica_plan`
  reads the FeliCa workbook (`YYYYMM_CTA{1,2}` sheets; per-製番 `Line-In`=投入/start and
  `Completion`=完成/≈MIL daily rows, merged across sheets) into `FelicaLot`s. **Carryover
  exclusion**: a day carrying **both** a Line-In and a Completion value for the same 製番 is
  先週までの計画台数 (投入=完成同日はリードタイム0で実生産ではない) and is dropped from both
  series before computing `line_in_first`/`completion_last` (fully same-day lots vanish).
  `parse_felica_nonworking_days` reads the date-header (row 3) cells whose fill is `gray125`
  (非稼働日) and returns the **weekday** ones (祝日/計画休 beyond weekends, e.g. 海の日 7/20,
  山の日 8/11, お盆 8/14) for the calendar reflect flow.
  `compare_plans(result, felica, working_days, aliases=None)` → `ComparisonReport`: per-製番
  completion-day and ANT-start-day differences (in working-day indices) vs FeliCa → matched
  count, MAE and bias for both, plus **windowed** daily-shape MAE (MIL vs Completion, ANT vs
  Line-In) — `_windowed_daily_mae` limits the daily comparison to the two series' overlapping
  active-day range so a plan window that only partly overlaps FeliCa's month no longer inflates
  the number (union-of-all-days would; e.g. 66k→38k on the real files). With `aliases` it also
  fills `daily_shape_by_product` (`{呼称: {completion_mae, line_in_mae, days}}`, FeliCa RC-code
  resolved via `resolve_product`, our per-機種 series from `stage_allocation.product`) — the
  per-機種 breakdown that shows *which* 機種's day-by-day plan diverges most (さそり金融 is
  the worst on the real files). `calibrate`
  grid-searches ANT/TAL/MIL offsets (HAL fixed 0) and A-shift fraction to minimise
  completion+start MAE (re-running `plan_bottleneck` with `equipment_stops` disabled),
  returning the current vs best error and the recommended offsets/fraction (advisory —
  `config/bottleneck_planning.json` is not auto-edited). `derive_stage_offsets` computes
  **per-product** offsets from FeliCa's own 投入→完成 span (median working-days per 機種,
  resolved to 呼称), split around HAL by the current offset ratio — kept (and unit-tested) but
  **no longer surfaced** by `/validate`: on the real files it (and any per-product
  offset-fit) *raised* error, because the residual per-機種 timing error is HAL campaign
  sequencing, not lead-time — correcting it via offsets requires physically-impossible values
  (投入 after HAL / 完成 before HAL). Verified: 32 matched 製番, global calibration got
  completion MAE 3.12→2.66 working days; the remaining per-機種 bias is now shown as a
  diagnostic (`timing_by_product`) rather than auto-corrected.
- `backend/bottleneck_export.py` — renders a `BottleneckPlanResult` into a `.xlsx` matching
  the two shop-floor tables: `生産計画(機種×日)` (per-機種 rows split by stage ANT/TAL/HAL/MIL,
  columns = working days — the TA1_生産計画 form) and `製番別MIL` (one row per 製番/出荷ロット
  with MIL completion day, 出荷日(納期), 完成目標(=出荷日−buffer), on-time verdict — the THM
  短期投入予定表 form; MIL cells tinted orange, late lots red), `進捗` (計画/計画累計/実績/実績累計/差/進捗 per working day,
  negative-progress cells red — the Sheet1 form), `段取り` (one row per campaign: 工程/機種/
  開始日/終了日/日数/数量/区分, changeover rows tinted red — from `result.campaigns`), `提案`
  (`suggest_remedies` output when lots are late), plus サマリー and 警告.
  `export_bottleneck_workbook(result, demands, stage_order)`.
- `backend/scheduler.py` — the `Scheduler` class: finite-capacity, multi-machine forward
  scheduling. Orders are sorted by **EDD** (earliest due date). For each order: raw
  material availability may push back the earliest start; each pre-split stage picks
  whichever machine is ready soonest **among the machines eligible to produce that
  product** (per `equipment.eligibility`; a `△` pick is tagged "条件付き設備" on the op);
  after the configured split stage, the order is divided into
  parallel sub-lots that flow independently through the remaining stages (each may land
  on a different machine); the uninterruptible stage must fit entirely in one shift
  window (pushing to the next valid window otherwise); the rounding stage rounds
  quantity up before computing duration. Before scheduling an order it pre-checks every
  stage for at least one eligible machine; if any stage has none (a product no machine
  can make) the whole order is skipped with a warning rather than partially scheduled.
  Warns when a product's on-hand + incoming
  material can't cover demand, when an order's completion misses its due date, and when
  current stock is below safety stock. Also has a `__main__` block used as a CI smoke
  test (`python3 scheduler.py`) that runs the algorithm against `config/` and prints a
  summary — must keep working without exceptions.
- `backend/excel_import.py` — converts between `config/*.json` and a single `.xlsx`
  workbook with fixed sheet names/columns: `Stages`, `Machines`, `LotSplitting`,
  `ShiftModes`, `Settings` (key/value: `defaultShiftMode`, `planStart`), `Changeover`,
  `AShiftOnlyTransitions`, `Eligibility` (optional: `product`/`stageId`/`machineId`/`mark`
  where `mark` ∈ `○`/`△`/`×`; `×` rows are dropped, `○`/`△` populate
  `equipment.eligibility`), `Orders`, `Inventory`, `RawMaterials`,
  `RawMaterialIncoming`. `export_workbook()` builds a workbook pre-filled with the
  current `config/*.json` contents (used as a downloadable template).
  `parse_workbook()` reads an uploaded workbook, validates every row (collecting all
  issues — sheet name, row number, message — rather than stopping at the first one),
  and returns JSON-shaped dicts; on any validation failure it raises
  `ImportValidationError` and *nothing* is written. `save_config()` writes the parsed
  dicts to `config/*.json` (only called after validation succeeds).
- `backend/plan_export.py` — converts a `PlanResult` into a single `.xlsx` **plan
  output** workbook (distinct from `excel_import.py`, which handles master-data
  *input*). `export_plan_workbook(result, equipment)` builds four sheets —
  `サマリー` (KPIs: plan start, order count, op count, warning count),
  `スケジュール明細` (one row per `ScheduledOp`, start/end as datetime cells),
  `日付×シフト台数` (the same date×shift machine-count matrix as the frontend, computed
  server-side by reusing `ShiftCalendar._build_windows`; date header merged across its
  shift columns; cells show `工程A/工程B/工程C` counts tinted by the busiest stage), and
  `警告`. Deliberately excludes machine utilization.
- `backend/main.py` — FastAPI app. `GET /api/equipment`, `GET /api/orders`,
  `POST /api/plan` (optional `start_date`, defaults to today; reloads `config/*.json`
  fresh on every call and returns the `PlanResult`), `POST /api/plan/export` (same
  inputs as `/api/plan` but streams the `plan_export` `.xlsx` as an attachment named
  `production_plan_YYYYMMDD.xlsx`), `POST /api/bottleneck/export` (multipart THM 台帳
  `.xlsx` upload + optional `start_date`/`end_date`/`lines`/`future_only` form fields;
  parses the ledger — applying the optional 「実績」 sheet so the plan is re-drawn on
  remaining quantities, and equipment stops from an optional `stops_file` upload or a
  停止マスタ sheet inside the ledger — then runs the HAL-bottleneck daily flow planner
  with all parameters from `config/bottleneck_planning.json` (`a_shift_only_switch=True`,
  機種別キャパ constraint, per-day stop-adjusted capacities) and streams
  the `bottleneck_export` `.xlsx` as
  `bottleneck_plan_YYYYMMDD.xlsx`; the サマリー gains 実績反映製番数/実績控除数量/
  設備停止反映件数 rows when applicable; an optional 「日次実績」 sheet drives the 進捗 sheet),
  optional `thm_plan_file` (THM短期投入予定表 → per-製番 MIL完成実績 folded into `apply_actuals`)
  and `ta1_file` (TA1_投入計画 → HAL日別実績 into the 進捗 実績 line, year=plan_start.year, in
  plan window) uploads reflect real actuals when supplied;
  `POST /api/bottleneck/plan` (same multipart inputs,
  returns the plan as JSON — shift mode, per-stage×day allocation, per-製番 MIL lots,
  per-day 進捗 (`progress` + `has_actuals`), `campaigns` (段取り/切替 per stage), 納期遅れ解消の
  `remedies`, warnings, summary (with 切替回数 / A勤限定切替の翌朝繰下げ counts in `extra`) —
  for on-screen rendering; shares `_build_bottleneck_plan` with the export route),
  `POST /api/bottleneck/validate` (multipart THM 台帳 + FeliCa 実計画; runs
  `felica_calibration` and returns current vs recommended global offset/A-shift error
  metrics (incl. the windowed daily-shape line totals) plus a top-level
  `daily_shape_by_product` (per-機種 windowed daily-shape MAE — mostly structural, see below)
  and `timing_by_product` (per-機種 completion/start-day **bias** our−FeliCa, +=our runs late /
  −=early, sorted by |completion_bias| — the actionable diagnostic showing which 機種 the model
  systematically mis-times; both from a direct `compare_plans(..., aliases=cfg.product_aliases)`
  on the base plan since `calibrate` doesn't thread aliases) as JSON. Note on the two shape
  metrics: FeliCa books each 出荷ロット's whole quantity as a lump on its completion day while
  our MIL is a smoothed rate, so `daily_shape_by_product` is largely a structural lump-vs-rate
  difference (not a fixable planning error) — surfaced as 参考; the per-機種 completion residual
  is driven by HAL **campaign sequencing** (low-cap 機種 like Lite-S finish late) and can't be
  fixed by per-product offsets (a bias-correction would need 投入-after-HAL / 完成-before-HAL
  offsets — physically impossible), which is why the discredited span-based
  `derive_stage_offsets` recommendation is no longer surfaced),
  `POST /api/bottleneck/apply-calibration` (JSON `{offsets, a_shift_fraction}` — typically the
  validate route's `recommended_offsets`/`recommended_a_shift_fraction`; validates the keys
  against the current stageFlows and the ranges (offset −15..15, fraction 0..1), then calls
  `config_loader.save_bottleneck_calibration` to write `stageFlows[].leadOffsetDays` +
  `aShiftFraction` back into `config/bottleneck_planning.json` — preserving inputUnit / caps /
  aliases / comment — so the next 立案・照合 picks them up; the one-click reflect of the
  calibration recommendation),
  `POST /api/bottleneck/apply-calendar` (multipart `felica_file`; reads the FeliCa grey
  非稼働日 via `parse_felica_nonworking_days` and writes `nonWorkingDays` into config via
  `save_nonworking_days`, so later plans exclude 祝日/計画休 from working days),
  `POST /api/import` (multipart
  `.xlsx` upload; 422 with a list of `{sheet, row, message}` on validation failure,
  otherwise overwrites `config/*.json` and returns import counts), and
  `GET /api/import/template` (downloads the current config as a pre-filled `.xlsx`).
  Mounts `frontend/` at `/`.
- `backend/tests/test_scheduler.py` — unit tests using small synthetic
  equipment/changeover/orders fixtures (not the sample config) covering: earliest-ready
  machine selection, changeover time being consumed before a run starts, A-shift-only
  transitions, lot-splitting fan-out count, the uninterruptible-stage/shift-boundary
  push, batch rounding, material-availability delay (and shortage warning), safety-stock
  warning, EDD ordering, due-date delay warnings, and machine×product **eligibility**
  (restriction to producible machines, order-skip-with-warning when no machine can make a
  product, the `△` conditional note, and the all-allowed backward-compatible default).
- `backend/tests/test_excel_import.py` — covers a minimal-workbook round trip through
  the scheduler, an export→import round trip against the real `config/*.json`, and
  validation-error cases (missing required sheet, non-numeric field with row number,
  unknown stage reference, duplicate order ID, a stage with no machines, a corrupted
  file), plus the optional `Eligibility` sheet (parsing, `×`-drop, unknown-machine error).
- `backend/tests/test_bottleneck_planner.py` — covers working-day enumeration (weekends
  excluded), shift-mode selection (smallest sufficient / escalation to 22H), daily-capacity
  ceiling, campaign-style EDD allocation with per-product completion dates, over-capacity
  warning, a July-like end-to-end plan (16H / 90k per day), stage expansion
  (`expand_to_stages`: upstream/downstream offsets, out-of-horizon and per-stage-capacity
  warnings), MIL per-製番 completion (`mil_completion_by_order`: per-lot completion
  days, due-date on-time flag, and overrun warning), actuals application (`apply_actuals`:
  remaining-quantity reduction, completed-lot drop, unknown-製番 warning), the
  A-shift-only changeover (deferral past `a_shift_fraction`, same-day switch within the
  A shift, same-product exemption), per-product capacity (daily-cap ceiling with
  same-day parallel fill by other products, exclusion of cap-less products, and shift-mode
  escalation when a single product can't finish at the smaller mode), equipment stops
  (machine-share deduction with 勤務 half-day bounds, 補正後Cap ceiling, non-bottleneck
  advisory, and end-to-end reduced-capacity days in `plan_bottleneck`), progress
  (`compute_progress`: plan-cumulative only without actuals; 差/進捗 累計 with daily actuals),
  remedies (`suggest_remedies`: full-22H escalation, min-22H-days search, all-on-time
  `ok`; `high_mode_days` raising only the leading days' capacity), and campaigns/changeovers
  (`derive_campaigns`: consecutive-day grouping, gap → new campaign, `is_changeover` true only
  when the prior working day ran another 機種 on the stage; `plan_bottleneck` populates
  `result.campaigns`).
- `backend/tests/test_thm_ledger_import.py` — covers longest-prefix product resolution
  (incl. slash-less suffix codes), 台帳→demand extraction with an unmapped-row report
  (order_id = 製番, № fallback), future-due / production-line filtering, the 納期 model
  (due_date = 出荷日 − shipment_buffer_days with `ship_date` kept; configurable buffer;
  fallback to 完成予定日 when 出荷日 absent), 「実績」-sheet
  parsing (duplicate summing, missing-sheet default), 日次実績 parsing (per-day summing across
  stages, missing-sheet default), THM短期投入予定表 実績 (`parse_thm_shortterm_actuals`:
  per-製番 red-font TAL/MIL sums, black 予定 ignored) and TA1 HAL 実績
  (`parse_ta1_hal_actuals`: red-font HAL per day with 月→年 rollover), 設備停止マスタ parsing (有効=Y
  filter, missing-sheet default), `load_bottleneck_planning` config reading,
  `save_bottleneck_calibration` (offset/A-shift write-back on a tmp config, other fields
  preserved), and `save_nonworking_days` (nonWorkingDays write-back, sorted, other fields kept).
- `backend/tests/test_apply_calibration_api.py` — TestClient coverage of
  `POST /api/bottleneck/apply-calibration` (success path writes the real config then restores
  it in a `finally`; 422 cases: bad stage key, out-of-range fraction, extreme offset) and
  `POST /api/bottleneck/apply-calendar` (a synthetic gray125 FeliCa writes `nonWorkingDays`,
  config restored in `finally`; bad-file → 400).
- `backend/tests/test_bottleneck_export.py` — asserts the exported workbook's sheet list
  (incl. the `段取り` sheet), the 機種×日 matrix lists every product with all stage rows, the
  製番別MIL sheet has the 出荷日(納期)/完成目標/判定 columns and flags 完成目標 overruns, and the 段取り sheet has one row
  per campaign with 立上げ/切替 区分.
- `backend/tests/test_felica_calibration.py` — covers FeliCa parsing (per-製番 Line-In/
  Completion), `compare_plans` completion-day diff/bias against a synthetic FeliCa, the
  windowed daily-shape MAE (non-overlap tails excluded → smaller than the union version), the
  per-機種 `daily_shape_by_product` breakdown (matching 機種 = 0, perturbed 機種 > 0, via
  `aliases`; empty when `aliases` omitted), the per-機種 `timing_by_product` signed bias
  (our-later 機種 completion_bias > 0, our-earlier < 0; empty without `aliases`), `calibrate`
  picking offsets that reduce the error
  toward a known-truth plan, `derive_stage_offsets` computing per-product offsets from the
  投入→完成 span split by the current ratio, `parse_felica_nonworking_days` returning only
  the weekday gray125 date-header cells (weekends excluded), and the same-day carryover
  exclusion (`parse_felica_plan` drops days with both Line-In and Completion: fully-same-day
  lots → None first/last; partial → only the shared day removed).
- `backend/tests/test_plan_export.py` — runs the scheduler against the real
  `config/*.json` and asserts the exported workbook has exactly the four expected sheets
  (no utilization sheet), the schedule sheet row count matches the schedule, the matrix
  sheet lists every order and contains a split-lot cell (stage B/C count of 4), and the
  warnings sheet is populated.
- `frontend/` — static `index.html` + `app.js` + `style.css`. On load (and on button
  click, with an optional plan-start date) calls `POST /api/plan` and renders: KPI cards,
  a warnings panel, a per-stage/per-machine Gantt chart (each `ScheduledOp` drawn as
  a bar positioned/sized by its start/end time), a **date×shift machine-count matrix**
  (see below), plus per-machine utilization cards. The
  header also has an Excel template download link, an upload button that posts to
  `/api/import` (shows a success summary or a detailed per-row error list, then
  automatically re-runs the plan **and downloads the plan-result `.xlsx`** on success),
  and a **「計画をExcel出力」** button (`exportPlan`) that posts to `/api/plan/export`
  and downloads the returned workbook as a file (filename taken from
  `Content-Disposition`), plus a **「台帳→ボトルネック計画」** flow: uploading a THM 台帳
  (with an optional `ライン` filter) posts to `/api/bottleneck/plan` and renders the
  bottleneck plan on-screen in a dedicated panel (`#bn-panel`) — a KPI row, warnings, the
  **生産計画(機種×日)** matrix (rows = 機種 × 工程 ANT/TAL/HAL/MIL, stage-coloured, sticky
  first two columns; columns = working days; **campaign-start cells marked** — red left border
  for a 段取り替え/切替, grey for a 立上げ — with a per-stage 切替回数 summary line below, from
  `campaigns`), the **製番別MIL完成予定** table (出荷日(納期)/完成目標(=出荷日−buffer)/判定
  columns, late-vs-完成目標 lots highlighted) and a **進捗** table (計画/計画累計/実績/実績累計/差/進捗 per day, negative in
  red; shown when the ledger has a 「日次実績」 sheet, else plan-cumulative only) and a
  **納期遅れ 解消の提案** panel (`suggest_remedies`, shown only when lots are late), and a
  **実計画(FeliCa)との照合** panel — the **「実計画と照合(精度検証)」** button uploads a FeliCa
  workbook (with the stored ledger) to `/api/bottleneck/validate` and shows current vs
  recommended offset/A-shift error (完成日/投入日 MAE・バイアス), a **機種別 予実タイミング差**
  table (per-機種 completion/start-day bias, +=late/−=early, |bias|≥2 tinted red — the primary
  per-機種 diagnostic) and a secondary **機種別 日次形状の予実差** table (labelled 参考 since it
  is mostly structural lump-vs-rate); when the recommendation differs from the
  current config a **「推奨値をconfigに反映」** button (`#bn-apply-calibration`) posts the
  recommended offsets/A-shift fraction to `/api/bottleneck/apply-calibration` to write them
  into `config/bottleneck_planning.json` in one click (hidden — with a "既に較正済み" note —
  when config already equals the calibration optimum), plus a
  **「この計画をExcel出力」** button that re-posts the stored file to
  `/api/bottleneck/export`, and a **「非稼働日カレンダー取込(FeliCa)」** button
  (`#bn-apply-calendar`) that uploads a FeliCa workbook to `/api/bottleneck/apply-calendar`
  (writes the grey 非稼働日 into config) and re-plans from the stored ledger so 祝日/計画休
  drop out of the matrix columns, plus **「実績取込:THM短期(MIL)」** (`#bn-thm-actuals`) and
  **「実績取込:TA1(HAL)」** (`#bn-ta1-actuals`) buttons that store a THM短期投入予定表 /
  TA1_投入計画 file (`lastThmPlanFile`/`lastTa1File`, sent with every plan/export POST via
  `appendActualsFiles`) and re-plan so the red-font 実績 reduce demand (MIL) / fill the 進捗
  実績 line (HAL). The discrete-scheduler view and this bottleneck view coexist on
  the page. The
  date×shift matrix (`renderShiftMatrix`)
  fetches the active shift pattern from `GET /api/equipment`
  (`shift_modes[default_shift_mode]`, cached), rebuilds the concrete shift windows
  client-side (mirroring `shift_calendar.py`'s `_build_windows`, incl. overnight wrap),
  keeps only windows that overlap some op, and shows one row per order with a per-stage
  (工程A/B/C) count of distinct machines running that order in each shift window.

## Known limitations / next steps

- Master data lives in `config/*.json` with no persistence layer / no order-intake
  integration yet.
- The shift calendar assumes the same shift pattern applies to every machine (no
  per-machine or per-day calendar overrides). Non-working days (祝日/計画休) are supported for
  the bottleneck planner via `config.nonWorkingDays` (populated from FeliCa's grey cells), but
  the discrete `scheduler.py` still only skips weekends.
- Changeover time is charged only against the stage it occurs on; it does not model
  shared setup crews/tooling across machines.

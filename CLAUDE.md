# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current State

`ms` is a production planning automation ("生産計画の自動立案") tool: a Python/FastAPI
backend with a finite-capacity scheduling engine, and a minimal static HTML/JS frontend
that calls the API. Order and work-center data is currently mocked
(`backend/mock_data.py`); swapping in a real data source (DB/CSV/external API) is future
work.

## Commands

All backend commands assume `cd backend` first (imports are plain, non-package-relative,
matching the existing CI workflow at `.github/workflows/scheduler-test.yml`).

- Install dependencies: `pip install -r backend/requirements.txt`
- Run the scheduler smoke test directly: `cd backend && python3 scheduler.py`
- Run the API + frontend locally: `cd backend && uvicorn main:app --reload` then open
  `http://localhost:8000/`
- Run tests: `cd backend && pytest` (or a single test:
  `cd backend && pytest tests/test_scheduler.py::test_edd_priority_gives_earlier_due_date_the_capacity`)

There is no separate frontend build step — `frontend/` is static HTML/CSS/JS served
directly by FastAPI's `StaticFiles` mount.

## Architecture

- `backend/models.py` — dataclasses for the domain: `Order`, `ProcessStep` (a routing
  step), `WorkCenter` (a process/machine group with daily regular + overtime capacity and
  cost rates), and the output shapes `StepSchedule` / `OrderSchedule` / `PlanSummary` /
  `PlanResult`.
- `backend/scheduler.py` — the `Scheduler` class: finite-capacity forward scheduling.
  Orders are sorted by **EDD** (earliest due date, then priority, then order ID) and each
  order's routing steps are allocated day-by-day against each work center's remaining
  regular capacity, spilling into overtime capacity (at a higher cost rate) before moving
  to the next business day (weekends are skipped). Also has a `__main__` block used as a
  CI smoke test (`python3 scheduler.py`) that runs the algorithm against
  `backend/mock_data.py` and prints a summary — must keep working without exceptions.
- `backend/mock_data.py` — sample orders and work centers standing in for real master
  data.
- `backend/main.py` — FastAPI app. `GET /api/orders`, `GET /api/work-centers`, and
  `POST /api/plan` (accepts optional `orders`/`work_centers`/`start_date`, falls back to
  mock data). Mounts `frontend/` at `/`.
- `backend/tests/test_scheduler.py` — unit tests covering regular-capacity allocation,
  overtime spillover, EDD prioritization between competing orders, weekend skipping,
  multi-step routing ordering, delay detection, and unknown-process errors.
- `frontend/` — static `index.html` + `app.js` + `style.css`. On load (and on button
  click) calls `POST /api/plan` and renders: summary stat cards, a per-order schedule
  table with on-time/delay badges, a per-work-center regular/overtime load bar, and a
  flat table of every routing step's allocation.

## Known limitations / next steps

- Master data (orders, work centers/routings) is mocked; no persistence layer yet.
- The scheduler treats each order's routing as strictly sequential with no
  parallel/overlapping steps, and does not model per-order setup/changeover time between
  jobs on the same work center.

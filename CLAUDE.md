# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current State

This repository (`ms`) is in an early bootstrap stage. It contains a minimal
Python backend plus the GitHub Actions workflows that exercise it. The first
real feature is a daily stats report for Japanese Major League players.

Tracked files:

- `CLAUDE.md` — this guidance file.
- `.github/workflows/scheduler-test.yml` — CI workflow triggered on every
  `push` and `pull_request`.
- `.github/workflows/mlb-daily.yml` — scheduled (daily cron) + manual workflow
  that generates & commits the report and publishes the web page to GitHub Pages.
- `backend/scheduler.py` — the scheduler scaffold and entry point run by CI.
- `backend/mlb_stats.py` — MLB Stats API client + Markdown/HTML formatters.
- `backend/test_mlb_stats.py` — offline unit tests for the formatters.
- `backend/reports/` — generated Markdown reports (`YYYY-MM-DD.md`, `latest.md`).
- `backend/site/` — generated `index.html` for GitHub Pages (built by CI, **not
  committed**; see `.gitignore`).

Everything uses only the Python standard library, so there is still no
dependency manifest (`requirements.txt`).

## CI Workflow and Expected Layout

The `Scheduler Test` workflow (`.github/workflows/scheduler-test.yml`)
describes the project layout the repository is being built toward, even
though those files do not exist yet. On each `push` and `pull_request` it:

1. Checks out the repository.
2. Sets up Python (`3.x`).
3. From the `backend/` directory, installs dependencies with
   `pip install -r requirements.txt` **if** `backend/requirements.txt` exists
   (the step is skipped when the file is absent).
4. From the `backend/` directory, runs `python3 scheduler.py`.

The current structure is a Python backend:

```
backend/
  scheduler.py        # entry point the workflow executes
  mlb_stats.py        # MLB Stats API client + Markdown/HTML report formatters
  test_mlb_stats.py   # offline unit tests for the formatters
  reports/            # generated reports: YYYY-MM-DD.md and latest.md (committed)
  site/               # generated index.html for GitHub Pages (CI-built, gitignored)
  requirements.txt    # optional; installed only if present (not present yet)
```

The `Scheduler Test` workflow passes as long as `cd backend && python3
scheduler.py` exits cleanly (status `0`). Because CI invokes the entry point
with **no arguments**, keep the default path offline and non-blocking: it runs
any pending tasks once and exits. Networked work (the MLB report) lives behind
an explicit flag, and the long-running loop behind `--daemon`; CI uses neither.
Add `backend/requirements.txt` only when a third-party dependency is actually
introduced.

## Japanese MLB Stats Report

The first real feature fetches season statistics for active Japanese MLB
players and writes a daily Markdown report.

- **Data source:** the public [MLB Stats API](https://statsapi.mlb.com)
  (`statsapi.mlb.com`, free, no API key), called with `urllib` — no
  third-party dependency.
- **`backend/mlb_stats.py`** is split into two layers:
  - *Network layer* (`fetch_japanese_players`, `fetch_player_stats`,
    `collect_stats`) — live HTTP; auto-detects players via `birthCountry ==
    "Japan"`. Runs where outbound HTTPS is available (GitHub Actions).
  - *Formatting layer* (pure functions) — `format_report` produces the Japanese
    Markdown report; `format_html` produces a self-contained HTML page (inline
    CSS, responsive, light/dark) for the web app. Both are covered by offline
    tests and reuse the same structured data from `collect_stats`.
- **Run it:** `python3 scheduler.py --mlb-report` (optionally `--season YYYY`,
  `--output-dir DIR`, `--site-dir DIR`). Writes `backend/reports/{YYYY-MM-DD}.md`
  and `latest.md` (committed history) plus `backend/site/index.html` (the page
  published to Pages).
- **Automation:** `.github/workflows/mlb-daily.yml` runs daily (cron
  `0 13 * * *` ≈ 22:00 JST) and on manual `workflow_dispatch`. The `build` job
  generates the report, commits the Markdown back to the repo
  (`contents: write`), and uploads `backend/site` as a Pages artifact; the
  `deploy` job publishes it to GitHub Pages (`pages: write`, `id-token: write`).

### Web app (GitHub Pages)

The daily HTML page is served at `https://hayuo8ll-del.github.io/ms/`. HTML is
**not committed** — it is built by CI and published as a Pages artifact, so
`backend/site/` is gitignored.

**One-time setup (cannot be done in code):** in the repository **Settings →
Pages**, set **Source** to **"GitHub Actions"**. Until this is set, the `deploy`
job cannot publish. Pages deploys run from the default branch after merge.

## Development Workflow

- **Language / runtime:** Python 3 (per the CI workflow; standard library only).
- **Run locally:**
  ```bash
  cd backend
  pip install -r requirements.txt   # only if requirements.txt is present
  python3 scheduler.py              # run pending tasks once and exit (CI mode)
  python3 scheduler.py --daemon     # run continuously; Ctrl+C to stop
  python3 scheduler.py --mlb-report # generate the report + web page (index.html)
  python3 scheduler.py --help       # list flags (--site-dir, --season, ...)
  ```
- **Test:** offline unit tests for the report formatter use the standard
  library `unittest` (no network, no extra deps):
  ```bash
  cd backend
  python3 -m unittest                       # discover and run all tests
  python3 -m unittest test_mlb_stats -v     # a single module, verbose
  python3 -m unittest test_mlb_stats.FormatReportTests.test_empty_data_does_not_raise
  ```
  The `--mlb-report` network path is exercised in GitHub Actions (via
  `mlb-daily.yml`), not by the offline tests. `scheduler-test.yml` still only
  checks that the default `python3 scheduler.py` runs to completion, so keep
  that entry point runnable and non-blocking in CI.
- **Build / lint:** No build or lint commands are defined yet.

## Instructions for Future Sessions

As the codebase grows, keep this file accurate. In particular, update it to
include:

- The project's language, framework, and package manager, along with the exact
  commands to install dependencies, build, lint, and run tests (including how
  to run a single test).
- A high-level description of the architecture as it emerges — especially what
  `scheduler.py` does and how the `backend/` is organized.
- Any change to CI: if the workflow gains lint/test steps or the expected file
  layout changes, reflect it here so the two stay in sync.

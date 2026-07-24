# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current State

This repository (`ms`) is in an early bootstrap stage. It contains almost no
application code yet — only a GitHub Actions workflow that anticipates code
that has not been written.

Tracked files:

- `CLAUDE.md` — this guidance file.
- `.github/workflows/scheduler-test.yml` — a CI workflow triggered on every
  `push` and `pull_request`.

There is no application source, dependency manifest, or test suite committed
yet.

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

This implies the intended structure is a Python backend:

```
backend/
  scheduler.py        # entry point the workflow executes
  requirements.txt    # optional; installed only if present
```

**Important:** The workflow currently fails, because `backend/scheduler.py`
does not exist. The first backend commit should create `backend/scheduler.py`
(and `backend/requirements.txt` if any third-party packages are needed) so
that `cd backend && python3 scheduler.py` runs cleanly. Until then, expect
red CI on every push and pull request.

## Development Workflow

- **Language / runtime:** Python 3 (per the CI workflow).
- **Run locally (once `backend/scheduler.py` exists):**
  ```bash
  cd backend
  pip install -r requirements.txt   # only if requirements.txt is present
  python3 scheduler.py
  ```
- **Build / lint / test:** No build, lint, or test commands are defined yet.
  The workflow's only check is that `python3 scheduler.py` runs to completion,
  so keep that entry point runnable in CI. When a real test suite is added,
  update both this file and the workflow to run it.

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

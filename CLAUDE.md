# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current State

This repository hosts **なつやすみ スタディ** — a summer-vacation study PWA for
Japanese elementary school 1st and 5th graders. It is a dependency-free static
web app (vanilla HTML/CSS/JavaScript); there is no build step, no package
manager, and no test framework configured.

## Running / Developing

Service Worker requires an HTTP origin (not `file://`):

```bash
python3 -m http.server 8000   # then open http://localhost:8000/
```

There are no lint or automated test commands. When verifying changes, drive the
app in a browser (Playwright works: Chromium at `/opt/pw-browsers/chromium`).
The math generators in `js/generators.js` are pure functions and can be
answer-checked by evaluating the file in Node.

## Architecture

Single-page app; screens are rendered by swapping `#screen`'s innerHTML from JS.

- `index.html` — shell (topbar + `#screen`) and script tags.
- `js/data.js` — non-math question banks (`DATA[grade][subject]`), `BADGES`, `SUBJECTS`.
- `js/generators.js` — math question generators (`MATH_G1`/`MATH_G5`, `generateMathSet`), plus SVG helpers for the clock and area figures. Multiple-choice items live in `DATA`; numeric items use the on-screen keypad.
- `js/app.js` — app core: state model, screen renderers (grade select, home, quiz round, result, badges, parent), scoring, badges, streak, and persistence.
- State is a single object persisted to `localStorage` under `natsuyasumi_v1`, with a separate profile per grade (`g1`/`g5`).
- `manifest.webmanifest` + `sw.js` provide the PWA/offline layer; `sw.js` uses a cache-first strategy and lists all app assets in `ASSETS` — **update that list when adding or renaming files**.
- `icons/icon.svg` is the sole app icon (SVG).

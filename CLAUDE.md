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
- `js/data.js` — non-math question banks (`DATA[grade][subject]`), `BADGES`, `SUBJECTS`, `SHOP` (avatars + color themes), and `WRITING_SETS` (かきとり character sets: hiragana/katakana/kanji as `{c, yomi}`).
- `js/generators.js` — difficulty-aware math generators (`mathG1(diff)`/`mathG5(diff)` return generator arrays for `easy`/`normal`/`hard`; `generateMathSet(grade, n, diff)`), plus SVG helpers for the clock and area figures. Multiple-choice items live in `DATA`; numeric items use the on-screen keypad. Difficulty also trims choice count in `showQuestion` via `choiceCount()` (2/3/4).
- `js/strokes.js` — `STROKES[char]` = array of SVG path `d` strings in stroke order (viewBox 109×109), extracted from **KanjiVG** (CC BY-SA 3.0 — keep the attribution header; the file is a derivative under the same license). Used by the writing pad's 書き順 animation (`animateStrokes`, via `pathLength="1"` + `stroke-dashoffset`). Regenerate with the one-off script in git history if `WRITING_SETS` gains characters.
- `js/app.js` — app core: state model + `migrate()`, screen renderers (grade select, home, quiz round, result, badges, shop, かきとり/writing, タイムアタック/time-attack, parent), scoring, badges, streak, the にがて/review pool (`addWrong`/`removeWrong`/`startReview`), time attack (`startTimeAttack`/`finishTimeAttack`, `attackTimer` interval — `round.timed` reuses `showQuestion`/`finishQuestion`; double coins + combo, never touches `stats`/`wrong`; **always `clearAttackTimer()` when leaving a screen**), the calc memo (`makeSketch` shared canvas helper; `setupMemo` toggle persisted in `memoOpen`, per-question blank), the writing pad (`setupPad` — uses `makeSketch`, self-check awards coins) with KanjiVG stroke-order animation, voice read-aloud (`speak`/`toReadable` with `chooseVoice` preferring high-quality ja voices from `PREFERRED_VOICES`/`settings.voiceURI`; reading-questions mask 「」 so the answer isn't spoken), appearance (`applyTheme` sets CSS vars from `SHOP.themes`, `avatarEmoji`), and persistence.
- State is a single object persisted to `localStorage` under `natsuyasumi_v1`, with a separate profile per grade (`g1`/`g5`). When adding profile fields, extend `freshProfile()` **and** `migrate()` so existing saves upgrade cleanly.
- `manifest.webmanifest` + `sw.js` provide the PWA/offline layer; `sw.js` uses a cache-first strategy and lists all app assets in `ASSETS` — **update that list AND bump the `CACHE` version string when adding or renaming files**.
- `icons/` holds `icon.svg` plus a PNG set (96/192/512, `icon-512-maskable.png`, `apple-touch-icon.png`). The PNGs are rasterized from the SVG via Chromium (see git history for the one-off script); regenerate them if the SVG changes.

## Second app: Japanese MLB daily stats (`backend/` + `mlb/`)

A separate, self-contained feature lives alongside the study PWA. It fetches
active Japanese MLB players' stats daily and publishes a page **without
touching the study app**.

- **Data source:** public MLB Stats API (`statsapi.mlb.com`, no key), via
  `urllib` — standard library only, no `requirements.txt`.
- **`backend/mlb_stats.py`** — network layer (`fetch_japanese_players`,
  `fetch_player_stats`, `fetch_game_result`, `collect_stats`; auto-detects
  players by `birthCountry == "Japan"`, pulls season totals + each player's
  latest game and the team's win/loss & score) and a pure formatting layer
  (`format_report` → Markdown, `format_html` → standalone HTML). Player names
  are shown in Japanese via `JAPANESE_NAMES`/`to_japanese` (English fallback).
- **`backend/scheduler.py`** — run `python3 scheduler.py --mlb-report` to write
  `backend/reports/{date}.md` + `latest.md` and the web page `mlb/index.html`.
  The default no-arg invocation stays offline (heartbeat only) so
  `scheduler-test.yml` keeps passing.
- **Tests:** `cd backend && python3 -m unittest` (offline formatter tests).
- **Daily job:** `.github/workflows/mlb-daily.yml` (daily cron + manual) runs
  the report, commits `backend/reports/` and `mlb/index.html` to `main`, then
  calls `pages.yml` to republish the site.

### Live refresh (the page updates when opened)

`mlb/index.html` is a **snapshot plus a refresh script**, not a static page:

- `format_html` embeds `<script id="mlb-config">` (season, player ids +
  Japanese names, `TEAM_NAMES`) and `_PAGE_JS`. On load the script re-fetches
  each player from the MLB API, re-derives the same structure `collect_stats`
  produces, and replaces `<main id="app">`.
- The server-rendered snapshot stays visible until fresh data arrives, so a
  blocked API, an offline phone or an API change degrades to the snapshot
  rather than an empty page. It also keeps the page useful offline.
- `_PAGE_JS` duplicates the rendering in JavaScript. **Change the two together**
  — `_recent_cards`/`_html_table` and `renderCards`/`renderTable` must emit the
  same markup, or a refresh will silently restyle the page.
- Player ids come from the daily build, so a newly arrived Japanese player
  appears after the next daily run, not instantly.
- `sw.js` cooperates: it ignores cross-origin requests (otherwise the MLB API
  responses get cached and the page freezes on stale numbers) and uses
  network-first for `/mlb/`. Bump `CACHE` when changing it.

## Publishing (GitHub Pages)

The repository's Pages source is **"GitHub Actions"**, so nothing goes live
unless a workflow deploys it. **`.github/workflows/pages.yml` is the single
publisher** for the whole site and serves both apps from one deployment:

| URL | Content |
| --- | --- |
| `https://hayuo8ll-del.github.io/ms/` | なつやすみ スタディ (repo root) |
| `https://hayuo8ll-del.github.io/ms/mlb/` | Japanese MLB stats (`mlb/`) |

- It stages `_site` from the repo root with `tar`, excluding `.github/`,
  `backend/` and `scripts/` (none are referenced by the site; `sw.js` caches
  only `index.html`, `css/`, `js/`, `icons/`, `manifest.webmanifest`). Keep
  the root `.nojekyll` — it must reach `_site`.
- It checks out **`ref: main`** explicitly. Do not drop that: when called from
  another workflow the default ref is the *caller's* SHA, which would miss the
  commit that workflow just pushed.
- `pages.yml` triggers on push to `main`, manual dispatch, and `workflow_call`.
  `mlb-daily.yml` must keep calling it, because commits pushed with
  `GITHUB_TOKEN` never fire `on: push`.
- Adding a new page? Put it in a folder under the repo root and it publishes
  automatically — no workflow change needed.

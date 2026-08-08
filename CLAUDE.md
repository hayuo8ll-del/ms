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
  `fetch_player_stats`, `fetch_game_result`, `fetch_games`, `fetch_standings`,
  `fetch_leaders`, `collect_stats`; auto-detects players by
  `birthCountry == "Japan"`, pulls season totals + each player's latest game and
  the team's win/loss & score, plus the day's schedule with live linescores, all
  six division standings and the league leaderboards) and a pure formatting
  layer (`format_report` → Markdown, `format_html` → standalone HTML). Player
  names are shown in Japanese via `JAPANESE_NAMES`/`to_japanese` (English
  fallback), teams via `TEAM_NAMES`, divisions via `DIVISION_NAMES`; the
  leaderboards rendered are listed in `LEADER_CATEGORIES`.
  Each extra section is fetched through `_safe`, so one endpoint failing leaves
  that section empty instead of failing the whole run.
- **`backend/scheduler.py`** — run `python3 scheduler.py --mlb-report` to write
  `backend/reports/{date}.md` + `latest.md` and the web page `mlb/index.html`.
  The default no-arg invocation stays offline (heartbeat only) so
  `scheduler-test.yml` keeps passing.
- **Tests:** `cd backend && python3 -m unittest` (offline formatter tests).
- **Daily job:** `.github/workflows/mlb-daily.yml` (daily cron + manual) runs
  the report, commits `backend/reports/` and `mlb/index.html` to `main`, then
  calls `pages.yml` to republish the site. A `notify-failure` job (`if:
  failure()`) opens — or comments on the existing — `ci-failure` issue with the
  run URL, so a broken daily run is noticed instead of silently taking the site
  down for days.

### Live refresh (the page updates when opened)

`mlb/index.html` is a **data snapshot plus one renderer**, not a static page:

- `format_html` emits only the shell: CSS, the hero, an empty
  `<main id="app"></main>`, `<script id="mlb-data" type="application/json">`
  (the snapshot) and `_PAGE_JS`. **JavaScript is the only renderer** — Python
  builds no page HTML. Keep it that way: the previous design rendered the same
  markup twice (Python + JS) and drifted apart in practice.
- On load the script draws the embedded snapshot immediately, then re-fetches
  players, schedule, standings and leaders from the MLB API and redraws. A
  blocked API, an offline phone or an API change leaves the snapshot on screen
  rather than an empty page.
- The `mlb-data` payload keys are the contract between the two layers:
  `generated_at, season, players, games, standings, leaders, teams, divisions,
  names, categories`. `teams`/`divisions`/`names`/`categories` are the lookup
  tables, shipped so the client can localise *refreshed* data too. It is
  serialised with `</` escaped so a player name can't close the script tag.
- The page has **three tabs** (選手 / 順位表 / 個人成績) driven by
  `location.hash`, so a reload returns to the same tab.
- 選手 is **one card per player**: today's line and the season totals sit
  together, sorted by most recent game (a player with no game log sorts last),
  with a status chip derived from `games` — `試合中 5回裏 3-2` / `試合終了 勝
  5-3` / `試合前 08:10 開始`. A player is matched to a game by `team_id`, and
  because the US date and JST disagree, `collect_stats` fetches **today and
  yesterday** (UTC) and the client picks Live > latest Final > next Preview.
- 順位表 highlights the divisions' teams that have a Japanese player
  (`players[].team_id`); 個人成績 highlights Japanese leaders by player id, or
  by name via the `names` table when the leader isn't in the shipped roster.
- `collect_stats` still emits `hitters`/`pitchers`/`recent` because the Markdown
  report renders those as tables; the page ignores them.
- Player ids come from the daily build, so a newly arrived Japanese player
  appears in the 選手 tab after the next daily run, not instantly.
- `sw.js` cooperates: it ignores cross-origin requests (otherwise the MLB API
  responses get cached and the page freezes on stale numbers) and uses
  network-first for `/mlb/`. Bump `CACHE` when changing it.
- **Verifying the renderer:** `python3 -m unittest` only checks the payload and
  that features are present in the bundle. Behaviour is checked in a browser —
  build a page from a fixture snapshot, stub `window.fetch`, then dump the DOM /
  screenshot with `/opt/pw-browsers/chromium --headless --no-sandbox
  --virtual-time-budget=3000` at desktop and phone widths.

## Publishing (GitHub Pages)

The repository's Pages source must be **"GitHub Actions"** (Settings → Pages),
and nothing goes live unless a workflow deploys it. **If Pages is switched off,
only a human can turn it back on** — `Configure Pages` then fails with "Get
Pages site failed … Not Found", the deploy is skipped and the whole site (study
app included) stops loading. `enablement: true` cannot fix it: creating a Pages
site needs admin rights that `GITHUB_TOKEN` cannot hold. This happened after
2026-08-04 and took the site down until it was re-enabled by hand. **`.github/workflows/pages.yml` is the single
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

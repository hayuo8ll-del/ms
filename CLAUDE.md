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
- `js/app.js` — app core: state model + `migrate()`, screen renderers (grade select, home, quiz round, result, badges, shop, かきとり/writing, タイムアタック/time-attack, parent), scoring, badges, streak, the にがて/review pool (`addWrong`/`removeWrong`/`startReview`), time attack (`startTimeAttack`/`finishTimeAttack`, `attackTimer` interval — `round.timed` reuses `showQuestion`/`finishQuestion`; double coins + combo, never touches `stats`/`wrong`; **always `clearAttackTimer()` when leaving a screen**), the writing pad (`setupPad` — pointer-events canvas, self-check awards coins) with KanjiVG stroke-order animation, voice read-aloud (`speak`/`toReadable`, Web Speech API), appearance (`applyTheme` sets CSS vars from `SHOP.themes`, `avatarEmoji`), and persistence.
- State is a single object persisted to `localStorage` under `natsuyasumi_v1`, with a separate profile per grade (`g1`/`g5`). When adding profile fields, extend `freshProfile()` **and** `migrate()` so existing saves upgrade cleanly.
- `manifest.webmanifest` + `sw.js` provide the PWA/offline layer; `sw.js` uses a cache-first strategy and lists all app assets in `ASSETS` — **update that list AND bump the `CACHE` version string when adding or renaming files**.
- `icons/` holds `icon.svg` plus a PNG set (96/192/512, `icon-512-maskable.png`, `apple-touch-icon.png`). The PNGs are rasterized from the SVG via Chromium (see git history for the one-off script); regenerate them if the SVG changes.

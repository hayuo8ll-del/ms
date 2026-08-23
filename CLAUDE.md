# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current State

This repository hosts **four independent static apps** that share one GitHub
Pages deployment. All are dependency-free vanilla HTML/CSS/JavaScript with no
build step, no package manager, and no bundler.

| Path | App |
| --- | --- |
| repo root | **なつやすみ スタディ** — summer-vacation study PWA for Japanese elementary 1st/5th graders |
| `mlb/` | Japanese MLB daily stats (built by `backend/`) |
| `game/` | **GRAVIX** — one-tap gravity-flip action game |
| `soccer/` | **ボールなし ドリブルれんしゅう** — animated soccer drill video + player page |

They do not share CSS, JS, state or service workers. Changing one must not
touch the others.

## Running / Developing

Service Worker requires an HTTP origin (not `file://`). Serve from the **repo
root** so paths match production:

```bash
python3 -m http.server 8000   # / = study app, /mlb/ , /game/ , /soccer/
```

Test commands that do exist:

```bash
cd backend && python3 -m unittest    # MLB formatter tests (offline)
node scripts/test-game.mjs           # GRAVIX simulation tests (offline, no browser)
```

There is no linter. For anything visual, drive it in a browser — Playwright is
installed globally (`/opt/node22/lib/node_modules/playwright`) with Chromium at
`/opt/pw-browsers/chromium`; `playwright install` is not needed.

Pure-function code that can be checked in Node without a browser:
`js/generators.js` (math generators) and `game/js/{core,world}.js` (see the
`new Function(code + "; return X;")` trick in `scripts/build-strokes.mjs`).

## Architecture

Single-page app; screens are rendered by swapping `#screen`'s innerHTML from JS.

- `index.html` — shell (topbar + `#screen`) and script tags.
- `js/data.js` — non-math question banks (`DATA[grade][subject]`), `BADGES`, `SUBJECTS`, `SHOP` (avatars + color themes), `WRITING_SETS` (かきとり character sets: hiragana/katakana/kanji as `{c, yomi}`), and `WHY` (hand-written explanations for fact questions, keyed by a distinctive **substring** of the question).
- `js/generators.js` — difficulty-aware math generators (`mathG1(diff)`/`mathG5(diff)` return generator arrays for `easy`/`normal`/`hard`; `generateMathSet(grade, n, diff)`), plus SVG helpers for the clock and area figures. Multiple-choice items live in `DATA`; numeric items use the on-screen keypad. Difficulty also trims choice count in `showQuestion` via `choiceCount()` (2/3/4). `mathWhy()` derives a step-by-step explanation from the generated question text and is attached as `item.why` in `generateMathSet` — SVG-only items (clock, rect area) set `why` inline since their numbers aren't in `q`.
- `js/strokes.js` — `STROKES[char]` = array of SVG path `d` strings in stroke order (viewBox 109×109), extracted from **KanjiVG** (CC BY-SA 3.0 — keep the attribution header; the file is a derivative under the same license). Used by the writing pad's 書き順 animation (`animateStrokes`, via `pathLength="1"` + `stroke-dashoffset`). Regenerate with the one-off script in git history if `WRITING_SETS` gains characters.
- `js/app.js` — app core: state model + `migrate()`, screen renderers (grade select, home, quiz round, result, badges, shop, かきとり/writing, タイムアタック/time-attack, parent), scoring, badges, streak, the にがて/review pool (`addWrong`/`removeWrong`/`startReview`), time attack (`startTimeAttack`/`finishTimeAttack`, `attackTimer` interval — `round.timed` reuses `showQuestion`/`finishQuestion`; double coins + combo, never touches `stats`/`wrong`; **always `clearAttackTimer()` when leaving a screen**), the calc memo (`makeSketch` shared canvas helper; `setupMemo` toggle persisted in `memoOpen`, per-question blank), the writing pad (`setupPad` — uses `makeSketch`, self-check awards coins) with KanjiVG stroke-order animation, wrong-answer explanations (`explainFor` = generated `q.why` → `WHY` substring match → question-pattern rules → plain restatement; `showExplain` blocks auto-advance until tapped, except in time attack), voice read-aloud (`speak`/`toReadable` with `chooseVoice` preferring high-quality ja voices from `PREFERRED_VOICES`/`settings.voiceURI`; `READ_RULES` normalizes units/symbols, `splitSpeech` routes English runs to an English voice, reading-questions mask 「」 so the answer isn't spoken), appearance (`applyTheme` sets CSS vars from `SHOP.themes`, `avatarEmoji`), and persistence.
- State is a single object persisted to `localStorage` under `natsuyasumi_v1`, with a separate profile per grade (`g1`/`g5`). When adding profile fields, extend `freshProfile()` **and** `migrate()` so existing saves upgrade cleanly.
- `manifest.webmanifest` + `sw.js` provide the PWA/offline layer; `sw.js` uses a cache-first strategy and lists all app assets in `ASSETS` — **update that list AND bump the `CACHE` version string when adding or renaming files**. Because it is cache-first with no revalidation, *any* edit to root `index.html`/`css/`/`js/` needs a `CACHE` bump or existing installs never see it. Its four fetch rules and the cross-app cache invariants are described under [Service workers](#service-workers-two-of-them-one-origin).
- `icons/` holds `icon.svg` plus a PNG set (96/192/512, `icon-512-maskable.png`, `apple-touch-icon.png`). The PNGs are rasterized from the SVG via Chromium (see git history for the one-off script); regenerate them if the SVG changes. Note this SVG contains a `<text>` element in a Japanese font, so it rasterizes with a fallback face on Linux — `game/icons/icon.svg` deliberately avoids `<text>` for that reason.

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

## Third app: GRAVIX — one-tap action game (`game/`)

A self-contained game at `game/`, published at `/ms/game/`. It shares **nothing**
with the study app — its own CSS tokens, its own `localStorage` key, its own
manifest and its own service worker. Nothing outside `game/` was changed for it
except the root `sw.js` (see below) and this file.

```
game/index.html      shell: canvas + DOM overlay, all iOS meta tags
game/css/game.css    tokens, HUD/menus, safe-area, the iOS countermeasure CSS
game/js/core.js      G namespace, math, seeded RNG, storage, Web Audio, input
game/js/world.js     the simulation — DOM-free, deterministic
game/js/render.js    canvas drawing, parallax, trail, particles, shake, HUD
game/js/game.js      fixed-step loop, pause/resume, screens, boot, SW registration
game/sw.js           CACHE = "ms-game-v1"
scripts/test-game.mjs        simulation tests (not published)
scripts/build-game-icons.mjs SVG → PNG rasterizer (not published)
```

**The load-bearing rule:** `core.js` and `world.js` never touch `document`,
`window`, `Date`, `performance`, `Math.random` or `requestAnimationFrame` at
load time or inside the simulation. All randomness comes from the seeded
`world.rng`; all time is tick counts. That one rule buys determinism across
60/120Hz iPhones, and lets `scripts/test-game.mjs` run the whole game headlessly
in Node.

- **Fixed timestep.** `G.World.step(world, input)` advances exactly one 1/60s
  tick and **deliberately takes no `dt`** — a test asserts `step.length === 2`
  so frame-rate-dependent physics cannot be reintroduced. `game.js` runs an
  accumulator and interpolates rendering with an `alpha`. A gap longer than
  250ms (backgrounding, GC) is treated as *one* frame, never caught up.
- **Pause is not optional.** `visibilitychange`/`blur`/`pagehide` pause the run;
  returning goes through an overlay and a 3-2-1 countdown, never straight back
  into play. Dying while the phone was in your pocket is the worst possible bug
  here.
- **Fairness is enforced, not hand-tuned.** Every obstacle pattern leaves either
  the floor path or the ceiling path open (never both blocked), mid-air bars
  clear both surfaces by `MID_CLEAR`, and the gap before a pattern that forces a
  surface change is at least `switchDist(height, speed)` — the time to travel
  that height plus `REACTION` (0.24s, above human reaction time). **The speed cap
  (420 u/s), the tallest pillar (190u) and `PLAYER_X` (56) are derived from each
  other**: `switchDist` must fit inside the visible track (`W - PLAYER_X` = 304u),
  or an obstacle becomes unavoidable by the time it is on screen. Change one and
  `scripts/test-game.mjs` will tell you which invariant you broke.
- **Corridor height (350u)** is set by how long a crossing takes (~0.45s). Taller
  means dead air between obstacles.
- **Fixed logical world 360×460**, fit with `min()` scaling and *clipped* to
  `0..W` horizontally, so a landscape or very wide screen does not get extra
  lookahead. The floor/ceiling material is drawn past the clip to the screen
  edges, so there are no black bars. This also handles landscape, which is the
  only option — **iOS ignores the manifest's `orientation` and has no
  orientation-lock API**.
- **Rendering budget:** never `ctx.shadowBlur`/`ctx.filter` (software paths in
  Safari — glow is a wide translucent stroke under a thin bright one, plus a
  pre-rendered sprite); gradients built only on resize; no allocation in
  `draw()`; DPR capped at 2 (iPhone Pro reports 3 = 2.25× the fill rate); a
  fixed particle pool with swap-and-pop. Frame time is sampled and drops
  `quality` to .75 once if it stays above 1.25× budget for 2s.
- **Audio** is fully procedural Web Audio — zero binary assets, works offline.
  `AudioContext` is created inside the first `pointerdown` (iOS requirement) and
  resumed on return from background. **`navigator.vibrate` does not exist on iOS
  Safari**, so there are no haptics; impact is sold with hit-stop, shake and a
  sharper audio transient instead. The iOS ring/silent switch mutes Web Audio
  with no API workaround, hence the one-time hint on the title screen.
- **Storage:** `localStorage` key `ms_game_v1` (the `ms_` prefix matters —
  `hayuo8ll-del.github.io` is one origin shared by every repo on the account).
  Extend `fresh()` **and** `migrate()` together, same contract as the study
  app's `freshProfile()`/`migrate()`. Never write during play — `setItem` is
  synchronous; flush on game over, settings change and `visibilitychange`.
- **Adding or renaming a file under `game/` means updating `ASSETS` in
  `game/sw.js` AND bumping its `CACHE`** — same rule as the study app.
- `game/icons/icon.svg` is geometry only (no `<text>`, so it rasterizes
  identically anywhere); regenerate the PNGs with
  `node scripts/build-game-icons.mjs`.
- Debug hooks, only with `?debug=1` or `?seed=N`: a frame-time overlay and
  `window.__gravix` (`world()`, `state()`, `stepN(n, pressFn)`, `hash()`), which
  is what makes headless Playwright checks practical — advance thousands of
  ticks instantly, then screenshot.

## Fourth app: ボールなし ドリブルれんしゅう (`soccer/`)

A 3'20" practice video for a 1st-grader one month into soccer, plus a page that
plays the same animation live. Published at `/ms/soccer/`. Shares nothing with
the other apps; it has no service worker and no `localStorage`.

```
soccer/index.html    page shell (canvas player + menu + notes for parents)
soccer/css/soccer.css
soccer/js/drills.js  8種目の定義とタイムライン（純データ、DOM に触れない）
soccer/js/draw.js    部品：キャラクター（骨格つき）、ボール、接触エフェクト、紙の粒子
soccer/js/scenes.js  ステージ・HUD・パネル
soccer/js/moves.js   種目ごとの動き（拍 → 足・ボール・重心・接触・表情）
soccer/js/story.js   SStory.frame(ctx, t) = t 秒の 1 コマ
soccer/js/player.js  ページの再生・くりかえし・メトロノーム（公開ページのみ）
soccer/video/dribble-noball.mp4   720x1280 / 60fps / H.264+AAC / 約13MB
scripts/soccer-frame.html         書き出し用ハーネス（非公開）
scripts/render-soccer-video.mjs   Chromium で 1 コマずつ描いて ffmpeg へ流す
scripts/build-soccer-audio.mjs    音を合成して WAV に（バイナリ素材ゼロ）
scripts/soccer-shots.mjs          指定秒のコマを PNG で下見
```

- **`SStory.frame(ctx, t)` is a pure function of `t`** — no state carried between
  frames, no `Date`/`performance`/`Math.random`. That is what lets the renderer
  step time by hand (`--from/--to`) instead of screen-recording, so a slow
  machine cannot drop frames or drift out of sync with the click track. Keep it
  that way; the same function drives both the MP4 and the page.
- **Timings live only in `drills.js`.** Both the audio (Node) and the drawing
  (browser) derive every beat from it, so a tempo change moves the clicks and
  the feet together. `drills.js` is loaded in Node with `eval` — it must stay
  DOM-free.
- Motion is written in **beats, not seconds** (`SMove`), so the おてほん can be
  replayed at 60% speed without redoing the choreography.
- **What makes it read as animation** (all of it derived from `t` alone, so the
  renderer stays a pure function): a jointed rig — knees and elbows are the
  midpoint of the quadratic that used to *be* the limb — plus squash/stretch
  about the contact point, head/hair lag sampled from the pose 0.1 beat earlier,
  arm pump driven by the step phase, blinks and brow/mouth from `effort`.
  Contact is sold with a ball squash, a dust ring and a foot after-image
  (the same `pose()` re-evaluated at `beat - 0.075`). The stage has parallax
  (bushes, a far goal), a vignette and a fixed-seed grain tile. The camera
  eases in during practice and shakes on dash/stop, so `frontStage`/`topStage`
  paint `PAD` px beyond the frame — shrink that padding and the corners tear.
  Segments are joined by a `wipe()` computed from the distance to the nearest
  segment boundary, matched by a whoosh in the audio at the same instant.
- Rebuild the video (needs libx264 + AAC — Playwright's bundled ffmpeg is VP8-only):

  ```bash
  npm i ffmpeg-static            # anywhere; or set FFMPEG=/path/to/ffmpeg
  node scripts/build-soccer-audio.mjs /tmp/soccer-audio.wav
  node scripts/render-soccer-video.mjs soccer/video/dribble-noball.mp4 \
       --fps 60 --audio /tmp/soccer-audio.wav   # 12000 コマ・6 分ほど
  ```

- The rounded Japanese face (M PLUS Rounded 1c) is loaded from Google Fonts by
  both `soccer/index.html` and `scripts/soccer-frame.html`, so the render box
  needs network. Without it, Linux falls back to IPAGothic and the video looks
  different from the page.
- Root `sw.js` **passes `/soccer/` through uncached** — see rule 1 under
  [Service workers](#service-workers-two-of-them-one-origin). Caching it would
  put the 13MB MP4 in the study app's cache and answer the video's Range
  requests with a whole-file response, breaking seeking in Safari.

## Service workers (two of them, one origin)

There are two registrations: root `sw.js` (scope `/ms/`) and `game/sw.js`
(scope `/ms/game/`). A client is controlled by the **longest matching scope**,
so `/ms/game/` pages get the game's worker. Three things about this are easy to
get wrong, and all three are load-bearing:

1. **Root `sw.js` must pass `/game/` through** (`if (url.pathname.includes("/game/")) return;`).
   Without it, its cache-first rule pulls the game's files into the study app's
   cache and, offline, serves the study app's `index.html` at the game's URL.
2. **CacheStorage is per-origin, not per-scope.** Each worker's `activate` must
   delete only its own prefix (`natsu-study-*` / `ms-game-*`). The original
   `keys.filter(k => k !== CACHE)` deleted *every* cache on the origin, which
   would wipe the game's offline copy on every study-app cache bump.
3. **`caches.match()` without `cacheName` searches every cache on the origin.**
   Both workers pass `{ cacheName: CACHE }` so one app can never serve the
   other's stored response.

Root `sw.js` fetch rules, in order: non-GET → ignore; cross-origin → pass
through uncached (MLB API/photos); `/game/` and `/soccer/` → pass through
(rule 1); `/mlb/` → network-first; everything else → cache-first with an
`./index.html` fallback.

## Publishing (GitHub Pages)

The repository's Pages source must be **"GitHub Actions"** (Settings → Pages),
and nothing goes live unless a workflow deploys it. **If Pages is switched off,
only a human can turn it back on** — `Configure Pages` then fails with "Get
Pages site failed … Not Found", the deploy is skipped and the whole site (study
app included) stops loading. `enablement: true` cannot fix it: creating a Pages
site needs admin rights that `GITHUB_TOKEN` cannot hold. This happened after
2026-08-04 and took the site down until it was re-enabled by hand. **`.github/workflows/pages.yml` is the single
publisher** for the whole site and serves all three apps from one deployment:

| URL | Content |
| --- | --- |
| `https://hayuo8ll-del.github.io/ms/` | なつやすみ スタディ (repo root) |
| `https://hayuo8ll-del.github.io/ms/mlb/` | Japanese MLB stats (`mlb/`) |
| `https://hayuo8ll-del.github.io/ms/game/` | GRAVIX (`game/`) |
| `https://hayuo8ll-del.github.io/ms/soccer/` | ボールなし ドリブルれんしゅう (`soccer/`) |

- It stages `_site` from the repo root with `tar`, excluding `.github/`,
  `backend/` and `scripts/` (none are referenced by the site; `scripts/` holds
  the one-off generators for `js/strokes.js` and `game/icons/`, plus
  `test-game.mjs`). Keep the root `.nojekyll` — it must reach `_site`.
- It checks out **`ref: main`** explicitly. Do not drop that: when called from
  another workflow the default ref is the *caller's* SHA, which would miss the
  commit that workflow just pushed.
- `pages.yml` triggers on push to `main`, manual dispatch, and `workflow_call`.
  `mlb-daily.yml` must keep calling it, because commits pushed with
  `GITHUB_TOKEN` never fire `on: push`.
- Adding a new page? Put it in a folder under the repo root and it publishes
  automatically — no workflow change needed.

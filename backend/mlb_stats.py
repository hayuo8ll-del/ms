#!/usr/bin/env python3
"""Fetch and format season statistics for Japanese Major League players.

This module is split into two clearly separated layers:

* **Network layer** — talks to the public MLB Stats API
  (``https://statsapi.mlb.com``, free, no API key) using only the standard
  library ``urllib``. These functions perform live HTTP requests and are
  meant to run where outbound network access is available (e.g. GitHub
  Actions), not necessarily in every sandbox.
* **Formatting layer** — pure functions that turn already-collected data
  into a Japanese Markdown report. These have no network dependency and are
  covered by offline unit tests (``test_mlb_stats.py``).

Standard library only — no third-party dependencies, so ``requirements.txt``
stays unnecessary.
"""

from __future__ import annotations

import html
import json
import logging
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger("scheduler.mlb")

API_BASE = "https://statsapi.mlb.com/api/v1"
USER_AGENT = "ms-scheduler/1.0 (+https://github.com/hayuo8ll-del/ms)"

# English (MLB API ``fullName``) -> Japanese display name. The MLB Stats API
# only returns Latin-script names, so Japanese names come from this table.
# Players not listed here fall back to their English name (see ``to_japanese``);
# add new arrivals here as they debut.
JAPANESE_NAMES: dict[str, str] = {
    "Shohei Ohtani": "大谷翔平",
    "Yoshinobu Yamamoto": "山本由伸",
    "Roki Sasaki": "佐々木朗希",
    "Yu Darvish": "ダルビッシュ有",
    "Seiya Suzuki": "鈴木誠也",
    "Masataka Yoshida": "吉田正尚",
    "Shota Imanaga": "今永昇太",
    "Kodai Senga": "千賀滉大",
    "Yusei Kikuchi": "菊池雄星",
    "Tomoyuki Sugano": "菅野智之",
    "Yuki Matsui": "松井裕樹",
    "Shinnosuke Ogasawara": "小笠原慎之介",
    "Kenta Maeda": "前田健太",
    "Naoyuki Uwasawa": "上沢直之",
    "Kazuma Okamoto": "岡本和真",
    "Munetaka Murakami": "村上宗隆",
    "Tatsuya Imai": "今井達也",
}

# Full MLB club name -> short Japanese nickname. Shortening the team column is
# the single biggest readability win on a phone, where it is otherwise the
# widest column. Unknown clubs fall back to the English name.
TEAM_NAMES: dict[str, str] = {
    "Arizona Diamondbacks": "ダイヤモンドバックス",
    "Atlanta Braves": "ブレーブス",
    "Baltimore Orioles": "オリオールズ",
    "Boston Red Sox": "レッドソックス",
    "Chicago Cubs": "カブス",
    "Chicago White Sox": "ホワイトソックス",
    "Cincinnati Reds": "レッズ",
    "Cleveland Guardians": "ガーディアンズ",
    "Colorado Rockies": "ロッキーズ",
    "Detroit Tigers": "タイガース",
    "Houston Astros": "アストロズ",
    "Kansas City Royals": "ロイヤルズ",
    "Los Angeles Angels": "エンゼルス",
    "Los Angeles Dodgers": "ドジャース",
    "Miami Marlins": "マーリンズ",
    "Milwaukee Brewers": "ブルワーズ",
    "Minnesota Twins": "ツインズ",
    "New York Mets": "メッツ",
    "New York Yankees": "ヤンキース",
    "Philadelphia Phillies": "フィリーズ",
    "Pittsburgh Pirates": "パイレーツ",
    "San Diego Padres": "パドレス",
    "San Francisco Giants": "ジャイアンツ",
    "Seattle Mariners": "マリナーズ",
    "St. Louis Cardinals": "カージナルス",
    "Tampa Bay Rays": "レイズ",
    "Texas Rangers": "レンジャーズ",
    "Toronto Blue Jays": "ブルージェイズ",
    "Washington Nationals": "ナショナルズ",
    # The Athletics have appeared under several names since leaving Oakland.
    "Athletics": "アスレチックス",
    "Oakland Athletics": "アスレチックス",
    "Sacramento Athletics": "アスレチックス",
}


def to_japanese(name: str) -> str:
    """Return the Japanese display name for ``name`` (English fallback)."""
    return JAPANESE_NAMES.get(name, name)


def to_japanese_team(name: str) -> str:
    """Return the short Japanese club name for ``name`` (English fallback)."""
    return TEAM_NAMES.get(name, name)


# ---------------------------------------------------------------------------
# Network layer (runs where outbound HTTPS to statsapi.mlb.com is allowed)
# ---------------------------------------------------------------------------


def _get_json(url: str, timeout: float = 20.0) -> dict[str, Any]:
    """GET ``url`` and decode the JSON body.

    Raises ``urllib.error.URLError`` / ``json.JSONDecodeError`` on failure;
    callers decide how to handle those.
    """
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    logger.debug("GET %s", url)
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
        charset = response.headers.get_content_charset() or "utf-8"
        return json.loads(response.read().decode(charset))


def fetch_japanese_players(season: int, timeout: float = 20.0) -> list[dict[str, Any]]:
    """Return active MLB players born in Japan for ``season``.

    Uses the sport-wide player list and filters on ``birthCountry``. Each
    returned dict has ``id``, ``name``, ``position`` (abbreviation) and
    ``position_type`` (e.g. ``Pitcher``/``Hitter``/``Two-Way Player``).
    """
    url = f"{API_BASE}/sports/1/players?season={season}"
    data = _get_json(url, timeout=timeout)
    players: list[dict[str, Any]] = []
    for person in data.get("people", []):
        if person.get("birthCountry") != "Japan":
            continue
        if not person.get("active", True):
            continue
        position = person.get("primaryPosition") or {}
        players.append(
            {
                "id": person.get("id"),
                "name": person.get("fullName", "?"),
                "position": position.get("abbreviation", ""),
                "position_type": position.get("type", ""),
            }
        )
    players.sort(key=lambda p: p["name"])
    logger.info("found %d active Japanese players for season %s", len(players), season)
    return players


def fetch_player_stats(
    player_id: int, season: int, timeout: float = 20.0
) -> dict[str, Any]:
    """Return season stats, current team and last game for one player.

    Hydrates both stat groups and both stat types (season totals + per-game
    log) in a single request. ``hitting`` / ``pitching`` are the season
    ``stat`` dicts (``None`` when the player has no split there yet).
    ``last_game`` describes the player's most recent appearance (see
    :func:`_extract_last_game`) or ``None`` when there is no game log.
    """
    url = (
        f"{API_BASE}/people/{player_id}"
        f"?hydrate=stats(group=[hitting,pitching],type=[season,gameLog],season={season}),currentTeam"
    )
    data = _get_json(url, timeout=timeout)
    people = data.get("people") or []
    person = people[0] if people else {}
    team = (person.get("currentTeam") or {}).get("name", "")

    hitting: dict[str, Any] | None = None
    pitching: dict[str, Any] | None = None
    log_splits: list[tuple[str, dict[str, Any]]] = []
    for group in person.get("stats", []):
        group_type = (group.get("type") or {}).get("displayName")
        group_name = (group.get("group") or {}).get("displayName")
        splits = group.get("splits") or []
        if group_type == "season":
            if splits:
                stat = splits[0].get("stat") or {}
                if group_name == "hitting":
                    hitting = stat
                elif group_name == "pitching":
                    pitching = stat
        elif group_type == "gameLog":
            for split in splits:
                log_splits.append((group_name, split))

    return {
        "team": team,
        "hitting": hitting,
        "pitching": pitching,
        "last_game": _extract_last_game(log_splits),
    }


def _extract_last_game(
    log_splits: list[tuple[str, dict[str, Any]]],
) -> dict[str, Any] | None:
    """Pick the most recent game across hitting/pitching game-log splits.

    Returns the game ``date`` (``YYYY-MM-DD``), the player's ``team_id``,
    ``opponent`` name, ``home`` flag, and the player's ``hitting`` / ``pitching``
    stat lines for that game — or ``None`` when there is no dated split.
    """
    dates = [sp.get("date") for _, sp in log_splits if sp.get("date")]
    if not dates:
        return None
    latest = max(dates)

    game: dict[str, Any] = {
        "date": latest,
        "team_id": None,
        "opponent": "",
        "home": None,
        "hitting": None,
        "pitching": None,
    }
    for group_name, split in log_splits:
        if split.get("date") != latest:
            continue
        if group_name == "hitting":
            game["hitting"] = split.get("stat") or {}
        elif group_name == "pitching":
            game["pitching"] = split.get("stat") or {}
        game["team_id"] = (split.get("team") or {}).get("id", game["team_id"])
        opponent = (split.get("opponent") or {}).get("name")
        if opponent:
            game["opponent"] = opponent
        if split.get("isHome") is not None:
            game["home"] = split.get("isHome")
    return game


def fetch_game_result(
    team_id: int, date: str, timeout: float = 20.0
) -> dict[str, Any] | None:
    """Return the score and win/loss for ``team_id``'s game on ``date``.

    Uses the schedule endpoint. Returns ``team_score``, ``opp_score``,
    ``result`` (``"勝"``/``"敗"``/``""``) and ``opponent`` name, or ``None``
    when no matching game is found.
    """
    url = f"{API_BASE}/schedule?sportId=1&teamId={team_id}&date={date}"
    data = _get_json(url, timeout=timeout)
    for day in data.get("dates", []):
        for game in day.get("games", []):
            teams = game.get("teams") or {}
            home = teams.get("home") or {}
            away = teams.get("away") or {}
            for side, other in ((home, away), (away, home)):
                if ((side.get("team") or {}).get("id")) != team_id:
                    continue
                result = ""
                if side.get("isWinner") is True:
                    result = "勝"
                elif side.get("isWinner") is False:
                    result = "敗"
                return {
                    "team_score": side.get("score"),
                    "opp_score": other.get("score"),
                    "result": result,
                    "opponent": (other.get("team") or {}).get("name", ""),
                }
    return None


def collect_stats(season: int, timeout: float = 20.0) -> dict[str, Any]:
    """Gather structured stats for every active Japanese player.

    Returns ``{"date", "season", "hitters", "pitchers", "recent"}``. Player
    names are Japanese where known (English fallback). ``recent`` holds each
    player's most recent game (personal line + team win/loss & score). A
    player who both hits and pitches appears in both season lists. Failures
    fetching an individual player are logged and skipped so one bad response
    does not abort the whole run.
    """
    players = fetch_japanese_players(season, timeout=timeout)
    hitters: list[dict[str, Any]] = []
    pitchers: list[dict[str, Any]] = []
    recent: list[dict[str, Any]] = []
    schedule_cache: dict[tuple[int, str], dict[str, Any] | None] = {}

    for player in players:
        try:
            stats = fetch_player_stats(player["id"], season, timeout=timeout)
        except (urllib.error.URLError, ValueError, KeyError) as exc:
            logger.warning("skipping %s (id=%s): %s", player["name"], player["id"], exc)
            continue

        name = to_japanese(player["name"])
        base = {"name": name, "team": to_japanese_team(stats["team"])}
        if stats["hitting"]:
            hitters.append({**base, "stat": stats["hitting"]})
        if stats["pitching"]:
            pitchers.append({**base, "stat": stats["pitching"]})

        last_game = stats.get("last_game")
        if last_game:
            entry = _build_recent_entry(name, last_game, schedule_cache, timeout)
            if entry:
                recent.append(entry)

    hitters.sort(key=lambda h: _to_float(h["stat"].get("homeRuns")), reverse=True)
    pitchers.sort(key=lambda p: _to_float(p["stat"].get("strikeOuts")), reverse=True)
    recent.sort(key=lambda r: r.get("date") or "", reverse=True)

    return {
        "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "season": season,
        "hitters": hitters,
        "pitchers": pitchers,
        "recent": recent,
    }


def _build_recent_entry(
    name: str,
    last_game: dict[str, Any],
    schedule_cache: dict[tuple[int, str], dict[str, Any] | None],
    timeout: float,
) -> dict[str, Any] | None:
    """Combine a player's last-game line with the team's win/loss & score."""
    date = last_game.get("date")
    team_id = last_game.get("team_id")
    result: dict[str, Any] | None = None
    if team_id and date:
        key = (team_id, date)
        if key not in schedule_cache:
            try:
                schedule_cache[key] = fetch_game_result(team_id, date, timeout=timeout)
            except (urllib.error.URLError, ValueError, KeyError) as exc:
                logger.warning("no game result for team %s on %s: %s", team_id, date, exc)
                schedule_cache[key] = None
        result = schedule_cache[key]

    result = result or {}
    opponent = result.get("opponent") or last_game.get("opponent") or ""
    return {
        "name": name,
        "date": date,
        "opponent": to_japanese_team(opponent),
        "home": last_game.get("home"),
        "team_score": result.get("team_score"),
        "opp_score": result.get("opp_score"),
        "result": result.get("result", ""),
        "line": _game_line(last_game.get("hitting"), last_game.get("pitching")),
    }


# ---------------------------------------------------------------------------
# Formatting layer (pure functions, no network — covered by offline tests)
# ---------------------------------------------------------------------------


def default_season() -> int:
    """Return the season year to use by default (the current year)."""
    return datetime.now().year


def _to_float(value: Any) -> float:
    """Best-effort float conversion for sorting; unknowns sort last."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return -1.0


def _cell(value: Any) -> str:
    """Render a stat value for a table cell (Markdown or HTML)."""
    if value is None or value == "":
        return "-"
    return str(value)


def _esc(value: Any) -> str:
    """HTML-escape a value for safe inclusion in the generated page."""
    return html.escape(_cell(value))


def _hitter_game_line(stat: dict[str, Any]) -> str:
    """One-game batting line, e.g. ``4打数2安打 本塁打1 打点2``."""
    parts = [f"{_cell(stat.get('atBats'))}打数{_cell(stat.get('hits'))}安打"]
    if _to_float(stat.get("homeRuns")) > 0:
        parts.append(f"本塁打{stat.get('homeRuns')}")
    if _to_float(stat.get("rbi")) > 0:
        parts.append(f"打点{stat.get('rbi')}")
    if _to_float(stat.get("baseOnBalls")) > 0:
        parts.append(f"四球{stat.get('baseOnBalls')}")
    return " ".join(parts)


def _pitcher_game_line(stat: dict[str, Any]) -> str:
    """One-game pitching line, e.g. ``6.0回 2失点 7奪三振``."""
    parts = []
    if stat.get("inningsPitched") is not None:
        parts.append(f"{stat.get('inningsPitched')}回")
    if stat.get("earnedRuns") is not None:
        parts.append(f"{stat.get('earnedRuns')}失点")
    if stat.get("strikeOuts") is not None:
        parts.append(f"{stat.get('strikeOuts')}奪三振")
    return " ".join(parts) if parts else "-"


def _game_line(
    hitting: dict[str, Any] | None, pitching: dict[str, Any] | None
) -> str:
    """Combine batting/pitching lines for a game (two-way players show both)."""
    if hitting and pitching:
        return f"投: {_pitcher_game_line(pitching)} / 打: {_hitter_game_line(hitting)}"
    if pitching:
        return _pitcher_game_line(pitching)
    if hitting:
        return _hitter_game_line(hitting)
    return "-"


def _short_date(date: Any) -> str:
    """``2026-07-24`` -> ``07/24``; passes anything unexpected through."""
    text = _cell(date)
    parts = text.split("-")
    return f"{parts[1]}/{parts[2]}" if len(parts) == 3 else text


def _matchup(entry: dict[str, Any]) -> str:
    """Opponent with home/away marker, e.g. ``vs Padres`` / ``@ Padres``."""
    opponent = _cell(entry.get("opponent"))
    home = entry.get("home")
    if home is True:
        return f"vs {opponent}"
    if home is False:
        return f"@ {opponent}"
    return opponent


def _team_result(entry: dict[str, Any]) -> str:
    """Team win/loss with score, e.g. ``勝 5-3`` (falls back gracefully)."""
    result = _cell(entry.get("result")) if entry.get("result") else ""
    ts, os_ = entry.get("team_score"), entry.get("opp_score")
    if ts is not None and os_ is not None:
        if not result:
            # The schedule endpoint omits isWinner for some games; the scores
            # still tell us who won, so don't show a bare "3-4".
            team, opp = _to_float(ts), _to_float(os_)
            if team >= 0 and opp >= 0 and team != opp:
                result = "勝" if team > opp else "敗"
        return f"{result} {ts}-{os_}".strip()
    return result or "-"


def _hitters_table(hitters: list[dict[str, Any]]) -> list[str]:
    lines = [
        "## 野手",
        "",
        "| 選手 | チーム | 試合 | 打率 | 本塁打 | 打点 | OPS | 出塁率 |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for h in hitters:
        s = h["stat"]
        lines.append(
            "| {name} | {team} | {g} | {avg} | {hr} | {rbi} | {ops} | {obp} |".format(
                name=h["name"],
                team=_cell(h["team"]),
                g=_cell(s.get("gamesPlayed")),
                avg=_cell(s.get("avg")),
                hr=_cell(s.get("homeRuns")),
                rbi=_cell(s.get("rbi")),
                ops=_cell(s.get("ops")),
                obp=_cell(s.get("obp")),
            )
        )
    return lines


def _pitchers_table(pitchers: list[dict[str, Any]]) -> list[str]:
    lines = [
        "## 投手",
        "",
        "| 選手 | チーム | 登板 | 防御率 | 勝 | 敗 | 奪三振 | WHIP | 投球回 |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for p in pitchers:
        s = p["stat"]
        lines.append(
            "| {name} | {team} | {g} | {era} | {w} | {l} | {so} | {whip} | {ip} |".format(
                name=p["name"],
                team=_cell(p["team"]),
                g=_cell(s.get("gamesPlayed")),
                era=_cell(s.get("era")),
                w=_cell(s.get("wins")),
                l=_cell(s.get("losses")),
                so=_cell(s.get("strikeOuts")),
                whip=_cell(s.get("whip")),
                ip=_cell(s.get("inningsPitched")),
            )
        )
    return lines


def _recent_table(recent: list[dict[str, Any]]) -> list[str]:
    lines = [
        "## 直近試合の結果",
        "",
        "| 選手 | 試合日 | 対戦 | チーム結果 | 個人成績 |",
        "| --- | --- | --- | --- | --- |",
    ]
    for r in recent:
        lines.append(
            "| {name} | {date} | {vs} | {res} | {line} |".format(
                name=r["name"],
                date=_short_date(r.get("date")),
                vs=_matchup(r),
                res=_team_result(r),
                line=_cell(r.get("line")),
            )
        )
    return lines


def format_report(data: dict[str, Any]) -> str:
    """Render structured stats (from :func:`collect_stats`) as Markdown."""
    season = data.get("season", "?")
    hitters = data.get("hitters", [])
    pitchers = data.get("pitchers", [])
    recent = data.get("recent", [])

    lines = [
        f"# 日本人メジャーリーガー成績 ({season}シーズン)",
        "",
        f"最終更新: {data.get('generated_at', data.get('date', ''))}",
        "",
        f"データ提供: MLB Stats API — 野手 {len(hitters)}名 / 投手 {len(pitchers)}名",
        "",
    ]

    if not hitters and not pitchers and not recent:
        lines.append(
            "現時点で出場成績のある日本人選手は見つかりませんでした"
            "(オフシーズン、または今シーズンの試合前の可能性があります)。"
        )
        return "\n".join(lines) + "\n"

    if recent:
        lines.extend(_recent_table(recent))
        lines.append("")
    if hitters:
        lines.extend(_hitters_table(hitters))
        lines.append("")
    if pitchers:
        lines.extend(_pitchers_table(pitchers))
        lines.append("")

    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# HTML formatting layer (pure function — powers the GitHub Pages web app)
# ---------------------------------------------------------------------------

_PAGE_CSS = """
:root { color-scheme: light dark; --bg:#ffffff; --fg:#1a1a1a; --muted:#666;
  --border:#e2e2e2; --head:#f5f5f5; --stripe:#fafafa; --accent:#0b5cff; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#0f1115; --fg:#e6e6e6; --muted:#9aa0aa; --border:#2a2f3a;
    --head:#1a1e26; --stripe:#151922; --accent:#5b9bff; } }
* { box-sizing: border-box; }
body { margin:0; padding:1.5rem 1rem 3rem; background:var(--bg); color:var(--fg);
  font-family:-apple-system,BlinkMacSystemFont,"Hiragino Kaku Gothic ProN",
  "Noto Sans JP","Yu Gothic",Meiryo,sans-serif; line-height:1.6; }
main { max-width:1000px; margin:0 auto; }
h1 { font-size:1.5rem; margin:0 0 .25rem; }
h2 { font-size:1.2rem; margin:2rem 0 .5rem; }
.meta { color:var(--muted); font-size:.9rem; margin:.1rem 0; }
.table-wrap { overflow-x:auto; -webkit-overflow-scrolling:touch;
  border:1px solid var(--border); border-radius:8px; }
table { border-collapse:collapse; width:100%; min-width:640px; font-size:.95rem; }
th, td { padding:.5rem .7rem; text-align:right; white-space:nowrap;
  border-bottom:1px solid var(--border); }
th:first-child, td:first-child, th:nth-child(2), td:nth-child(2) { text-align:left; }
thead th { background:var(--head); position:sticky; top:0; }
tbody tr:nth-child(even) { background:var(--stripe); }
tbody tr:last-child td { border-bottom:none; }
table.recent { min-width:520px; }
table.recent th, table.recent td { text-align:left; }
table.recent td:last-child { white-space:normal; }
/* Headline numbers (打率/本塁打, 防御率/奪三振) stand out from the rest. */
td.key { font-weight:700; color:var(--accent); }
.empty { padding:1rem; color:var(--muted); }
footer { margin-top:2.5rem; color:var(--muted); font-size:.85rem; }
footer a { color:var(--accent); }

/* Phone layout: turn each row into a card so nothing scrolls sideways.
   Every td carries data-label, which becomes the row label here. */
@media (max-width: 700px) {
  body { padding:1.25rem .75rem 2.5rem; }
  .table-wrap { border:none; border-radius:0; overflow:visible; }
  table, table.recent { min-width:0; display:block; }
  thead { display:none; }
  tbody, tr, td { display:block; width:100%; }
  tbody tr, tbody tr:nth-child(even) { background:var(--stripe); }
  tbody tr {
    border:1px solid var(--border); border-radius:10px;
    margin:0 0 .7rem; padding:.6rem .8rem;
  }
  td {
    display:flex; justify-content:space-between; align-items:baseline;
    gap:1rem; border:none; padding:.22rem 0; text-align:right;
    white-space:normal;
  }
  td::before {
    content:attr(data-label); color:var(--muted);
    font-size:.85rem; text-align:left; flex:none;
  }
  /* First cell (player name) becomes the card title. */
  td:first-child {
    font-size:1.1rem; font-weight:700; text-align:left;
    border-bottom:1px solid var(--border);
    margin-bottom:.4rem; padding-bottom:.4rem;
  }
  td:first-child::before { content:none; }
  td.key { font-size:1.05rem; }
}
""".strip()

_HITTER_HEADERS = ["選手", "チーム", "試合", "打率", "本塁打", "打点", "OPS", "出塁率"]
_HITTER_KEYS = ["gamesPlayed", "avg", "homeRuns", "rbi", "ops", "obp"]
_PITCHER_HEADERS = [
    "選手", "チーム", "登板", "防御率", "勝", "敗", "奪三振", "WHIP", "投球回",
]
_PITCHER_KEYS = ["gamesPlayed", "era", "wins", "losses", "strikeOuts", "whip", "inningsPitched"]

# Stats highlighted (bold + accent) as the headline numbers for each table.
_HITTER_KEY_STATS = {"avg", "homeRuns"}
_PITCHER_KEY_STATS = {"era", "strikeOuts"}


def _html_table(
    title: str,
    headers: list[str],
    keys: list[str],
    rows: list[dict[str, Any]],
    key_stats: set[str],
) -> str:
    head = "".join(f"<th>{_esc(h)}</th>" for h in headers)
    body = []
    for row in rows:
        stat = row["stat"]
        # data-label drives the phone card layout (see the media query in the CSS).
        cells = [
            f'<td data-label="{_esc(headers[0])}">{_esc(row["name"])}</td>',
            f'<td data-label="{_esc(headers[1])}">{_esc(row["team"])}</td>',
        ]
        for header, key in zip(headers[2:], keys):
            cls = ' class="key"' if key in key_stats else ""
            cells.append(
                f'<td{cls} data-label="{_esc(header)}">{_esc(stat.get(key))}</td>'
            )
        body.append("<tr>" + "".join(cells) + "</tr>")
    return (
        f"<h2>{_esc(title)}</h2>\n"
        '<div class="table-wrap"><table>\n'
        f"<thead><tr>{head}</tr></thead>\n"
        "<tbody>\n" + "\n".join(body) + "\n</tbody>\n"
        "</table></div>"
    )


_RECENT_HEADERS = ["選手", "試合日", "対戦", "チーム結果", "個人成績"]


def _recent_html_table(recent: list[dict[str, Any]]) -> str:
    head = "".join(f"<th>{_esc(h)}</th>" for h in _RECENT_HEADERS)
    body = []
    for r in recent:
        values = [
            _esc(r["name"]),
            _esc(_short_date(r.get("date"))),
            _esc(_matchup(r)),
            _esc(_team_result(r)),
            _esc(r.get("line")),
        ]
        cells = []
        for i, (header, value) in enumerate(zip(_RECENT_HEADERS, values)):
            # The player's own line (last column) is the headline here.
            cls = ' class="key"' if i == len(values) - 1 else ""
            cells.append(f'<td{cls} data-label="{_esc(header)}">{value}</td>')
        body.append("<tr>" + "".join(cells) + "</tr>")
    return (
        "<h2>直近試合の結果</h2>\n"
        '<div class="table-wrap"><table class="recent">\n'
        f"<thead><tr>{head}</tr></thead>\n"
        "<tbody>\n" + "\n".join(body) + "\n</tbody>\n"
        "</table></div>"
    )


def format_html(data: dict[str, Any]) -> str:
    """Render structured stats (from :func:`collect_stats`) as a standalone
    HTML page for the GitHub Pages web app.

    Pure function (no network); the returned page is fully self-contained
    (inline CSS, responsive, light/dark aware) so it can be published as-is.
    """
    season = data.get("season", "?")
    hitters = data.get("hitters", [])
    pitchers = data.get("pitchers", [])
    recent = data.get("recent", [])
    updated = _esc(data.get("generated_at", data.get("date", "")))

    parts = [
        f"<h1>日本人メジャーリーガー成績 ({_esc(season)}シーズン)</h1>",
        f'<p class="meta">最終更新: {updated}</p>',
        f'<p class="meta">データ提供: MLB Stats API — 野手 {len(hitters)}名 / 投手 {len(pitchers)}名</p>',
    ]

    if not hitters and not pitchers and not recent:
        parts.append(
            '<p class="empty">現時点で出場成績のある日本人選手は見つかりませんでした'
            "(オフシーズン、または今シーズンの試合前の可能性があります)。</p>"
        )
    else:
        if recent:
            parts.append(_recent_html_table(recent))
        if hitters:
            parts.append(
                _html_table(
                    "野手", _HITTER_HEADERS, _HITTER_KEYS, hitters, _HITTER_KEY_STATS
                )
            )
        if pitchers:
            parts.append(
                _html_table(
                    "投手", _PITCHER_HEADERS, _PITCHER_KEYS, pitchers, _PITCHER_KEY_STATS
                )
            )

    parts.append(
        "<footer>データ提供: "
        '<a href="https://statsapi.mlb.com" rel="noopener">MLB Stats API</a>'
        "(無料・公開)。GitHub Actions により毎日自動更新。</footer>"
    )
    body = "\n".join(parts)

    return (
        "<!doctype html>\n"
        '<html lang="ja">\n<head>\n'
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"<title>日本人メジャーリーガー成績 ({_esc(season)})</title>\n"
        f"<style>\n{_PAGE_CSS}\n</style>\n"
        "</head>\n<body>\n<main>\n"
        f"{body}\n"
        "</main>\n</body>\n</html>\n"
    )

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
from datetime import datetime, timedelta, timezone
from typing import Any

logger = logging.getLogger("scheduler.mlb")

API_BASE = "https://statsapi.mlb.com/api/v1"
# The page is read in Japan, so timestamps are shown in JST. Japan has no DST,
# so a fixed +09:00 offset is exact all year.
JST = timezone(timedelta(hours=9))
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


# MLB division name -> Japanese. Used by the standings tab.
DIVISION_NAMES: dict[str, str] = {
    "American League East": "ア・リーグ東",
    "American League Central": "ア・リーグ中",
    "American League West": "ア・リーグ西",
    "National League East": "ナ・リーグ東",
    "National League Central": "ナ・リーグ中",
    "National League West": "ナ・リーグ西",
}

# Leader boards to show: (API category, Japanese label, stat group).
LEADER_CATEGORIES: list[tuple[str, str, str]] = [
    ("homeRuns", "本塁打", "hitting"),
    ("battingAverage", "打率", "hitting"),
    ("runsBattedIn", "打点", "hitting"),
    ("stolenBases", "盗塁", "hitting"),
    ("earnedRunAverage", "防御率", "pitching"),
    ("strikeouts", "奪三振", "pitching"),
    ("wins", "勝利", "pitching"),
    ("saves", "セーブ", "pitching"),
]

# Categories where a *smaller* number is the better one.
ASCENDING_CATEGORIES: set[str] = {"earnedRunAverage"}


def to_japanese_division(name: str) -> str:
    """Return the Japanese division name (English fallback)."""
    return DIVISION_NAMES.get(name, name)


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
        "team_id": (person.get("currentTeam") or {}).get("id"),
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


def fetch_games(date: str, timeout: float = 20.0) -> list[dict[str, Any]]:
    """Return every MLB game on ``date`` with its status and current score.

    ``state`` is the API's abstract state: ``Preview`` (not started), ``Live``
    or ``Final``. ``inning``/``half`` are only meaningful while live.
    """
    url = f"{API_BASE}/schedule?sportId=1&date={date}&hydrate=linescore"
    data = _get_json(url, timeout=timeout)
    games: list[dict[str, Any]] = []
    for day in data.get("dates", []):
        for game in day.get("games", []):
            status = game.get("status") or {}
            line = game.get("linescore") or {}
            teams = game.get("teams") or {}
            home, away = teams.get("home") or {}, teams.get("away") or {}
            games.append(
                {
                    "date": day.get("date", date),
                    "start": game.get("gameDate", ""),
                    "state": status.get("abstractGameState", ""),
                    "detail": status.get("detailedState", ""),
                    "inning": line.get("currentInning"),
                    "half": line.get("inningState", ""),
                    "home_id": (home.get("team") or {}).get("id"),
                    "home_name": (home.get("team") or {}).get("name", ""),
                    "home_score": home.get("score"),
                    "away_id": (away.get("team") or {}).get("id"),
                    "away_name": (away.get("team") or {}).get("name", ""),
                    "away_score": away.get("score"),
                }
            )
    return games


def fetch_standings(season: int, timeout: float = 20.0) -> list[dict[str, Any]]:
    """Return the six divisions with each club's record."""
    url = (
        f"{API_BASE}/standings?leagueId=103,104&season={season}"
        "&standingsTypes=regularSeason&hydrate=division,team"
    )
    data = _get_json(url, timeout=timeout)
    divisions: list[dict[str, Any]] = []
    for record in data.get("records", []):
        division = (record.get("division") or {}).get("name", "")
        teams = []
        for row in record.get("teamRecords", []):
            team = row.get("team") or {}
            teams.append(
                {
                    "id": team.get("id"),
                    "name": to_japanese_team(team.get("name", "")),
                    "wins": row.get("wins"),
                    "losses": row.get("losses"),
                    "pct": row.get("winningPercentage", ""),
                    "gb": row.get("gamesBack", ""),
                }
            )
        if teams:
            divisions.append({"division": to_japanese_division(division), "teams": teams})
    return divisions


def fetch_leaders(season: int, timeout: float = 20.0) -> list[dict[str, Any]]:
    """Return the top ten of each leader board in :data:`LEADER_CATEGORIES`.

    One request per category. Asking for every category at once looks cheaper
    but the API answers with a board per league *and per stat group*, which is
    how the first live run ended up showing a catcher leading home runs and
    Kyle Schwarber leading strikeouts (his batting strikeouts).
    """
    boards: list[dict[str, Any]] = []
    for category, label, group in LEADER_CATEGORIES:
        url = (
            f"{API_BASE}/stats/leaders?leaderCategories={category}"
            f"&statGroup={group}&season={season}&sportId=1&limit=10"
        )
        data = _safe(f"leaders/{category}", lambda: _get_json(url, timeout=timeout), {})
        rows = merge_leader_boards(data, category, group)
        if rows:
            boards.append({"category": category, "label": label, "group": group, "rows": rows})
    return boards


def merge_leader_boards(data: dict, category: str, group: str) -> list[dict[str, Any]]:
    """Flatten the API's per-league boards into one MLB-wide top ten.

    Pure so it can be tested against a captured response. The API may answer
    with a league-wide board *and* one per league, so players are de-duplicated
    by id and the ranks are recomputed from the values.
    """
    seen: dict[Any, dict[str, Any]] = {}
    rows: list[dict[str, Any]] = []
    for board in data.get("leagueLeaders", []):
        if board.get("leaderCategory") != category:
            continue
        if board.get("statGroup") not in (None, "", group):
            continue
        for leader in board.get("leaders", []):
            person = leader.get("person") or {}
            pid = person.get("id")
            row = {
                "id": pid,
                "rank": leader.get("rank"),
                "name": to_japanese(person.get("fullName", "")),
                "team": to_japanese_team((leader.get("team") or {}).get("name", "")),
                "value": leader.get("value", ""),
            }
            if pid is not None and pid in seen:
                continue
            if pid is not None:
                seen[pid] = row
            rows.append(row)

    ascending = category in ASCENDING_CATEGORIES
    worst = float("inf") if ascending else float("-inf")

    def sort_key(row: dict[str, Any]) -> float:
        try:
            return float(row["value"])
        except (TypeError, ValueError):
            return worst  # unparseable values sink, whichever way we sort

    rows.sort(key=sort_key, reverse=not ascending)
    rows = rows[:10]
    for i, row in enumerate(rows):
        row["rank"] = i + 1
    return rows


def _safe(what: str, call: Any, default: Any) -> Any:
    """Run a fetcher, returning ``default`` if it fails.

    One broken endpoint should cost its own section, not the whole page.
    """
    try:
        return call()
    except (urllib.error.URLError, ValueError, KeyError, TypeError) as exc:
        logger.warning("%s unavailable: %s", what, exc)
        return default


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
    roster: list[dict[str, Any]] = []
    schedule_cache: dict[tuple[int, str], dict[str, Any] | None] = {}

    for player in players:
        try:
            stats = fetch_player_stats(player["id"], season, timeout=timeout)
        except (urllib.error.URLError, ValueError, KeyError) as exc:
            logger.warning("skipping %s (id=%s): %s", player["name"], player["id"], exc)
            continue

        name = to_japanese(player["name"])
        # The player id is carried through so the page can build a headshot URL.
        base = {
            "id": player["id"],
            "name": name,
            "team": to_japanese_team(stats["team"]),
            "team_id": stats.get("team_id"),
        }
        if stats["hitting"]:
            hitters.append({**base, "stat": stats["hitting"]})
        if stats["pitching"]:
            pitchers.append({**base, "stat": stats["pitching"]})

        last_game = stats.get("last_game")
        entry = None
        if last_game:
            entry = _build_recent_entry(
                player["id"], name, last_game, schedule_cache, timeout
            )
            if entry:
                recent.append(entry)

        # One record per player, so the page can show today's line and the
        # season totals together instead of in separate tables.
        roster.append({
            **base,
            "hitting": stats["hitting"],
            "pitching": stats["pitching"],
            **{k: v for k, v in (entry or {}).items() if k not in base},
        })

    hitters.sort(key=lambda h: _to_float(h["stat"].get("homeRuns")), reverse=True)
    pitchers.sort(key=lambda p: _to_float(p["stat"].get("strikeOuts")), reverse=True)
    recent.sort(key=lambda r: r.get("date") or "", reverse=True)
    # Most recent game first; a player with no game log has no date, so the
    # empty string sinks them to the bottom.
    roster.sort(key=lambda p: p.get("date") or "", reverse=True)

    # US game days straddle the JST date, so look at today and yesterday and
    # let the page pick the game that matters for each club.
    today = datetime.now(timezone.utc).date()
    game_days = [str(today), str(today - timedelta(days=1))]
    games: list[dict[str, Any]] = []
    for day in game_days:
        games.extend(_safe(f"schedule {day}", lambda d=day: fetch_games(d, timeout), []))

    return {
        "date": datetime.now(JST).strftime("%Y-%m-%d"),
        "generated_at": now_stamp(),
        "season": season,
        "hitters": hitters,
        "pitchers": pitchers,
        "recent": recent,
        "players": roster,
        "games": games,
        "standings": _safe("standings", lambda: fetch_standings(season, timeout), []),
        "leaders": _safe("leaders", lambda: fetch_leaders(season, timeout), []),
    }


def _build_recent_entry(
    player_id: int,
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
        "id": player_id,
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


def now_stamp() -> str:
    """Current time as a JST display string, e.g. ``2026-07-26 11:39 JST``."""
    return datetime.now(JST).strftime("%Y-%m-%d %H:%M JST")


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
:root{
  color-scheme:dark;
  --bg:#080b12; --surface:#111826; --surface2:#0d1420; --line:#1f2a3a;
  --fg:#e9eef7; --muted:#8b98ad; --accent:#38bdf8; --accent2:#a78bfa;
  --win:#34d399; --lose:#fb7185;
}
*{box-sizing:border-box}
body{
  margin:0; padding:0 0 3rem; background:var(--bg); color:var(--fg); line-height:1.6;
  font-family:-apple-system,BlinkMacSystemFont,"Hiragino Kaku Gothic ProN",
    "Noto Sans JP","Yu Gothic",Meiryo,sans-serif;
  -webkit-font-smoothing:antialiased;
}
main{max-width:1040px;margin:0 auto;padding:0 1rem}
.hero{
  padding:2.2rem 1rem 1.7rem; margin-bottom:.6rem; border-bottom:1px solid var(--line);
  background:
    radial-gradient(90rem 26rem at 12% -45%, rgba(56,189,248,.20), transparent 60%),
    radial-gradient(70rem 24rem at 92% -35%, rgba(167,139,250,.18), transparent 60%),
    linear-gradient(180deg,#0d1626,var(--bg));
}
.hero-inner{max-width:1040px;margin:0 auto}
.eyebrow{
  display:inline-block; font-size:.72rem; letter-spacing:.18em; font-weight:700;
  color:#7dd3fc; border:1px solid rgba(125,211,252,.35);
  padding:.18rem .6rem; border-radius:999px; margin-bottom:.7rem;
}
h1{
  margin:0; font-size:clamp(1.5rem,4.6vw,2.2rem); line-height:1.25; letter-spacing:-.02em;
  background:linear-gradient(90deg,#fff,#9ad9ff 72%);
  -webkit-background-clip:text; background-clip:text; color:transparent;
}
.meta{margin:.55rem 0 0;color:var(--muted);font-size:.86rem}
h2{font-size:1.06rem; margin:2.2rem 0 .8rem; display:flex; align-items:center; gap:.55rem}
h2::before{
  content:""; width:.28rem; height:1.05em; border-radius:99px;
  background:linear-gradient(180deg,var(--accent),var(--accent2));
}
.avatar{
  position:relative; display:inline-grid; place-items:center; flex:none;
  border-radius:50%; overflow:hidden; isolation:isolate; border:1px solid var(--line);
  background:linear-gradient(145deg,#1b2537,#0f1826);
}
.avatar b{position:absolute;inset:0;display:grid;place-items:center;color:var(--muted);font-weight:700}
/* border-radius on the image itself, not just the frame: iOS Safari does not
   clip a positioned child to the parent's rounded corners, which let the
   headshot spill outside the circle. */
.avatar img{
  position:relative; z-index:1; width:100%; height:100%; display:block;
  object-fit:cover; border-radius:50%;
}
.avatar.lg{width:64px;height:64px;font-size:1.25rem}
.avatar.sm{width:30px;height:30px;font-size:.8rem}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:.75rem}
.pcard{
  display:flex; align-items:center; gap:.8rem; padding:.8rem .9rem; border-radius:14px;
  background:linear-gradient(180deg,var(--surface),var(--surface2)); border:1px solid var(--line);
}
.pbody{min-width:0;flex:1}
.pname{font-weight:700;font-size:1.02rem}
.pmeta{color:var(--muted);font-size:.8rem;margin-top:.05rem}
.pline{margin-top:.3rem;color:var(--accent);font-weight:700;font-size:.94rem;overflow-wrap:anywhere}
.badge{
  flex:none; align-self:flex-start; font-size:.78rem; font-weight:700; white-space:nowrap;
  padding:.2rem .55rem; border-radius:999px; border:1px solid var(--line); color:var(--muted);
}
.badge.win{color:var(--win);border-color:rgba(52,211,153,.42);background:rgba(52,211,153,.10)}
.badge.lose{color:var(--lose);border-color:rgba(251,113,133,.42);background:rgba(251,113,133,.10)}
.pteam{font-weight:400;font-size:.82rem;color:var(--muted);margin-left:.4rem}
/* Season totals sit inside the card, under today's line. */
.season{margin-top:.6rem;padding-top:.55rem;border-top:1px solid var(--line);display:grid;gap:.4rem}
.srow{display:flex;flex-wrap:wrap;align-items:baseline;gap:.5rem}
.slabel{
  flex:none; font-size:.7rem; color:var(--muted);
  border:1px solid var(--line); border-radius:999px; padding:.05rem .45rem;
}
.stat{display:flex;align-items:baseline;gap:.22rem;font-size:.88rem}
.stat i{font-style:normal;color:var(--muted);font-size:.7rem}
.stat b{font-weight:700}
.stat.key b{color:var(--accent)}
.empty{padding:1rem;color:var(--muted)}
/* tabs */
.tabs{display:flex;gap:.4rem;margin:0 0 1.1rem;flex-wrap:wrap}
.tab{
  appearance:none; cursor:pointer; font:inherit; font-size:.9rem; font-weight:700;
  color:var(--muted); background:var(--surface2); border:1px solid var(--line);
  padding:.42rem .9rem; border-radius:999px;
}
.tab[aria-selected="true"]{
  color:#06121f; border-color:transparent;
  background:linear-gradient(90deg,var(--accent),var(--accent2));
}
.panel[hidden]{display:none}
/* game status chip */
.status{font-size:.78rem;font-weight:700;margin-top:.25rem}
.status.live{color:var(--accent2)}
.status.final{color:var(--muted)}
.status.pre{color:var(--muted)}
.dot{
  display:inline-block;width:.45rem;height:.45rem;border-radius:50%;
  background:var(--lose);margin-right:.35rem;vertical-align:middle;
}
/* standings + leader boards */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:.75rem}
.box{
  background:linear-gradient(180deg,var(--surface),var(--surface2));
  border:1px solid var(--line);border-radius:14px;padding:.85rem .95rem;
}
.box h3{margin:0 0 .55rem;font-size:.95rem;color:var(--accent)}
.row{
  display:flex;align-items:baseline;gap:.5rem;padding:.28rem 0;
  border-bottom:1px solid var(--line);font-size:.9rem;
}
.row:last-child{border-bottom:none}
.row .nm{flex:1;min-width:0;overflow-wrap:anywhere}
.row .no{color:var(--muted);font-size:.78rem;width:1.5rem;flex:none}
.row .vl{font-weight:700;flex:none}
.row .sub{color:var(--muted);font-size:.78rem;flex:none}
.row.jp{background:rgba(56,189,248,.09);border-radius:6px}
.row.jp .nm{color:var(--accent);font-weight:700}
footer{margin:2.6rem auto 0;max-width:1040px;padding:0 1rem;color:var(--muted);font-size:.82rem}
footer a{color:var(--accent)}

/* Phone: one card per row. */
@media (max-width: 700px){
  main{padding:0 .75rem}
  .cards{grid-template-columns:1fr}
  .pcard{align-items:flex-start}
}
""".strip()

# MLB's public headshot CDN. The ``d_people:generic...`` segment is a default
# image, so an id without a portrait yields a silhouette rather than a 404.
PHOTO_URL = (
    "https://img.mlbstatic.com/mlb-photos/image/upload/"
    "d_people:generic:headshot:67:current.png/w_240,q_auto:best/"
    "v1/people/{id}/headshot/67/current"
)


# MLB's circular "spot" portrait: cropped square and framed for a round avatar,
# unlike the headshot above, which is a cut-out whose subject deliberately
# overflows a grey disc and therefore sits badly inside a circular frame.
SPOT_URL = "https://midfield.mlbstatic.com/v1/people/{id}/spots/120"


def photo_url(player_id: Any) -> str:
    """Headshot URL for ``player_id`` (empty string when the id is missing)."""
    return PHOTO_URL.format(id=player_id) if player_id else ""


def spot_url(player_id: Any) -> str:
    """Circular-avatar portrait URL (empty string when the id is missing)."""
    return SPOT_URL.format(id=player_id) if player_id else ""


_PAGE_JS = r"""
/* The page's only renderer.

   format_html ships a data snapshot in <script id="mlb-data"> and nothing
   else: this script draws the snapshot immediately (so the page is useful
   offline and paints instantly), then refetches from the MLB API and redraws.
   A failed refresh leaves the snapshot on screen. */
(function () {
  var el = document.getElementById("mlb-data");
  if (!el) return;
  var DATA;
  try { DATA = JSON.parse(el.textContent); } catch (e) { return; }

  var API = "https://statsapi.mlb.com/api/v1";
  var app = document.getElementById("app");
  var stampEl = document.getElementById("updated");
  var countsEl = document.getElementById("counts");
  var ONERR = "var f=this.dataset.fallback;if(f){this.dataset.fallback='';this.src=f;}else{this.remove();}";

  var HIT_FIELDS = [["試合", "gamesPlayed", 0], ["打率", "avg", 1], ["本塁打", "homeRuns", 1],
                    ["打点", "rbi", 0], ["OPS", "ops", 0], ["出塁率", "obp", 0]];
  var PIT_FIELDS = [["登板", "gamesPlayed", 0], ["防御率", "era", 1], ["勝", "wins", 0],
                    ["敗", "losses", 0], ["奪三振", "strikeOuts", 1], ["WHIP", "whip", 0],
                    ["投球回", "inningsPitched", 0]];
  var TABS = [["players", "選手"], ["standings", "順位表"], ["leaders", "個人成績"]];

  /* ---------- small helpers ---------- */
  function esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
  }
  function cell(v) { return (v === null || v === undefined || v === "") ? "-" : String(v); }
  function ecell(v) { return esc(cell(v)); }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? -1 : n; }
  function teamJa(n) { return (DATA.teams && DATA.teams[n]) || n || ""; }

  function getJSON(url) {
    var u = url + (url.indexOf("?") < 0 ? "?" : "&") + "_=" + Date.now();
    return fetch(u, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  function jstStamp(d) {
    var t = new Date(d.getTime() + 9 * 3600 * 1000);
    function z(n) { return (n < 10 ? "0" : "") + n; }
    return t.getUTCFullYear() + "-" + z(t.getUTCMonth() + 1) + "-" + z(t.getUTCDate()) +
      " " + z(t.getUTCHours()) + ":" + z(t.getUTCMinutes()) + " JST";
  }
  function jstTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var t = new Date(d.getTime() + 9 * 3600 * 1000);
    function z(n) { return (n < 10 ? "0" : "") + n; }
    return z(t.getUTCHours()) + ":" + z(t.getUTCMinutes());
  }

  function avatar(row, size) {
    var initial = esc(String(row.name || "?").charAt(0));
    var img = "";
    if (row.id) {
      var spot = "https://midfield.mlbstatic.com/v1/people/" + row.id + "/spots/120";
      var head = "https://img.mlbstatic.com/mlb-photos/image/upload/" +
        "d_people:generic:headshot:67:current.png/w_240,q_auto:best/v1/people/" +
        row.id + "/headshot/67/current";
      img = '<img src="' + esc(spot) + '" data-fallback="' + esc(head) +
        '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="' + esc(ONERR) + '">';
    }
    return '<span class="avatar ' + size + '"><b>' + initial + "</b>" + img + "</span>";
  }

  /* ---------- today's game for a club ---------- */
  var HALF = { Top: "表", Bottom: "裏", Middle: "表", End: "裏" };

  function gameForTeam(teamId) {
    if (!teamId || !DATA.games) return null;
    var mine = DATA.games.filter(function (g) {
      return g.home_id === teamId || g.away_id === teamId;
    });
    if (!mine.length) return null;
    function pick(state) {
      var hits = mine.filter(function (g) { return g.state === state; });
      hits.sort(function (a, b) { return (a.start || "") < (b.start || "") ? 1 : -1; });
      return hits[0];
    }
    /* A game in progress matters most, then the game just finished. */
    return pick("Live") || pick("Final") || pick("Preview") || null;
  }

  function statusHtml(teamId) {
    var g = gameForTeam(teamId);
    if (!g) return "";
    var home = g.home_id === teamId;
    var mine = home ? g.home_score : g.away_score;
    var theirs = home ? g.away_score : g.home_score;
    var opp = teamJa(home ? g.away_name : g.home_name);
    if (g.state === "Live") {
      var half = HALF[g.half] || "";
      var inn = g.inning ? g.inning + "回" + half : (g.detail || "");
      return '<div class="status live"><span class="dot"></span>試合中 ' +
        esc(inn) + " " + ecell(mine) + "-" + ecell(theirs) + " vs " + esc(opp) + "</div>";
    }
    if (g.state === "Final") {
      var mark = "";
      if (mine != null && theirs != null && num(mine) !== num(theirs)) {
        mark = num(mine) > num(theirs) ? "勝" : "敗";
      }
      return '<div class="status final">試合終了 ' + esc(mark) + " " +
        ecell(mine) + "-" + ecell(theirs) + " vs " + esc(opp) + "</div>";
    }
    var at = jstTime(g.start);
    return '<div class="status pre">試合前 ' + esc(at ? at + " 開始" : g.detail) +
      " vs " + esc(opp) + "</div>";
  }

  /* ---------- tab: players ---------- */
  function statRow(label, stat, fields) {
    var chips = fields.map(function (f) {
      return '<span class="' + (f[2] ? "stat key" : "stat") + '"><b>' +
        ecell(stat[f[1]]) + "</b><i>" + esc(f[0]) + "</i></span>";
    }).join("");
    return '<div class="srow"><span class="slabel">' + esc(label) + "</span>" + chips + "</div>";
  }
  function seasonBlock(p) {
    var rows = [];
    if (p.hitting) rows.push(statRow("打撃", p.hitting, HIT_FIELDS));
    if (p.pitching) rows.push(statRow("投球", p.pitching, PIT_FIELDS));
    return rows.length ? '<div class="season">' + rows.join("") + "</div>" : "";
  }
  function matchup(r) {
    var o = cell(r.opponent);
    return r.home === true ? "vs " + o : (r.home === false ? "@ " + o : o);
  }
  function shortDate(d) { var t = cell(d).split("-"); return t.length === 3 ? t[1] + "/" + t[2] : cell(d); }
  function teamResult(r) {
    var res = r.result || "", ts = r.team_score, os = r.opp_score;
    if (ts != null && os != null) {
      if (!res) {
        var a = num(ts), b = num(os);
        if (a >= 0 && b >= 0 && a !== b) res = a > b ? "勝" : "敗";
      }
      return (res + " " + ts + "-" + os).replace(/^\s+|\s+$/g, "");
    }
    return res || "-";
  }

  function playersPanel() {
    if (!DATA.players || !DATA.players.length) {
      return '<p class="empty">出場成績のある日本人選手は見つかりませんでした。</p>';
    }
    var cards = DATA.players.map(function (p) {
      var res = teamResult(p);
      var badge = res.charAt(0) === "勝" ? "badge win" : (res.charAt(0) === "敗" ? "badge lose" : "badge");
      var meta, line, badgeHtml;
      if (p.date) {
        meta = esc(shortDate(p.date)) + "　" + esc(matchup(p));
        line = '<div class="pline">' + ecell(p.line) + "</div>";
        badgeHtml = '<span class="' + badge + '">' + esc(res) + "</span>";
      } else {
        meta = "直近の出場なし";
        line = "";
        badgeHtml = "";
      }
      return '<article class="pcard">' + avatar(p, "lg") +
        '<div class="pbody"><div class="pname">' + esc(p.name) +
        '<span class="pteam">' + esc(p.team) + "</span></div>" +
        '<div class="pmeta">' + meta + "</div>" +
        statusHtml(p.team_id) + line + seasonBlock(p) +
        "</div>" + badgeHtml + "</article>";
    });
    return '<div class="cards">' + cards.join("") + "</div>";
  }

  /* ---------- tab: standings ---------- */
  function jpTeamIds() {
    var ids = {};
    (DATA.players || []).forEach(function (p) { if (p.team_id) ids[p.team_id] = 1; });
    return ids;
  }
  function standingsPanel() {
    if (!DATA.standings || !DATA.standings.length) {
      return '<p class="empty">順位表を取得できませんでした。</p>';
    }
    var jp = jpTeamIds();
    var boxes = DATA.standings.map(function (d) {
      var rows = d.teams.map(function (t, i) {
        return '<div class="row' + (jp[t.id] ? " jp" : "") + '">' +
          '<span class="no">' + (i + 1) + "</span>" +
          '<span class="nm">' + esc(t.name) + "</span>" +
          '<span class="vl">' + ecell(t.wins) + "-" + ecell(t.losses) + "</span>" +
          '<span class="sub">' + ecell(t.pct) + "</span>" +
          '<span class="sub">' + ecell(t.gb) + "</span></div>";
      }).join("");
      return '<div class="box"><h3>' + esc(d.division) + "</h3>" + rows + "</div>";
    });
    return '<div class="grid">' + boxes.join("") + "</div>";
  }

  /* ---------- tab: leaders ---------- */
  function jpPlayerIds() {
    var ids = {};
    (DATA.players || []).forEach(function (p) { if (p.id) ids[p.id] = 1; });
    return ids;
  }
  /* Japanese names, so a leader who joined after the last daily build — and is
     therefore missing from the roster — is still highlighted. */
  function jpNames() {
    var set = {};
    var names = DATA.names || {};
    Object.keys(names).forEach(function (k) { set[names[k]] = 1; set[k] = 1; });
    return set;
  }
  function leadersPanel() {
    if (!DATA.leaders || !DATA.leaders.length) {
      return '<p class="empty">個人成績を取得できませんでした。</p>';
    }
    var jp = jpPlayerIds(), byName = jpNames();
    var boxes = DATA.leaders.map(function (b) {
      var rows = b.rows.map(function (r) {
        var mine = jp[r.id] || byName[r.name];
        return '<div class="row' + (mine ? " jp" : "") + '">' +
          '<span class="no">' + ecell(r.rank) + "</span>" +
          '<span class="nm">' + esc(r.name) + "</span>" +
          '<span class="sub">' + esc(r.team) + "</span>" +
          '<span class="vl">' + ecell(r.value) + "</span></div>";
      }).join("");
      var head = b.group === "pitching" ? "投手" : "打者";
      return '<div class="box"><h3>' + esc(head + " " + b.label) + "</h3>" + rows + "</div>";
    });
    return '<div class="grid">' + boxes.join("") + "</div>";
  }

  /* ---------- shell ---------- */
  var PANELS = { players: playersPanel, standings: standingsPanel, leaders: leadersPanel };

  function current() {
    var want = (location.hash || "").replace("#", "");
    return PANELS[want] ? want : "players";
  }

  function render() {
    var active = current();
    var tabs = TABS.map(function (t) {
      return '<button class="tab" type="button" role="tab" data-tab="' + t[0] +
        '" aria-selected="' + (t[0] === active) + '">' + esc(t[1]) + "</button>";
    }).join("");
    var panels = TABS.map(function (t) {
      return '<section class="panel" id="panel-' + t[0] + '"' +
        (t[0] === active ? "" : " hidden") + ">" + PANELS[t[0]]() + "</section>";
    }).join("");
    app.innerHTML = '<div class="tabs" role="tablist">' + tabs + "</div>" + panels;

    app.querySelectorAll(".tab").forEach(function (b) {
      b.addEventListener("click", function () {
        location.hash = b.dataset.tab;
        render();
      });
    });

    if (countsEl) {
      var h = 0, p = 0;
      (DATA.players || []).forEach(function (x) { if (x.hitting) h++; if (x.pitching) p++; });
      countsEl.textContent = "野手 " + h + "名 / 投手 " + p + "名";
    }
    if (stampEl) stampEl.textContent = DATA.generated_at || "";
  }
  window.MLBLive = { render: render, data: function () { return DATA; } };

  /* ---------- live refresh ---------- */
  function lastGame(log) {
    var dates = log.filter(function (e) { return e[1].date; }).map(function (e) { return e[1].date; });
    if (!dates.length) return null;
    var latest = dates.sort()[dates.length - 1];
    var g = { date: latest, team_id: null, opponent: "", home: null, hitting: null, pitching: null };
    log.forEach(function (e) {
      var grp = e[0], sp = e[1];
      if (sp.date !== latest) return;
      if (grp === "hitting") g.hitting = sp.stat || {};
      else if (grp === "pitching") g.pitching = sp.stat || {};
      if (sp.team && sp.team.id) g.team_id = sp.team.id;
      if (sp.opponent && sp.opponent.name) g.opponent = sp.opponent.name;
      if (sp.isHome !== undefined && sp.isHome !== null) g.home = sp.isHome;
    });
    return g;
  }

  function loadPlayer(p) {
    var url = API + "/people/" + p.id + "?hydrate=stats(group=[hitting,pitching]," +
      "type=[season,gameLog],season=" + DATA.season + "),currentTeam";
    return getJSON(url).then(function (d) {
      var person = (d.people || [])[0] || {};
      var hitting = null, pitching = null, log = [];
      (person.stats || []).forEach(function (grp) {
        var type = (grp.type || {}).displayName, name = (grp.group || {}).displayName;
        var splits = grp.splits || [];
        if (type === "season") {
          if (splits.length) {
            if (name === "hitting") hitting = splits[0].stat;
            else if (name === "pitching") pitching = splits[0].stat;
          }
        } else if (type === "gameLog") {
          splits.forEach(function (sp) { log.push([name, sp]); });
        }
      });
      var team = person.currentTeam || {};
      return {
        id: p.id, name: p.name, team: teamJa(team.name || ""), team_id: team.id,
        hitting: hitting, pitching: pitching, last: lastGame(log)
      };
    }).catch(function () { return null; });
  }

  function loadGames(dates) {
    return Promise.all(dates.map(function (d) {
      return getJSON(API + "/schedule?sportId=1&date=" + d + "&hydrate=linescore")
        .then(function (data) {
          var out = [];
          (data.dates || []).forEach(function (day) {
            (day.games || []).forEach(function (g) {
              var st = g.status || {}, ln = g.linescore || {}, tm = g.teams || {};
              var home = tm.home || {}, away = tm.away || {};
              out.push({
                date: day.date, start: g.gameDate || "",
                state: st.abstractGameState || "", detail: st.detailedState || "",
                inning: ln.currentInning, half: ln.inningState || "",
                home_id: (home.team || {}).id, home_name: (home.team || {}).name || "",
                home_score: home.score,
                away_id: (away.team || {}).id, away_name: (away.team || {}).name || "",
                away_score: away.score
              });
            });
          });
          return out;
        }).catch(function () { return []; });
    })).then(function (lists) {
      return [].concat.apply([], lists);
    });
  }

  function loadStandings() {
    return getJSON(API + "/standings?leagueId=103,104&season=" + DATA.season +
      "&standingsTypes=regularSeason&hydrate=division,team").then(function (data) {
      return (data.records || []).map(function (rec) {
        return {
          division: (DATA.divisions || {})[(rec.division || {}).name] || (rec.division || {}).name || "",
          teams: (rec.teamRecords || []).map(function (row) {
            var t = row.team || {};
            return {
              id: t.id, name: teamJa(t.name || ""), wins: row.wins, losses: row.losses,
              pct: row.winningPercentage, gb: row.gamesBack
            };
          })
        };
      }).filter(function (d) { return d.teams.length; });
    }).catch(function () { return DATA.standings || []; });
  }

  /* One request per category, mirroring fetch_leaders: asking for all of them
     at once returns a board per league AND per stat group, which pairs the
     wrong players with the wrong numbers. */
  var ASCENDING = { earnedRunAverage: 1 };
  function mergeBoard(data, category, group) {
    var seen = {}, rows = [];
    (data.leagueLeaders || []).forEach(function (b) {
      if (b.leaderCategory !== category) return;
      if (b.statGroup && b.statGroup !== group) return;
      (b.leaders || []).forEach(function (l) {
        var person = l.person || {}, id = person.id;
        if (id != null && seen[id]) return;
        if (id != null) seen[id] = 1;
        rows.push({
          id: id, rank: l.rank,
          name: (DATA.names || {})[person.fullName] || person.fullName || "",
          team: teamJa((l.team || {}).name || ""), value: l.value
        });
      });
    });
    var asc = !!ASCENDING[category], worst = asc ? Infinity : -Infinity;
    rows.sort(function (a, b) {
      var x = parseFloat(a.value), y = parseFloat(b.value);
      if (isNaN(x)) x = worst;
      if (isNaN(y)) y = worst;
      return asc ? x - y : y - x;
    });
    rows = rows.slice(0, 10);
    rows.forEach(function (r, i) { r.rank = i + 1; });
    return rows;
  }
  function loadLeaders() {
    var cats = DATA.categories || [];
    if (!cats.length) return Promise.resolve(DATA.leaders || []);
    return Promise.all(cats.map(function (c) {
      return getJSON(API + "/stats/leaders?leaderCategories=" + c[0] +
        "&statGroup=" + c[2] + "&season=" + DATA.season + "&sportId=1&limit=10")
        .then(function (data) {
          var rows = mergeBoard(data, c[0], c[2]);
          return rows.length
            ? { category: c[0], label: c[1], group: c[2], rows: rows }
            : null;
        })
        .catch(function () { return null; });
    })).then(function (boards) {
      boards = boards.filter(Boolean);
      return boards.length ? boards : (DATA.leaders || []);
    });
  }

  function utcDay(offset) {
    var d = new Date(Date.now() - offset * 86400000);
    function z(n) { return (n < 10 ? "0" : "") + n; }
    return d.getUTCFullYear() + "-" + z(d.getUTCMonth() + 1) + "-" + z(d.getUTCDate());
  }

  function refresh() {
    if (!DATA.players || !DATA.players.length) return Promise.resolve(false);
    return Promise.all([
      Promise.all(DATA.players.map(loadPlayer)),
      loadGames([utcDay(0), utcDay(1)]),
      loadStandings(),
      loadLeaders()
    ]).then(function (out) {
      var people = out[0].filter(Boolean);
      if (!people.length) throw new Error("no players");
      var games = out[1];
      var byDate = {};
      games.forEach(function (g) { byDate[g.date] = 1; });

      var roster = people.map(function (p) {
        var card = {
          id: p.id, name: p.name, team: p.team, team_id: p.team_id,
          hitting: p.hitting, pitching: p.pitching
        };
        if (p.last) {
          var res = null;
          games.forEach(function (g) {
            if (g.date !== p.last.date) return;
            if (g.home_id !== p.last.team_id && g.away_id !== p.last.team_id) return;
            var home = g.home_id === p.last.team_id;
            res = {
              team_score: home ? g.home_score : g.away_score,
              opp_score: home ? g.away_score : g.home_score,
              opponent: teamJa(home ? g.away_name : g.home_name)
            };
          });
          card.date = p.last.date;
          card.opponent = (res && res.opponent) || teamJa(p.last.opponent || "");
          card.home = p.last.home;
          card.team_score = res ? res.team_score : null;
          card.opp_score = res ? res.opp_score : null;
          card.result = "";
          card.line = gameLine(p.last.hitting, p.last.pitching);
        }
        return card;
      });
      roster.sort(function (a, b) {
        var x = a.date || "", y = b.date || "";
        return x === y ? 0 : (x > y ? -1 : 1);
      });

      DATA.players = roster;
      if (games.length) DATA.games = games;
      DATA.standings = out[2];
      DATA.leaders = out[3];
      DATA.generated_at = jstStamp(new Date());
      render();
      return true;
    }).catch(function () { return false; });
  }

  function hitLine(s) {
    var p = [cell(s.atBats) + "打数" + cell(s.hits) + "安打"];
    if (num(s.homeRuns) > 0) p.push("本塁打" + s.homeRuns);
    if (num(s.rbi) > 0) p.push("打点" + s.rbi);
    if (num(s.baseOnBalls) > 0) p.push("四球" + s.baseOnBalls);
    return p.join(" ");
  }
  function pitLine(s) {
    var p = [];
    if (s.inningsPitched != null) p.push(s.inningsPitched + "回");
    if (s.earnedRuns != null) p.push(s.earnedRuns + "失点");
    if (s.strikeOuts != null) p.push(s.strikeOuts + "奪三振");
    return p.length ? p.join(" ") : "-";
  }
  function gameLine(h, p) {
    if (h && p) return "投: " + pitLine(p) + " / 打: " + hitLine(h);
    if (p) return pitLine(p);
    if (h) return hitLine(h);
    return "-";
  }

  window.addEventListener("hashchange", render);
  render();
  if (window.fetch && window.Promise) refresh();
})();
"""


def _data_json(data: dict[str, Any]) -> str:
    """The snapshot the page renders from, and everything it needs to refresh.

    Lookup tables travel with the page so freshly fetched data can be localised
    client-side without another round trip.
    """
    payload = {
        "generated_at": data.get("generated_at", ""),
        "season": data.get("season"),
        "players": data.get("players", []),
        "games": data.get("games", []),
        "standings": data.get("standings", []),
        "leaders": data.get("leaders", []),
        "teams": TEAM_NAMES,
        "divisions": DIVISION_NAMES,
        "names": JAPANESE_NAMES,
        "categories": [list(c) for c in LEADER_CATEGORIES],
    }
    # "</" would close the surrounding <script> element early.
    return json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")


def format_html(data: dict[str, Any]) -> str:
    """Render the page shell: styles, the data snapshot and the renderer.

    Pure function. All drawing happens in :data:`_PAGE_JS` — keeping a single
    renderer means the snapshot and the refreshed view cannot drift apart.
    """
    season = data.get("season", "?")
    players = data.get("players", [])
    n_hit = sum(1 for p in players if p.get("hitting"))
    n_pit = sum(1 for p in players if p.get("pitching"))
    updated = _esc(data.get("generated_at", data.get("date", "")))

    return (
        "<!doctype html>\n"
        '<html lang="ja">\n<head>\n'
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"<title>日本人メジャーリーガー成績 ({_esc(season)})</title>\n"
        f"<style>\n{_PAGE_CSS}\n</style>\n"
        "</head>\n<body>\n"
        '<header class="hero"><div class="hero-inner">\n'
        '<span class="eyebrow">MLB JAPANESE PLAYERS</span>\n'
        "<h1>日本人メジャーリーガー成績</h1>\n"
        f'<p class="meta">{_esc(season)}シーズン ・ 最終更新: '
        f'<span id="updated">{updated}</span></p>\n'
        f'<p class="meta"><span id="counts">野手 {n_hit}名 / 投手 {n_pit}名</span></p>\n'
        "</div></header>\n"
        '<main id="app"></main>\n'
        "<footer>データ提供: "
        '<a href="https://statsapi.mlb.com" rel="noopener">MLB Stats API</a>'
        "・写真: MLB。ページを開くたびに最新へ更新します。</footer>\n"
        f'<script id="mlb-data" type="application/json">{_data_json(data)}</script>\n'
        f"<script>{_PAGE_JS}</script>\n"
        "</body>\n</html>\n"
    )

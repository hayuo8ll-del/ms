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

import json
import logging
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger("scheduler.mlb")

API_BASE = "https://statsapi.mlb.com/api/v1"
USER_AGENT = "ms-scheduler/1.0 (+https://github.com/hayuo8ll-del/ms)"

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
    """Return season hitting/pitching stats and current team for one player.

    Hydrates both stat groups in a single request. ``hitting`` / ``pitching``
    are the raw ``stat`` dicts from the API (or ``None`` when the player has
    no split in that group for the season, e.g. has not played yet).
    """
    url = (
        f"{API_BASE}/people/{player_id}"
        f"?hydrate=stats(group=[hitting,pitching],type=season,season={season}),currentTeam"
    )
    data = _get_json(url, timeout=timeout)
    people = data.get("people") or []
    person = people[0] if people else {}
    team = (person.get("currentTeam") or {}).get("name", "")

    hitting: dict[str, Any] | None = None
    pitching: dict[str, Any] | None = None
    for group in person.get("stats", []):
        group_name = (group.get("group") or {}).get("displayName")
        splits = group.get("splits") or []
        if not splits:
            continue
        stat = splits[0].get("stat") or {}
        if group_name == "hitting":
            hitting = stat
        elif group_name == "pitching":
            pitching = stat

    return {"team": team, "hitting": hitting, "pitching": pitching}


def collect_stats(season: int, timeout: float = 20.0) -> dict[str, Any]:
    """Gather structured stats for every active Japanese player.

    Returns ``{"date", "season", "hitters": [...], "pitchers": [...]}``.
    A player who both hits and pitches (e.g. a two-way player) appears in
    both lists. Failures fetching an individual player are logged and
    skipped so one bad response does not abort the whole run.
    """
    players = fetch_japanese_players(season, timeout=timeout)
    hitters: list[dict[str, Any]] = []
    pitchers: list[dict[str, Any]] = []

    for player in players:
        try:
            stats = fetch_player_stats(player["id"], season, timeout=timeout)
        except (urllib.error.URLError, ValueError, KeyError) as exc:
            logger.warning("skipping %s (id=%s): %s", player["name"], player["id"], exc)
            continue

        base = {"name": player["name"], "team": stats["team"]}
        if stats["hitting"]:
            hitters.append({**base, "stat": stats["hitting"]})
        if stats["pitching"]:
            pitchers.append({**base, "stat": stats["pitching"]})

    hitters.sort(key=lambda h: _to_float(h["stat"].get("homeRuns")), reverse=True)
    pitchers.sort(key=lambda p: _to_float(p["stat"].get("strikeOuts")), reverse=True)

    return {
        "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "season": season,
        "hitters": hitters,
        "pitchers": pitchers,
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
    """Render a stat value for a Markdown table cell."""
    if value is None or value == "":
        return "-"
    return str(value)


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


def format_report(data: dict[str, Any]) -> str:
    """Render structured stats (from :func:`collect_stats`) as Markdown."""
    season = data.get("season", "?")
    hitters = data.get("hitters", [])
    pitchers = data.get("pitchers", [])

    lines = [
        f"# 日本人メジャーリーガー成績 ({season}シーズン)",
        "",
        f"最終更新: {data.get('generated_at', data.get('date', ''))}",
        "",
        f"データ提供: MLB Stats API — 野手 {len(hitters)}名 / 投手 {len(pitchers)}名",
        "",
    ]

    if not hitters and not pitchers:
        lines.append(
            "現時点で出場成績のある日本人選手は見つかりませんでした"
            "(オフシーズン、または今シーズンの試合前の可能性があります)。"
        )
        return "\n".join(lines) + "\n"

    if hitters:
        lines.extend(_hitters_table(hitters))
        lines.append("")
    if pitchers:
        lines.extend(_pitchers_table(pitchers))
        lines.append("")

    return "\n".join(lines) + "\n"

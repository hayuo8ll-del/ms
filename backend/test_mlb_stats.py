#!/usr/bin/env python3
"""Offline unit tests for the formatting layer of ``mlb_stats``.

These tests exercise the pure functions only (no network), so they run
anywhere — including sandboxes where ``statsapi.mlb.com`` is blocked. Run
with::

    cd backend
    python3 -m unittest test_mlb_stats -v
"""

from __future__ import annotations

import json
import re
import unittest

from mlb_stats import (
    _game_line,
    _hitter_game_line,
    _pitcher_game_line,
    format_html,
    format_report,
    merge_leader_boards,
    now_stamp,
    photo_url,
    spot_url,
    to_japanese,
    to_japanese_team,
)

# A fixture mimicking the "recent games" structure produced by collect_stats.
RECENT_SAMPLE = {
    "date": "2026-07-25",
    "generated_at": "2026-07-25 04:00 UTC",
    "season": 2026,
    "hitters": [],
    "pitchers": [],
    "recent": [
        {
            "name": "大谷翔平",
            "date": "2026-07-24",
            "opponent": "San Diego Padres",
            "home": False,
            "team_score": 5,
            "opp_score": 3,
            "result": "勝",
            "line": "投: 6.0回 2失点 7奪三振 / 打: 4打数2安打 本塁打1 打点2",
        },
        {
            "name": "鈴木誠也",
            "date": "2026-07-24",
            "opponent": "St. Louis Cardinals",
            "home": True,
            "team_score": 2,
            "opp_score": 4,
            "result": "敗",
            "line": "4打数1安打 打点1",
        },
    ],
    "players": [
        {
            "id": 660271, "name": "大谷翔平", "team": "ドジャース",
            "hitting": {"avg": ".310", "homeRuns": 35}, "pitching": None,
            "date": "2026-07-24", "opponent": "San Diego Padres", "home": False,
            "team_score": 5, "opp_score": 3, "result": "勝",
            "line": "投: 6.0回 2失点 7奪三振 / 打: 4打数2安打 本塁打1 打点2",
        },
        {
            "id": 673548, "name": "鈴木誠也", "team": "カブス",
            "hitting": {"avg": ".280", "homeRuns": 20}, "pitching": None,
            "date": "2026-07-24", "opponent": "St. Louis Cardinals", "home": True,
            "team_score": 2, "opp_score": 4, "result": "敗",
            "line": "4打数1安打 打点1",
        },
    ],
}

# A small fixture mimicking the structure produced by ``collect_stats``.
SAMPLE = {
    "date": "2026-07-25",
    "generated_at": "2026-07-25 04:00 UTC",
    "season": 2026,
    "hitters": [
        {
            "name": "Shohei Ohtani",
            "team": "Los Angeles Dodgers",
            "stat": {
                "gamesPlayed": 100,
                "avg": ".310",
                "homeRuns": 35,
                "rbi": 80,
                "ops": "1.050",
                "obp": ".410",
            },
        },
        {
            "name": "Seiya Suzuki",
            "team": "Chicago Cubs",
            "stat": {
                "gamesPlayed": 95,
                "avg": ".280",
                "homeRuns": 20,
                "rbi": 60,
                "ops": ".820",
                "obp": ".350",
            },
        },
    ],
    "pitchers": [
        {
            "name": "Yoshinobu Yamamoto",
            "team": "Los Angeles Dodgers",
            "stat": {
                "gamesPlayed": 20,
                "era": "2.85",
                "wins": 12,
                "losses": 4,
                "strikeOuts": 150,
                "whip": "1.05",
                "inningsPitched": "130.0",
            },
        },
    ],
    "players": [
        {
            "id": 660271, "name": "Shohei Ohtani", "team": "Los Angeles Dodgers",
            "hitting": {
                "gamesPlayed": 100, "avg": ".310", "homeRuns": 35, "rbi": 80,
                "ops": "1.050", "obp": ".410",
            },
            "pitching": None,
            "date": "2026-07-24", "opponent": "San Diego Padres", "home": False,
            "team_score": 5, "opp_score": 3, "result": "勝", "line": "4打数2安打",
        },
        {
            "id": 808967, "name": "Yoshinobu Yamamoto", "team": "Los Angeles Dodgers",
            "hitting": None,
            "pitching": {
                "gamesPlayed": 20, "era": "2.85", "wins": 12, "losses": 4,
                "strikeOuts": 150, "whip": "1.05", "inningsPitched": "130.0",
            },
            "date": "2026-07-23", "opponent": "New York Mets", "home": True,
            "team_score": 4, "opp_score": 1, "result": "勝", "line": "7.0回 1失点 8奪三振",
        },
    ],
}


def payload(page: str) -> dict:
    """The data snapshot the page renders from."""
    raw = page.split('<script id="mlb-data" type="application/json">', 1)[1]
    return json.loads(raw.split("</script>", 1)[0].replace("<\\/", "</"))


def page_js(page: str) -> str:
    """The bundled renderer source."""
    return page.split("</script>\n<script>", 1)[1].split("</script>", 1)[0]


class FormatReportTests(unittest.TestCase):
    def test_includes_header_and_season(self) -> None:
        report = format_report(SAMPLE)
        self.assertIn("# 日本人メジャーリーガー成績 (2026シーズン)", report)
        self.assertIn("最終更新: 2026-07-25 04:00 UTC", report)

    def test_includes_player_names_and_tables(self) -> None:
        report = format_report(SAMPLE)
        self.assertIn("## 野手", report)
        self.assertIn("## 投手", report)
        self.assertIn("Shohei Ohtani", report)
        self.assertIn("Seiya Suzuki", report)
        self.assertIn("Yoshinobu Yamamoto", report)

    def test_includes_key_stats(self) -> None:
        report = format_report(SAMPLE)
        self.assertIn("35", report)  # Ohtani home runs
        self.assertIn("2.85", report)  # Yamamoto ERA
        self.assertIn("150", report)  # Yamamoto strikeouts

    def test_missing_values_render_as_dash(self) -> None:
        data = {
            "date": "2026-07-25",
            "generated_at": "2026-07-25 04:00 UTC",
            "season": 2026,
            "hitters": [{"name": "Test Player", "team": "", "stat": {}}],
            "pitchers": [],
        }
        report = format_report(data)
        self.assertIn("Test Player", report)
        self.assertIn("-", report)  # empty cells rendered as dash

    def test_empty_data_does_not_raise(self) -> None:
        data = {
            "date": "2026-01-15",
            "generated_at": "2026-01-15 04:00 UTC",
            "season": 2026,
            "hitters": [],
            "pitchers": [],
        }
        report = format_report(data)
        self.assertIn("見つかりませんでした", report)


class PageShellTests(unittest.TestCase):
    """The page ships a shell, a snapshot and one renderer."""

    def test_is_standalone_document(self) -> None:
        page = format_html(SAMPLE)
        self.assertTrue(page.lstrip().startswith("<!doctype html"))
        self.assertIn('<html lang="ja">', page)
        self.assertIn("<style>", page)  # self-contained, no external CSS
        self.assertIn('<main id="app"></main>', page)  # filled in by the script
        self.assertIn('<script id="mlb-data"', page)

    def test_header_counts_come_from_players(self) -> None:
        page = format_html(SAMPLE)
        self.assertIn("野手 1名 / 投手 1名", page)

    def test_snapshot_carries_every_section(self) -> None:
        data = payload(format_html(SAMPLE))
        for key in ("players", "games", "standings", "leaders"):
            self.assertIn(key, data)
        self.assertEqual(data["season"], 2026)

    def test_snapshot_carries_lookup_tables(self) -> None:
        """Refreshed data is localised client-side, so the tables travel too."""
        data = payload(format_html(SAMPLE))
        self.assertEqual(data["teams"]["Los Angeles Dodgers"], "ドジャース")
        self.assertEqual(data["divisions"]["American League East"], "ア・リーグ東")
        self.assertEqual(data["names"]["Shohei Ohtani"], "大谷翔平")
        self.assertIn(["homeRuns", "本塁打", "hitting"], data["categories"])

    def test_players_keep_the_ids_the_page_needs(self) -> None:
        data = {
            "date": "", "generated_at": "", "season": 2026,
            "hitters": [], "pitchers": [], "recent": [],
            "players": [{"id": 660271, "team_id": 119, "name": "大谷翔平",
                         "team": "ドジャース", "hitting": {}, "pitching": None}],
        }
        player = payload(format_html(data))["players"][0]
        self.assertEqual(player["id"], 660271)
        # team_id is how a player is matched to today's game.
        self.assertEqual(player["team_id"], 119)

    def test_payload_cannot_close_the_script_tag(self) -> None:
        data = {
            "date": "", "generated_at": "", "season": 2026,
            "hitters": [], "pitchers": [], "recent": [],
            "players": [{"id": 1, "name": "</script>x", "team": "T",
                         "hitting": {}, "pitching": None}],
        }
        page = format_html(data)
        raw = page.split('<script id="mlb-data" type="application/json">', 1)[1]
        self.assertNotIn("</script>", raw.split("</script>", 1)[0])
        # …and it still round-trips to the original name.
        self.assertEqual(payload(page)["players"][0]["name"], "</script>x")

    def test_empty_data_still_renders_a_page(self) -> None:
        data = {
            "date": "2026-01-15", "generated_at": "2026-01-15 04:00 JST",
            "season": 2026, "hitters": [], "pitchers": [], "recent": [],
            "players": [],
        }
        page = format_html(data)
        self.assertTrue(page.lstrip().startswith("<!doctype html"))
        self.assertEqual(payload(page)["players"], [])


class RendererTests(unittest.TestCase):
    """Feature coverage of the bundled renderer.

    Behaviour is verified in a browser (see scratchpad/test_live_js.py); these
    guard against a feature being dropped from the bundle entirely.
    """

    def setUp(self) -> None:
        self.js = page_js(format_html(SAMPLE))

    def test_has_the_three_tabs(self) -> None:
        for label in ("選手", "順位表", "個人成績"):
            self.assertIn(label, self.js)

    def test_renders_game_status_states(self) -> None:
        for label in ("試合中", "試合終了", "試合前"):
            self.assertIn(label, self.js)

    def test_keeps_the_full_season_field_set(self) -> None:
        for label in ("出塁率", "投球回", "WHIP"):
            self.assertIn(label, self.js)

    def test_refreshes_every_section(self) -> None:
        for endpoint in ("/schedule?sportId=1", "/standings?", "/stats/leaders?"):
            self.assertIn(endpoint, self.js)

    def test_stamps_jst(self) -> None:
        self.assertIn('" JST"', self.js)
        self.assertNotIn('" UTC"', self.js)

    def test_asks_for_one_leader_category_at_a_time(self) -> None:
        """Bundling the categories mixes stat groups — see LeaderBoardTests."""
        self.assertIn("&statGroup=", self.js)
        self.assertNotIn("leaderCategories=\" + cats", self.js)


def leader_board(category: str, group: str, rows: list, league: str = "") -> dict:
    return {
        "leaderCategory": category,
        "statGroup": group,
        "league": {"name": league} if league else {},
        "leaders": [
            {"rank": i + 1, "value": value,
             "person": {"id": pid, "fullName": name},
             "team": {"name": "Los Angeles Dodgers"}}
            for i, (pid, name, value) in enumerate(rows)
        ],
    }


class LeaderBoardTests(unittest.TestCase):
    """The live run showed a catcher leading home runs.

    /stats/leaders answers with a board per league *and per stat group*, so a
    single bundled request pairs the wrong players with the wrong numbers.
    """

    def test_wrong_stat_group_is_dropped(self) -> None:
        data = {"leagueLeaders": [
            leader_board("homeRuns", "hitting", [(1, "Yordan Alvarez", "35")]),
            # home runs *allowed* — a pitching board for the same category.
            leader_board("homeRuns", "pitching", [(2, "Aaron Nola", "28")]),
            leader_board("homeRuns", "catching", [(3, "Carson Kelly", "106")]),
        ]}
        rows = merge_leader_boards(data, "homeRuns", "hitting")
        self.assertEqual([r["name"] for r in rows], ["Yordan Alvarez"])

    def test_leagues_merge_into_one_board(self) -> None:
        data = {"leagueLeaders": [
            leader_board("homeRuns", "hitting",
                         [(1, "AL One", "40"), (2, "AL Two", "30")], "American League"),
            leader_board("homeRuns", "hitting",
                         [(3, "NL One", "44"), (4, "NL Two", "20")], "National League"),
        ]}
        rows = merge_leader_boards(data, "homeRuns", "hitting")
        self.assertEqual([r["name"] for r in rows],
                         ["NL One", "AL One", "AL Two", "NL Two"])
        self.assertEqual([r["rank"] for r in rows], [1, 2, 3, 4])

    def test_a_player_listed_twice_appears_once(self) -> None:
        """The API may return a league-wide board alongside the per-league ones."""
        data = {"leagueLeaders": [
            leader_board("homeRuns", "hitting", [(1, "Shohei Ohtani", "44")]),
            leader_board("homeRuns", "hitting", [(1, "Shohei Ohtani", "44")], "National League"),
        ]}
        rows = merge_leader_boards(data, "homeRuns", "hitting")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["name"], "大谷翔平")  # …and it is localised

    def test_era_ranks_smallest_first(self) -> None:
        data = {"leagueLeaders": [leader_board("earnedRunAverage", "pitching", [
            (1, "High", "3.90"), (2, "Low", "1.63"), (3, "Mid", "2.41"),
        ])]}
        rows = merge_leader_boards(data, "earnedRunAverage", "pitching")
        self.assertEqual([r["name"] for r in rows], ["Low", "Mid", "High"])

    def test_batting_average_sorts_numerically(self) -> None:
        data = {"leagueLeaders": [leader_board("battingAverage", "hitting", [
            (1, "Weak", ".216"), (2, "Best", ".331"), (3, "Good", ".291"),
        ])]}
        rows = merge_leader_boards(data, "battingAverage", "hitting")
        self.assertEqual([r["name"] for r in rows], ["Best", "Good", "Weak"])

    def test_board_is_capped_at_ten_despite_ties(self) -> None:
        """limit=10 is not honoured when values tie — the live run returned 16."""
        data = {"leagueLeaders": [leader_board(
            "wins", "pitching", [(i, f"P{i}", str(20 - i)) for i in range(16)])]}
        rows = merge_leader_boards(data, "wins", "pitching")
        self.assertEqual(len(rows), 10)
        self.assertEqual(rows[-1]["rank"], 10)

    def test_missing_values_sink_in_both_directions(self) -> None:
        for category, expected in (("homeRuns", "Real"), ("earnedRunAverage", "Real")):
            data = {"leagueLeaders": [leader_board(category, "pitching", [
                (1, "Blank", "-"), (2, "Real", "2.00"),
            ])]}
            rows = merge_leader_boards(data, category, "pitching")
            self.assertEqual(rows[0]["name"], expected)

    def test_empty_response_gives_no_rows(self) -> None:
        self.assertEqual(merge_leader_boards({}, "homeRuns", "hitting"), [])


class JapaneseNameTests(unittest.TestCase):
    def test_known_name_is_translated(self) -> None:
        self.assertEqual(to_japanese("Shohei Ohtani"), "大谷翔平")
        self.assertEqual(to_japanese("Yoshinobu Yamamoto"), "山本由伸")

    def test_recently_added_names(self) -> None:
        self.assertEqual(to_japanese("Kazuma Okamoto"), "岡本和真")
        self.assertEqual(to_japanese("Munetaka Murakami"), "村上宗隆")
        self.assertEqual(to_japanese("Tatsuya Imai"), "今井達也")

    def test_unknown_name_falls_back_to_english(self) -> None:
        self.assertEqual(to_japanese("John Newcomer"), "John Newcomer")


class JapaneseTeamTests(unittest.TestCase):
    def test_known_teams_are_shortened(self) -> None:
        self.assertEqual(to_japanese_team("Los Angeles Dodgers"), "ドジャース")
        self.assertEqual(to_japanese_team("San Diego Padres"), "パドレス")
        self.assertEqual(to_japanese_team("St. Louis Cardinals"), "カージナルス")

    def test_unknown_team_falls_back_to_english(self) -> None:
        self.assertEqual(to_japanese_team("Some New Club"), "Some New Club")


class PhotoTests(unittest.TestCase):
    def test_photo_url_uses_player_id(self) -> None:
        url = photo_url(660271)
        self.assertIn("/people/660271/headshot/", url)
        self.assertTrue(url.startswith("https://img.mlbstatic.com/"))

    def test_spot_url_uses_player_id(self) -> None:
        self.assertIn("/people/660271/spots/", spot_url(660271))

    def test_urls_empty_without_id(self) -> None:
        self.assertEqual(photo_url(None), "")
        self.assertEqual(photo_url(0), "")
        self.assertEqual(spot_url(None), "")

    def test_renderer_degrades_spot_to_headshot_to_initial(self) -> None:
        js = page_js(format_html(SAMPLE))
        self.assertIn("midfield.mlbstatic.com/v1/people/", js)
        self.assertIn("img.mlbstatic.com/mlb-photos/", js)
        self.assertIn("this.remove()", js)

class GameLineTests(unittest.TestCase):
    def test_hitter_line(self) -> None:
        line = _hitter_game_line(
            {"atBats": 4, "hits": 2, "homeRuns": 1, "rbi": 2, "baseOnBalls": 0}
        )
        self.assertEqual(line, "4打数2安打 本塁打1 打点2")

    def test_pitcher_line(self) -> None:
        line = _pitcher_game_line(
            {"inningsPitched": "6.0", "earnedRuns": 2, "strikeOuts": 7}
        )
        self.assertEqual(line, "6.0回 2失点 7奪三振")

    def test_two_way_line_shows_both(self) -> None:
        line = _game_line(
            {"atBats": 4, "hits": 2}, {"inningsPitched": "6.0", "strikeOuts": 7}
        )
        self.assertIn("投:", line)
        self.assertIn("打:", line)


class RecentSectionTests(unittest.TestCase):
    def test_markdown_includes_recent_section(self) -> None:
        report = format_report(RECENT_SAMPLE)
        self.assertIn("## 直近試合の結果", report)
        self.assertIn("大谷翔平", report)
        self.assertIn("勝 5-3", report)  # team result + score
        self.assertIn("@ San Diego Padres", report)  # away game marker
        self.assertIn("vs St. Louis Cardinals", report)  # home game marker

    def test_recent_games_reach_the_page(self) -> None:
        players = payload(format_html(RECENT_SAMPLE))["players"]
        names = [p["name"] for p in players]
        self.assertIn("大谷翔平", names)
        # Win/loss is derived from these scores by the renderer.
        suzuki = [p for p in players if p["name"] == "鈴木誠也"][0]
        self.assertEqual((suzuki["team_score"], suzuki["opp_score"]), (2, 4))

    def test_recent_only_data_is_not_treated_as_empty(self) -> None:
        report = format_report(RECENT_SAMPLE)
        self.assertNotIn("見つかりませんでした", report)

    def test_win_loss_derived_from_score_when_api_omits_it(self) -> None:
        """The schedule endpoint sometimes omits isWinner; scores still tell us."""
        data = {
            "date": "2026-07-25",
            "generated_at": "2026-07-25 04:00 UTC",
            "season": 2026,
            "hitters": [],
            "pitchers": [],
            "recent": [
                {
                    "name": "岡本和真",
                    "date": "2026-07-24",
                    "opponent": "レッドソックス",
                    "home": False,
                    "team_score": 3,
                    "opp_score": 4,
                    "result": "",
                    "line": "4打数2安打",
                },
                {
                    "name": "村上宗隆",
                    "date": "2026-07-24",
                    "opponent": "アストロズ",
                    "home": True,
                    "team_score": 6,
                    "opp_score": 5,
                    "result": "",
                    "line": "2打数1安打",
                },
            ],
        }
        report = format_report(data)
        self.assertIn("敗 3-4", report)
        self.assertIn("勝 6-5", report)

    def test_tie_score_shows_no_win_loss_mark(self) -> None:
        entry = {
            "name": "X",
            "date": "2026-07-24",
            "opponent": "Y",
            "home": True,
            "team_score": 2,
            "opp_score": 2,
            "result": "",
            "line": "-",
        }
        data = {
            "date": "2026-07-25",
            "generated_at": "",
            "season": 2026,
            "hitters": [],
            "pitchers": [],
            "recent": [entry],
        }
        report = format_report(data)
        self.assertIn("2-2", report)
        self.assertNotIn("勝 2-2", report)
        self.assertNotIn("敗 2-2", report)


if __name__ == "__main__":
    unittest.main()


class TimestampTests(unittest.TestCase):
    """Timestamps are shown in Japan time on both the snapshot and live paths."""

    def test_now_stamp_is_jst(self) -> None:
        stamp = now_stamp()
        self.assertRegex(stamp, r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2} JST$")

    def test_now_stamp_matches_utc_plus_nine(self) -> None:
        from datetime import datetime, timedelta, timezone

        expected = (datetime.now(timezone.utc) + timedelta(hours=9)).strftime("%Y-%m-%d %H:%M")
        self.assertTrue(now_stamp().startswith(expected[:13]), now_stamp())

    def test_refresh_script_stamps_jst(self) -> None:
        page = format_html(SAMPLE)
        self.assertIn('" JST"', page)
        self.assertNotIn('" UTC"', page)

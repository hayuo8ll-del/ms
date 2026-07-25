#!/usr/bin/env python3
"""Offline unit tests for the formatting layer of ``mlb_stats``.

These tests exercise the pure functions only (no network), so they run
anywhere — including sandboxes where ``statsapi.mlb.com`` is blocked. Run
with::

    cd backend
    python3 -m unittest test_mlb_stats -v
"""

from __future__ import annotations

import unittest

from mlb_stats import (
    _game_line,
    _hitter_game_line,
    _pitcher_game_line,
    format_html,
    format_report,
    to_japanese,
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
}


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


class FormatHtmlTests(unittest.TestCase):
    def test_is_standalone_html_document(self) -> None:
        page = format_html(SAMPLE)
        self.assertTrue(page.lstrip().startswith("<!doctype html"))
        self.assertIn('<html lang="ja">', page)
        self.assertIn("<style>", page)  # self-contained, no external CSS
        self.assertIn("<table", page)

    def test_includes_players_and_stats(self) -> None:
        page = format_html(SAMPLE)
        self.assertIn("Shohei Ohtani", page)
        self.assertIn("Yoshinobu Yamamoto", page)
        self.assertIn("野手", page)
        self.assertIn("投手", page)
        self.assertIn("35", page)  # Ohtani home runs
        self.assertIn("2.85", page)  # Yamamoto ERA

    def test_escapes_html_in_names(self) -> None:
        data = {
            "date": "2026-07-25",
            "generated_at": "2026-07-25 04:00 UTC",
            "season": 2026,
            "hitters": [
                {"name": "<script>", "team": "T & U", "stat": {"homeRuns": 1}}
            ],
            "pitchers": [],
        }
        page = format_html(data)
        self.assertNotIn("<script>", page)
        self.assertIn("&lt;script&gt;", page)
        self.assertIn("T &amp; U", page)

    def test_empty_data_does_not_raise(self) -> None:
        data = {
            "date": "2026-01-15",
            "generated_at": "2026-01-15 04:00 UTC",
            "season": 2026,
            "hitters": [],
            "pitchers": [],
        }
        page = format_html(data)
        self.assertIn("見つかりませんでした", page)
        self.assertTrue(page.lstrip().startswith("<!doctype html"))


class JapaneseNameTests(unittest.TestCase):
    def test_known_name_is_translated(self) -> None:
        self.assertEqual(to_japanese("Shohei Ohtani"), "大谷翔平")
        self.assertEqual(to_japanese("Yoshinobu Yamamoto"), "山本由伸")

    def test_unknown_name_falls_back_to_english(self) -> None:
        self.assertEqual(to_japanese("John Newcomer"), "John Newcomer")


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

    def test_html_includes_recent_section(self) -> None:
        page = format_html(RECENT_SAMPLE)
        self.assertIn("直近試合の結果", page)
        self.assertIn('class="recent"', page)
        self.assertIn("大谷翔平", page)
        self.assertIn("敗 2-4", page)  # team_score-opp_score

    def test_recent_only_data_is_not_treated_as_empty(self) -> None:
        report = format_report(RECENT_SAMPLE)
        self.assertNotIn("見つかりませんでした", report)


if __name__ == "__main__":
    unittest.main()

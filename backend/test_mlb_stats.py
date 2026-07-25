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

from mlb_stats import format_report

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


if __name__ == "__main__":
    unittest.main()

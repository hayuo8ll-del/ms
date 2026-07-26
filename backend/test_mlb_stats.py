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


def snapshot(page: str) -> str:
    """The server-rendered body only, excluding the bundled refresh script."""
    return page.split('<main id="app">', 1)[1].split("</main>", 1)[0]


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
        self.assertIn('class="pcard"', page)

    def test_includes_players_and_stats(self) -> None:
        body = snapshot(format_html(SAMPLE))
        self.assertIn("Shohei Ohtani", body)
        self.assertIn("Yoshinobu Yamamoto", body)
        self.assertIn("打撃", body)  # season block labels
        self.assertIn("投球", body)
        self.assertIn("35", body)  # Ohtani home runs
        self.assertIn("2.85", body)  # Yamamoto ERA

    def test_escapes_html_in_names(self) -> None:
        data = {
            "date": "2026-07-25",
            "generated_at": "2026-07-25 04:00 UTC",
            "season": 2026,
            "hitters": [],
            "pitchers": [],
            "players": [
                {"id": 1, "name": "<script>", "team": "T & U",
                 "hitting": {"homeRuns": 1}, "pitching": None}
            ],
        }
        body = snapshot(format_html(data))
        self.assertNotIn("<script>", body)
        self.assertIn("&lt;script&gt;", body)
        self.assertIn("T &amp; U", body)

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


class ReadabilityMarkupTests(unittest.TestCase):
    """Season totals live inside each card, next to today's line."""

    def test_season_block_sits_in_the_card(self) -> None:
        body = snapshot(format_html(SAMPLE))
        # No separate tables any more: the card carries the season figures.
        self.assertNotIn("<table", body)
        self.assertIn('class="season"', body)
        self.assertIn("<i>本塁打</i>", body)
        self.assertIn("<i>防御率</i>", body)
        self.assertIn("<i>出塁率</i>", body)  # full field set, not a subset

    def test_headline_stats_are_marked(self) -> None:
        body = snapshot(format_html(SAMPLE))
        # 打率 / 本塁打 for hitters, 防御率 / 奪三振 for pitchers.
        self.assertIn('<span class="stat key"><b>.310</b><i>打率</i></span>', body)
        self.assertIn('<span class="stat key"><b>35</b><i>本塁打</i></span>', body)
        self.assertIn('<span class="stat key"><b>2.85</b><i>防御率</i></span>', body)
        self.assertIn('<span class="stat key"><b>150</b><i>奪三振</i></span>', body)

    def test_two_way_player_shows_both_stat_rows(self) -> None:
        data = {
            "date": "", "generated_at": "", "season": 2026,
            "hitters": [], "pitchers": [],
            "players": [{
                "id": 660271, "name": "大谷翔平", "team": "ドジャース",
                "hitting": {"avg": ".310", "homeRuns": 41},
                "pitching": {"era": "2.41", "strikeOuts": 138},
                "date": "2026-07-26", "opponent": "メッツ", "home": False,
                "team_score": 8, "opp_score": 2, "result": "勝", "line": "投/打",
            }],
        }
        body = snapshot(format_html(data))
        self.assertIn('<span class="slabel">打撃</span>', body)
        self.assertIn('<span class="slabel">投球</span>', body)

    def test_player_without_a_game_still_renders(self) -> None:
        data = {
            "date": "", "generated_at": "", "season": 2026,
            "hitters": [], "pitchers": [],
            "players": [{"id": 5, "name": "控え選手", "team": "カブス",
                         "hitting": {"avg": ".000"}, "pitching": None}],
        }
        body = snapshot(format_html(data))
        self.assertIn("直近の出場なし", body)
        self.assertIn("控え選手", body)

    def test_recent_cards_highlight_the_player_line(self) -> None:
        page = format_html(RECENT_SAMPLE)
        self.assertIn('class="pline"', page)
        self.assertIn("4打数1安打 打点1", page)

    def test_page_has_phone_layout(self) -> None:
        page = format_html(SAMPLE)
        self.assertIn("@media (max-width: 700px)", page)
        self.assertIn(".cards{grid-template-columns:1fr}", page)


class PhotoTests(unittest.TestCase):
    def test_photo_url_uses_player_id(self) -> None:
        url = photo_url(660271)
        self.assertIn("/people/660271/headshot/", url)
        self.assertTrue(url.startswith("https://img.mlbstatic.com/"))

    def test_photo_url_empty_without_id(self) -> None:
        self.assertEqual(photo_url(None), "")
        self.assertEqual(photo_url(0), "")

    def test_spot_url_uses_player_id(self) -> None:
        url = spot_url(660271)
        self.assertIn("/people/660271/spots/", url)

    def test_avatar_falls_back_from_spot_to_headshot(self) -> None:
        """Photos degrade spot -> headshot -> initial, never a broken image."""
        data = {
            "date": "2026-07-25",
            "generated_at": "",
            "season": 2026,
            "hitters": [],
            "pitchers": [],
            "recent": [],
            "players": [
                {"id": 660271, "name": "大谷翔平", "team": "ドジャース",
                 "hitting": {}, "pitching": None}
            ],
        }
        page = format_html(data)
        self.assertIn("midfield.mlbstatic.com/v1/people/660271/spots/", page)
        self.assertIn('data-fallback="https://img.mlbstatic.com', page)
        self.assertIn("this.remove()", page)
        self.assertIn("<b>大</b>", page)

    def test_page_renders_headshots_when_ids_present(self) -> None:
        data = {
            "date": "2026-07-25",
            "generated_at": "2026-07-25 04:00 UTC",
            "season": 2026,
            "hitters": [],
            "pitchers": [],
            "players": [
                {
                    "id": 660271,
                    "name": "大谷翔平",
                    "team": "ドジャース",
                    "hitting": {"avg": ".310", "homeRuns": 35},
                    "pitching": None,
                }
            ],
            "recent": [
                {
                    "id": 808967,
                    "name": "山本由伸",
                    "date": "2026-07-24",
                    "opponent": "パドレス",
                    "home": True,
                    "team_score": 5,
                    "opp_score": 3,
                    "result": "勝",
                    "line": "7.0回 1失点 9奪三振",
                }
            ],
        }
        page = format_html(data)
        self.assertIn("/people/660271/spots/", page)
        self.assertIn("/people/660271/headshot/", page)  # kept as the fallback
        # Broken images fall back to the player's initial.
        self.assertIn("this.remove()", page)
        self.assertIn("<b>大</b>", page)

    def test_headshot_is_clipped_on_the_image_itself(self) -> None:
        """iOS Safari does not clip a positioned child to the parent's radius,
        so the image must carry its own border-radius or it spills out."""
        page = format_html(SAMPLE)
        css = page.split("<style>", 1)[1].split("</style>", 1)[0]
        img_rule = css.split(".avatar img{", 1)[1].split("}", 1)[0]
        self.assertIn("border-radius:50%", img_rule)
        self.assertIn("object-fit:cover", img_rule)

    def test_missing_id_still_renders_initial_without_img(self) -> None:
        data = {
            "date": "2026-07-25",
            "generated_at": "",
            "season": 2026,
            "hitters": [],
            "pitchers": [],
            "recent": [],
            "players": [{"name": "鈴木誠也", "team": "カブス",
                         "hitting": {"avg": ".280"}, "pitching": None}],
        }
        body = snapshot(format_html(data))
        self.assertIn("<b>鈴</b>", body)
        self.assertNotIn("img.mlbstatic.com", body)


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
        self.assertIn('class="pcard"', page)  # photo cards, not a table
        self.assertIn("大谷翔平", page)
        self.assertIn("敗 2-4", page)  # team_score-opp_score

    def test_recent_cards_colour_win_and_loss(self) -> None:
        page = format_html(RECENT_SAMPLE)
        self.assertIn('class="badge win"', page)
        self.assertIn('class="badge lose"', page)

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


class LiveRefreshTests(unittest.TestCase):
    """The page carries what it needs to refresh itself when opened."""

    def _config(self, page: str) -> dict:
        raw = page.split('<script id="mlb-config" type="application/json">', 1)[1]
        return json.loads(raw.split("</script>", 1)[0].replace("<\\/", "</"))

    def test_config_lists_players_with_ids(self) -> None:
        data = {
            "date": "2026-07-25",
            "generated_at": "2026-07-25 04:00 UTC",
            "season": 2026,
            "hitters": [
                {"id": 660271, "name": "大谷翔平", "team": "ドジャース", "stat": {}}
            ],
            "pitchers": [],
            "recent": [
                {
                    "id": 808967, "name": "山本由伸", "date": "2026-07-24",
                    "opponent": "パドレス", "home": True, "team_score": 5,
                    "opp_score": 3, "result": "勝", "line": "7.0回",
                }
            ],
        }
        cfg = self._config(format_html(data))
        self.assertEqual(cfg["season"], 2026)
        ids = sorted(p["id"] for p in cfg["players"])
        self.assertEqual(ids, [660271, 808967])
        # Team names travel with the page so the client can localise fresh data.
        self.assertEqual(cfg["teams"]["Los Angeles Dodgers"], "ドジャース")

    def test_config_json_cannot_close_the_script_tag(self) -> None:
        data = {
            "date": "", "generated_at": "", "season": 2026,
            "hitters": [{"id": 1, "name": "</script>x", "team": "T", "stat": {}}],
            "pitchers": [], "recent": [],
        }
        page = format_html(data)
        raw = page.split('<script id="mlb-config" type="application/json">', 1)[1]
        self.assertNotIn("</script>", raw.split("</script>", 1)[0])

    def test_page_ships_the_refresh_script(self) -> None:
        page = format_html(SAMPLE)
        self.assertIn('<main id="app">', page)
        self.assertIn('id="updated"', page)
        self.assertIn('id="counts"', page)
        self.assertIn("statsapi.mlb.com/api/v1", page)
        self.assertIn("window.MLBLive", page)

    def test_snapshot_survives_when_refresh_cannot_run(self) -> None:
        """No ids -> the script bails out and the snapshot stays on screen."""
        data = {
            "date": "", "generated_at": "", "season": 2026,
            "hitters": [], "pitchers": [], "recent": [],
            "players": [{"name": "鈴木誠也", "team": "カブス",
                         "hitting": {"avg": ".280"}, "pitching": None}],
        }
        page = format_html(data)
        self.assertEqual(self._config(page)["players"], [])
        self.assertIn("鈴木誠也", snapshot(page))


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

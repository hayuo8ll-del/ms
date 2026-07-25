#!/usr/bin/env python3
"""Task scheduler scaffold.

This is an intentionally small starting point for the project's backend
scheduler. It wraps the standard library ``sched`` module so that tasks can be
registered and run either once (the default) or continuously in a long-running
loop (``--daemon``).

The default, no-argument invocation runs any pending tasks a single time and
then exits with status ``0``. This is what the ``Scheduler Test`` CI workflow
(``.github/workflows/scheduler-test.yml``) executes via ``python3 scheduler.py``,
so the entry point must always terminate cleanly rather than block forever.

Standard library only — no third-party dependencies, so ``requirements.txt`` is
not required.
"""

from __future__ import annotations

import argparse
import logging
import sched
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

logger = logging.getLogger("scheduler")

DEFAULT_REPORT_DIR = Path(__file__).resolve().parent / "reports"
DEFAULT_SITE_DIR = Path(__file__).resolve().parent / "site"


@dataclass
class Scheduler:
    """A thin wrapper around :class:`sched.scheduler`.

    Tasks are plain callables registered with a delay (in seconds) relative to
    when :meth:`run` is called. Replace the example task in :func:`main` with
    real work as the backend grows.
    """

    timefunc: Callable[[], float] = time.monotonic
    delayfunc: Callable[[float], None] = time.sleep
    _scheduler: sched.scheduler = field(init=False)

    def __post_init__(self) -> None:
        self._scheduler = sched.scheduler(self.timefunc, self.delayfunc)

    def every(self, delay: float, action: Callable[..., None], *args: object) -> None:
        """Register ``action`` to run ``delay`` seconds from now."""
        self._scheduler.enter(delay, 1, action, argument=args)
        logger.debug("registered task %s (delay=%ss)", getattr(action, "__name__", action), delay)

    def run(self, blocking: bool = True) -> None:
        """Run all scheduled tasks that are due, then return.

        With ``blocking=True`` the call waits for each task's delay; with
        ``blocking=False`` only tasks whose time has already arrived run.
        """
        self._scheduler.run(blocking=blocking)

    @property
    def empty(self) -> bool:
        return self._scheduler.empty()


def heartbeat() -> None:
    """Example task. Replace with real scheduled work."""
    logger.info("scheduler heartbeat")


def mlb_report_task(season: int, output_dir: Path, site_dir: Path | None = None) -> Path:
    """Fetch Japanese MLB players' stats and write the daily report.

    Imported lazily so the default (offline) code path — the one CI runs —
    never touches the network layer. Writes ``{YYYY-MM-DD}.md`` plus a
    ``latest.md`` pointer into ``output_dir`` (committed history). When
    ``site_dir`` is given, also writes ``index.html`` there — the standalone
    page published to GitHub Pages. Returns the dated Markdown path.
    """
    from mlb_stats import collect_stats, format_html, format_report

    logger.info("collecting Japanese MLB player stats for season %s", season)
    data = collect_stats(season)
    report = format_report(data)

    output_dir.mkdir(parents=True, exist_ok=True)
    dated_path = output_dir / f"{data['date']}.md"
    dated_path.write_text(report, encoding="utf-8")
    (output_dir / "latest.md").write_text(report, encoding="utf-8")
    logger.info("wrote MLB report to %s", dated_path)

    if site_dir is not None:
        site_dir.mkdir(parents=True, exist_ok=True)
        index_path = site_dir / "index.html"
        index_path.write_text(format_html(data), encoding="utf-8")
        logger.info("wrote MLB web page to %s", index_path)

    return dated_path


def run_daemon(scheduler: Scheduler, interval: float) -> None:
    """Run ``heartbeat`` forever, roughly every ``interval`` seconds."""
    logger.info("starting scheduler daemon (interval=%ss); press Ctrl+C to stop", interval)
    try:
        while True:
            scheduler.every(0, heartbeat)
            scheduler.run()
            time.sleep(interval)
    except KeyboardInterrupt:
        logger.info("scheduler daemon stopped")


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Project task scheduler.")
    parser.add_argument(
        "--daemon",
        action="store_true",
        help="run continuously instead of executing pending tasks once and exiting",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=60.0,
        help="seconds between runs in --daemon mode (default: 60)",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        help="logging level, e.g. DEBUG, INFO, WARNING (default: INFO)",
    )
    parser.add_argument(
        "--mlb-report",
        action="store_true",
        help="fetch Japanese MLB players' stats and write a daily report "
        "(requires network access; used by the mlb-daily workflow)",
    )
    parser.add_argument(
        "--season",
        type=int,
        default=None,
        help="MLB season year for --mlb-report (default: current year)",
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_REPORT_DIR),
        help="directory for --mlb-report Markdown output (default: backend/reports)",
    )
    parser.add_argument(
        "--site-dir",
        default=str(DEFAULT_SITE_DIR),
        help="directory for the generated index.html web page published to "
        "GitHub Pages (default: backend/site)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, str(args.log_level).upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    scheduler = Scheduler()

    if args.mlb_report:
        from mlb_stats import default_season

        season = args.season if args.season is not None else default_season()
        scheduler.every(
            0, mlb_report_task, season, Path(args.output_dir), Path(args.site_dir)
        )
        scheduler.run()
        logger.info("scheduler run complete")
        return 0

    if args.daemon:
        run_daemon(scheduler, args.interval)
        return 0

    # Default (also used by CI): register example tasks, run them once, exit 0.
    scheduler.every(0, heartbeat)
    scheduler.run()
    logger.info("scheduler run complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

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
from typing import Callable

logger = logging.getLogger("scheduler")


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
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, str(args.log_level).upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    scheduler = Scheduler()

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

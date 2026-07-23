"""シフトカレンダー: 設備が実際に稼働できる時間帯(シフトウィンドウ)を管理する。

equipment_master.json の shiftModes/defaultShiftMode を基に、稼働時間帯のみを消費する
かたちで日時計算を行う。日をまたぐシフト(例: 20:30-05:30)にも対応する。
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta

ShiftWindow = tuple[datetime, datetime, str]  # (start, end, shift_name)


def _parse_time(value: str) -> time:
    hour, minute = value.split(":")
    hour_i, minute_i = int(hour), int(minute)
    if hour_i == 24 and minute_i == 0:
        return time(0, 0)  # "24:00" は翌日 00:00 として扱う(end_t<=start_tの折り返し処理に乗せる)
    return time(hour_i, minute_i)


class ShiftCalendar:
    """シフト定義から、稼働可能な時間帯のみを消費する日時計算を提供する。"""

    def __init__(self, shift_defs: list[dict], calendar_start: datetime, horizon_days: int = 180):
        if not shift_defs:
            raise ValueError("シフト定義が空です。")
        self._windows: list[ShiftWindow] = self._build_windows(shift_defs, calendar_start.date(), horizon_days)

    @staticmethod
    def _build_windows(shift_defs: list[dict], start_date: date, horizon_days: int) -> list[ShiftWindow]:
        windows: list[ShiftWindow] = []
        # 夜勤が前日から続いている可能性があるため1日前から生成する
        day = start_date - timedelta(days=1)
        for _ in range(horizon_days + 2):
            for shift in shift_defs:
                start_t = _parse_time(shift["start"])
                end_t = _parse_time(shift["end"])
                w_start = datetime.combine(day, start_t)
                w_end = datetime.combine(day, end_t)
                if end_t <= start_t:
                    w_end += timedelta(days=1)
                windows.append((w_start, w_end, shift["shiftName"]))
            day += timedelta(days=1)
        windows.sort(key=lambda w: w[0])
        return windows

    def _index_at_or_after(self, dt: datetime) -> int:
        for i, (_start, end, _name) in enumerate(self._windows):
            if end > dt:
                return i
        raise RuntimeError("シフトカレンダーの範囲を超えています。horizon_daysを延長してください。")

    def next_available(self, dt: datetime) -> datetime:
        """dt以降で、稼働ウィンドウ内に入る最初の時刻を返す(dtが既にウィンドウ内ならdtそのもの)。"""
        i = self._index_at_or_after(dt)
        start, _end, _name = self._windows[i]
        return max(dt, start)

    def window_at_or_after(self, dt: datetime) -> ShiftWindow:
        return self._windows[self._index_at_or_after(dt)]

    def is_a_shift(self, dt: datetime) -> bool:
        _start, _end, name = self.window_at_or_after(dt)
        return name.startswith("A")

    def next_window_start_after(self, dt: datetime) -> datetime:
        """dtが属する(または直後の)ウィンドウの、さらに次のウィンドウの開始時刻を返す。"""
        i = self._index_at_or_after(dt)
        start, _end, _name = self._windows[i]
        if dt < start:
            return start
        return self._windows[i + 1][0]

    def fits_in_single_window(self, start_dt: datetime, duration: timedelta) -> bool:
        start, end, _name = self.window_at_or_after(start_dt)
        actual_start = max(start_dt, start)
        return actual_start + duration <= end

    def advance(self, start_dt: datetime, duration: timedelta) -> datetime:
        """稼働ウィンドウ内の時間だけを消費してdurationだけ進めた終了時刻を返す(ウィンドウ外はスキップ)。"""
        remaining = duration
        i = self._index_at_or_after(start_dt)
        cur = max(start_dt, self._windows[i][0])
        while True:
            start, end, _name = self._windows[i]
            cur = max(cur, start)
            available = end - cur
            if available >= remaining:
                return cur + remaining
            remaining -= available
            i += 1
            cur = self._windows[i][0]

    def available_minutes_between(self, start: datetime, end: datetime) -> float:
        """start〜endのあいだで、実際に稼働ウィンドウに含まれる時間(分)を合計する。"""
        if end <= start:
            return 0.0
        total = 0.0
        i = self._index_at_or_after(start)
        cur = start
        while cur < end:
            w_start, w_end, _name = self._windows[i]
            seg_start = max(cur, w_start)
            seg_end = min(end, w_end)
            if seg_end > seg_start:
                total += (seg_end - seg_start).total_seconds() / 60
            if w_end >= end:
                break
            i += 1
            cur = self._windows[i][0]
        return total

    def next_valid_start(
        self,
        earliest_dt: datetime,
        duration: timedelta,
        require_a_shift: bool = False,
        max_tries: int = 400,
    ) -> datetime:
        """durationが単一ウィンドウに収まり(必要ならA勤限定で)開始できる最初の時刻を返す。"""
        dt = self.next_available(earliest_dt)
        for _ in range(max_tries):
            shift_ok = (not require_a_shift) or self.is_a_shift(dt)
            if shift_ok and self.fits_in_single_window(dt, duration):
                return dt
            dt = self.next_window_start_after(dt)
        raise ValueError(
            "条件を満たす稼働ウィンドウが見つかりませんでした"
            "(1回の作業時間がシフト長を超えている、またはシフト制約が厳しすぎる可能性があります)。"
        )

from datetime import date

from lawata.weather.service import summarize_rain


class FakeRainfall:
    def __init__(self, values: list[float]) -> None:
        self._values = values

    def daily_mm(self, lat: float, lon: float, start: date, end: date) -> list[float]:
        return self._values


def test_summarize_rain_is_dry_when_little_rain() -> None:
    summary = summarize_rain(FakeRainfall([0, 0, 1, 2, 0, 1, 1]), 14.2, 121.2, date(2026, 4, 1))
    assert summary.is_dry


def test_summarize_rain_is_wet_after_storm() -> None:
    summary = summarize_rain(FakeRainfall([0, 0, 0, 0, 0, 10, 0]), 14.2, 121.2, date(2026, 4, 1))
    assert not summary.is_dry

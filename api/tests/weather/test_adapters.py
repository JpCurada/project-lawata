from datetime import date
from typing import Any

import httpx
import pytest

from lawata.weather.adapters import ARCHIVE_URL, FORECAST_URL, OpenMeteoRainfall
from lawata.weather.domain import RainfallUnavailableError

START, END = date(2026, 9, 19), date(2026, 9, 25)
SEVEN_DAYS = [0.0, 1.5, 0.0, 20.0, 3.0, 0.0, 0.2]


def _client(answers: dict[str, Any], seen: list[httpx.Request]) -> httpx.Client:
    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        url = str(request.url).split("?")[0]
        answer = answers[url]
        if isinstance(answer, int):
            return httpx.Response(answer)
        return httpx.Response(200, json={"daily": {"precipitation_sum": answer}})

    return httpx.Client(transport=httpx.MockTransport(handle))


def test_reads_archive_for_manila_days() -> None:
    seen: list[httpx.Request] = []
    rainfall = OpenMeteoRainfall(_client({ARCHIVE_URL: SEVEN_DAYS}, seen))
    assert rainfall.daily_mm(14.2, 121.1, START, END) == SEVEN_DAYS
    params = seen[0].url.params
    assert params["start_date"] == "2026-09-19" and params["end_date"] == "2026-09-25"
    assert params["timezone"] == "Asia/Manila"


def test_falls_back_to_forecast_when_archive_lags() -> None:
    seen: list[httpx.Request] = []
    lagging = [*SEVEN_DAYS[:5], None, None]
    client = _client({ARCHIVE_URL: lagging, FORECAST_URL: SEVEN_DAYS}, seen)
    assert OpenMeteoRainfall(client).daily_mm(14.2, 121.1, START, END) == SEVEN_DAYS
    assert len(seen) == 2


def test_raises_instead_of_guessing_when_no_source_is_complete() -> None:
    client = _client({ARCHIVE_URL: 500, FORECAST_URL: [0.0] * 3}, [])
    with pytest.raises(RainfallUnavailableError):
        OpenMeteoRainfall(client).daily_mm(14.2, 121.1, START, END)

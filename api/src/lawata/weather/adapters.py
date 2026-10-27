"""Weather adapters: Open-Meteo daily rainfall."""

from datetime import date
from typing import Any

import httpx

from lawata.weather.domain import RainfallUnavailableError

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
# The archive lags real time by about 5 days; the forecast API also serves recent past days.
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"


class OpenMeteoRainfall:
    """`RainfallSource` backed by Open-Meteo (modeled daily precipitation, Manila days)."""

    def __init__(self, client: httpx.Client | None = None) -> None:
        self._client = client or httpx.Client(timeout=10)

    def daily_mm(self, lat: float, lon: float, start: date, end: date) -> list[float]:
        """Daily rain in mm from start to end inclusive; raise if any day is missing."""
        for url in (ARCHIVE_URL, FORECAST_URL):
            values = self._fetch(url, lat, lon, start, end)
            if values is not None:
                return values
        raise RainfallUnavailableError(f"no complete rainfall for {start}..{end}")

    def _fetch(
        self, url: str, lat: float, lon: float, start: date, end: date
    ) -> list[float] | None:
        params: dict[str, Any] = {
            "latitude": lat,
            "longitude": lon,
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "daily": "precipitation_sum",
            "timezone": "Asia/Manila",
        }
        try:
            response = self._client.get(url, params=params)
            response.raise_for_status()
            values = response.json()["daily"]["precipitation_sum"]
        except (httpx.HTTPError, KeyError, ValueError):
            return None
        expected_days = (end - start).days + 1
        if len(values) != expected_days or any(v is None for v in values):
            return None
        return [float(v) for v in values]

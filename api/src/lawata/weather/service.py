"""Weather use cases."""

from datetime import date, timedelta

from lawata.weather.domain import RainfallSource, RainSummary


def summarize_rain(source: RainfallSource, lat: float, lon: float, on: date) -> RainSummary:
    """Rain over the 3 and 7 days up to and including `on`."""
    daily = source.daily_mm(lat, lon, on - timedelta(days=6), on)
    return RainSummary(rain_3d_mm=sum(daily[-3:]), rain_7d_mm=sum(daily))

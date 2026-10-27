"""Weather domain: rain summaries and the rainfall port."""

from dataclasses import dataclass
from datetime import date
from typing import Protocol

DRY_RAIN_3D_MM = 5.0
DRY_RAIN_7D_MM = 15.0


@dataclass(frozen=True)
class RainSummary:
    """Rain totals before an observation."""

    rain_3d_mm: float
    rain_7d_mm: float

    @property
    def is_dry(self) -> bool:
        """True when recent rain cannot explain a plume."""
        return self.rain_3d_mm < DRY_RAIN_3D_MM and self.rain_7d_mm < DRY_RAIN_7D_MM


class RainfallUnavailableError(LookupError):
    """Raised when rainfall for the requested days cannot be found."""


class RainfallSource(Protocol):
    """Port for daily rainfall."""

    def daily_mm(self, lat: float, lon: float, start: date, end: date) -> list[float]:
        """Daily rain in mm from start to end inclusive."""
        ...

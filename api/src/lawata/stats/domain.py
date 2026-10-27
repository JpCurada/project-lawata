"""Stats domain: headline counts for the dashboard.

Every number is defined by an existing source of truth, never re-derived here:
- `dry_weather_plumes`: rows of the view `v_dry_weather_plumes` (same rule as sightings `is_dry`).
- `pending_sampling_tasks`: sampling tasks in status `pending_approval`.
- `last_scene_date`: latest acquisition day with `is_usable = true`, i.e. the newest
  Sentinel-2 date the detector could actually analyse (plume dates come from the same column).
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class DashboardStats:
    """Headline counts. `last_scene_date` is None when nothing has been ingested yet."""

    total_plumes: int
    dry_weather_plumes: int
    pending_sampling_tasks: int
    last_scene_date: dt.date | None

    def __post_init__(self) -> None:
        for name in ("total_plumes", "dry_weather_plumes", "pending_sampling_tasks"):
            if getattr(self, name) < 0:
                raise ValueError(f"{name} must not be negative")
        if self.dry_weather_plumes > self.total_plumes:
            raise ValueError("dry_weather_plumes cannot exceed total_plumes")


class StatsRepository(Protocol):
    """Port for read-only dashboard aggregates."""

    def get_stats(self) -> DashboardStats:
        """Return all headline counts from one consistent read."""
        ...

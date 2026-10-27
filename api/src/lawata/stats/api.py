"""Stats HTTP routes: dashboard headline counts."""

from __future__ import annotations

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from lawata.stats import service
from lawata.stats.adapters import NeonStatsRepository
from lawata.stats.domain import StatsRepository

router = APIRouter(prefix="/api", tags=["stats"])


class StatsOut(BaseModel):
    """Dashboard headline counts."""

    model_config = ConfigDict(from_attributes=True)

    total_plumes: Annotated[int, Field(ge=0, description="All detected plume events.")]
    dry_weather_plumes: Annotated[
        int,
        Field(
            ge=0,
            description="Plumes in v_dry_weather_plumes: not reviewed as artifact, "
            "3-day rain < 5 mm and 7-day rain < 15 mm. Suspicious, verify.",
        ),
    ]
    pending_sampling_tasks: Annotated[
        int, Field(ge=0, description="Sampling tasks waiting for human approval.")
    ]
    last_scene_date: Annotated[
        dt.date | None,
        Field(description="Newest usable Sentinel-2 acquisition day; null if none."),
    ]


def get_stats_repository() -> StatsRepository:
    """Provide the stats repository (overridden in tests)."""
    return NeonStatsRepository()


Repository = Annotated[StatsRepository, Depends(get_stats_repository)]


@router.get("/stats", response_model=StatsOut)
def get_stats(repository: Repository) -> StatsOut:
    """Headline counts for the dashboard, read in one query."""
    return StatsOut.model_validate(service.get_stats(repository))

"""Live Neon check (read only). Runs only when DATABASE_URL is set in the environment."""

import os

import pytest

from lawata.sampling.adapters import NeonSamplingTaskRepository
from lawata.sampling.domain import MAX_TASK_LIMIT, SamplingStatus, SamplingTaskFilters
from lawata.sightings.adapters import NeonPlumeRepository
from lawata.sightings.domain import MAX_PLUME_LIMIT, PlumeFilters
from lawata.stats.adapters import NeonStatsRepository

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="DATABASE_URL not set"),
]


def test_integration_stats_agree_with_feature_sources_of_truth() -> None:
    stats = NeonStatsRepository().get_stats()

    plumes = NeonPlumeRepository().list_plumes(PlumeFilters(limit=MAX_PLUME_LIMIT))
    assert stats.total_plumes == len(plumes)
    assert stats.dry_weather_plumes == sum(p.is_dry for p in plumes)

    pending = NeonSamplingTaskRepository().list_tasks(
        SamplingTaskFilters(status=SamplingStatus.PENDING_APPROVAL, limit=MAX_TASK_LIMIT)
    )
    assert stats.pending_sampling_tasks == len(pending)

    assert stats.last_scene_date is not None
    assert all(p.date <= stats.last_scene_date for p in plumes)

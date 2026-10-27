"""In-memory StatsRepository and fixtures shared by stats tests."""

from collections.abc import Iterator
from datetime import date

import pytest
from fastapi.testclient import TestClient

from lawata.api.app import app
from lawata.stats.api import get_stats_repository
from lawata.stats.domain import DashboardStats

DEFAULT_STATS = DashboardStats(
    total_plumes=21,
    dry_weather_plumes=6,
    pending_sampling_tasks=1,
    last_scene_date=date(2026, 6, 1),
)


class FakeStatsRepository:
    """Returns fixed counts."""

    def __init__(self, stats: DashboardStats = DEFAULT_STATS) -> None:
        self._stats = stats

    def get_stats(self) -> DashboardStats:
        return self._stats


@pytest.fixture
def repository() -> FakeStatsRepository:
    return FakeStatsRepository()


@pytest.fixture
def client(repository: FakeStatsRepository) -> Iterator[TestClient]:
    app.dependency_overrides[get_stats_repository] = lambda: repository
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def default_stats() -> DashboardStats:
    return DEFAULT_STATS

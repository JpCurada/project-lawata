from datetime import date

import pytest

from lawata.stats import service
from lawata.stats.domain import DashboardStats, StatsRepository


class _FixedRepository:
    def __init__(self, stats: DashboardStats) -> None:
        self.stats = stats

    def get_stats(self) -> DashboardStats:
        return self.stats


def test_get_stats_returns_repository_counts(
    repository: StatsRepository, default_stats: DashboardStats
) -> None:
    assert service.get_stats(repository) == default_stats


def test_get_stats_allows_empty_database() -> None:
    empty = DashboardStats(0, 0, 0, None)
    assert service.get_stats(_FixedRepository(empty)) == empty


def test_dashboard_stats_rejects_more_dry_plumes_than_total() -> None:
    with pytest.raises(ValueError, match="dry_weather_plumes"):
        DashboardStats(2, 3, 0, date(2026, 6, 1))


def test_dashboard_stats_rejects_negative_counts() -> None:
    with pytest.raises(ValueError, match="pending_sampling_tasks"):
        DashboardStats(2, 1, -1, None)

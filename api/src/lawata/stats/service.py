"""Stats use cases: read the dashboard headline counts."""

from __future__ import annotations

from lawata.stats.domain import DashboardStats, StatsRepository


def get_stats(repository: StatsRepository) -> DashboardStats:
    """Return the dashboard headline counts."""
    return repository.get_stats()

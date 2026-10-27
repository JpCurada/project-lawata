"""Live Neon check. Runs only when DATABASE_URL is set in the environment."""

import os
from collections.abc import Iterator
from datetime import date, timedelta

import psycopg
import pytest

from lawata.sightings.adapters import NeonPlumeRepository
from lawata.sightings.domain import PlumeFilters, PlumeNotFoundError, ReviewInput

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="DATABASE_URL not set"),
]

EXPECTED_DRY_PLUMES = 6


def test_integration_dry_only_matches_view_and_get_plume() -> None:
    repository = NeonPlumeRepository()
    dry = repository.list_plumes(PlumeFilters(dry_only=True))
    assert len(dry) == EXPECTED_DRY_PLUMES
    assert all(p.is_dry for p in dry)

    detail = repository.get_plume(dry[0].id)
    assert detail is not None
    assert detail.id == dry[0].id
    assert detail.is_dry is True
    assert detail.rain_3d_mm is not None


def test_integration_places_and_missing_plume() -> None:
    repository = NeonPlumeRepository()
    assert repository.list_places()
    assert repository.get_plume(-1) is None


@pytest.fixture
def rollback_connection() -> Iterator[psycopg.Connection]:
    """A dedicated non-autocommit connection that is always rolled back, so nothing persists."""
    connection = psycopg.connect(os.environ["DATABASE_URL"], prepare_threshold=None)
    try:
        yield connection
    finally:
        connection.rollback()
        connection.close()


def test_integration_add_review_is_latest_and_rolled_back(
    rollback_connection: psycopg.Connection,
) -> None:
    repository = NeonPlumeRepository(connection=rollback_connection)
    plume = repository.list_plumes(PlumeFilters(dry_only=True, limit=1))[0]
    reviewer = "pytest-rollback"

    first = repository.add_review(plume.id, ReviewInput("uncertain", "Hazy", reviewer))
    # Same transaction, so now() ties on reviewed_at; the higher review_id must win.
    second = repository.add_review(plume.id, ReviewInput("artifact", "Sun glint", reviewer))
    assert second.reviewed_at == first.reviewed_at
    assert second.id > first.id

    detail = repository.get_plume(plume.id)
    assert detail is not None
    assert detail.latest_review is not None
    assert detail.latest_review.verdict == "artifact"
    assert detail.is_dry is False  # artifact verdicts leave v_dry_weather_plumes

    with pytest.raises(PlumeNotFoundError):
        repository.add_review(-1, ReviewInput("confirmed", "x", reviewer))

    rollback_connection.rollback()
    count = rollback_connection.execute(
        "SELECT count(*) FROM event_review WHERE reviewer = %s", (reviewer,)
    ).fetchone()
    assert count == (0,)


def test_integration_nearby_history_counts_earlier_plumes_only() -> None:
    repository = NeonPlumeRepository()
    plume = repository.list_plumes(PlumeFilters(dry_only=True, limit=1))[0]
    before = repository.nearby_history(plume.entry_lat, plume.entry_lon, 1.0, plume.date)
    after = repository.nearby_history(
        plume.entry_lat, plume.entry_lon, 1.0, plume.date + timedelta(days=1)
    )
    assert after.events == before.events + 1  # the plume itself only counts once it is past
    assert after.dry_events == before.dry_events + 1
    assert after.last_seen == plume.date


def test_integration_nearby_history_counts_unusual_watch_zone_passes() -> None:
    # Binangonan river mouth: unusual on 2026-03-27 (25%) and 2026-04-01 (42%) before May 6.
    history = NeonPlumeRepository().nearby_history(14.5044, 121.1546, 1.0, date(2026, 5, 6))
    assert history.zone_unusual_passes >= 2
    assert history.zone_passes >= history.zone_unusual_passes

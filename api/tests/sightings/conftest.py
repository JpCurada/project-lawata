"""In-memory PlumeRepository and fixtures shared by sightings tests."""

from collections.abc import Callable, Iterator
from dataclasses import replace
from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient

from lawata.api.app import app
from lawata.sightings.api import get_plume_repository
from lawata.sightings.domain import (
    AgentDecisionSummary,
    Place,
    PlumeDetail,
    PlumeFilters,
    PlumeNotFoundError,
    PlumeSummary,
    Review,
    ReviewInput,
    ReviewSummary,
)


def make_detail(
    plume_id: int,
    place: str | None = "Lumban",
    acquired_date: date = date(2026, 3, 7),
    is_dry: bool = True,
) -> PlumeDetail:
    """A reviewed plume whose latest agent decision proposed sampling."""
    return PlumeDetail(
        id=plume_id,
        place=place,
        province="Laguna",
        date=acquired_date,
        area_ha=12.5,
        kind="shore_plume",
        rain_3d_mm=0.8 if is_dry else 20.0,
        rain_7d_mm=6.7 if is_dry else 40.0,
        is_dry=is_dry,
        entry_lat=14.29,
        entry_lon=121.46,
        latest_review=ReviewSummary(
            verdict="confirmed", reviewed_at=datetime(2026, 3, 8, tzinfo=UTC)
        ),
        latest_decision=AgentDecisionSummary(
            action="create_sampling_task",
            reason="Suspicious, verify: dry-weather plume.",
            created_at=datetime(2026, 3, 9, tzinfo=UTC),
        ),
        evidence_image_url=None,
    )


DEFAULT_PLUMES = (
    make_detail(1, "Lumban", date(2025, 4, 23), is_dry=True),
    make_detail(2, "Paete", date(2025, 8, 4), is_dry=False),
    make_detail(3, "Binangonan", date(2026, 5, 6), is_dry=True),
    make_detail(4, None, date(2026, 6, 1), is_dry=False),
)

DEFAULT_PLACES = (
    Place(id=5, name="Lumban", province="Laguna", lat=14.29, lon=121.46),
    Place(id=16, name="Binangonan", province="Rizal", lat=14.46, lon=121.19),
)


class FakePlumeRepository:
    """Applies the same filter semantics as the Neon adapter, in memory."""

    def __init__(
        self,
        plumes: tuple[PlumeDetail, ...] = DEFAULT_PLUMES,
        places: tuple[Place, ...] = DEFAULT_PLACES,
    ) -> None:
        self._plumes = plumes
        self._places = places
        self._reviews: list[Review] = []

    def list_plumes(self, filters: PlumeFilters) -> list[PlumeSummary]:
        matches = [
            plume
            for plume in sorted(self._plumes, key=lambda p: (p.date, p.id), reverse=True)
            if (filters.place is None or (plume.place or "").lower() == filters.place.lower())
            and (not filters.dry_only or plume.is_dry)
            and (filters.date_from is None or plume.date >= filters.date_from)
            and (filters.date_to is None or plume.date <= filters.date_to)
        ]
        return [plume.summary() for plume in matches[: filters.limit]]

    def get_plume(self, plume_id: int) -> PlumeDetail | None:
        detail = next((p for p in self._plumes if p.id == plume_id), None)
        history = self.reviews_for(plume_id)
        if detail is None or not history:
            return detail
        # Same rule as v_event_latest_review: reviewed_at DESC, then id DESC.
        latest = max(history, key=lambda r: (r.reviewed_at, r.id))
        summary = ReviewSummary(verdict=latest.verdict, reviewed_at=latest.reviewed_at)
        return replace(detail, latest_review=summary)

    def add_review(self, plume_id: int, review: ReviewInput) -> Review:
        if not any(p.id == plume_id for p in self._plumes):
            raise PlumeNotFoundError(f"plume {plume_id} not found")
        created = Review(
            id=len(self._reviews) + 1,
            plume_id=plume_id,
            verdict=review.verdict,
            reason=review.reason,
            reviewer=review.reviewer,
            reviewed_at=datetime.now(UTC),
        )
        self._reviews.append(created)
        return created

    def list_reviews(self, plume_id: int) -> list[Review]:
        if not any(p.id == plume_id for p in self._plumes):
            raise PlumeNotFoundError(f"plume {plume_id} not found")
        return sorted(self.reviews_for(plume_id), key=lambda r: (r.reviewed_at, r.id), reverse=True)

    def reviews_for(self, plume_id: int) -> list[Review]:
        """Full append-only history for one plume (test helper)."""
        return [r for r in self._reviews if r.plume_id == plume_id]

    def list_places(self) -> list[Place]:
        return list(self._places)


@pytest.fixture
def repository() -> FakePlumeRepository:
    return FakePlumeRepository()


@pytest.fixture
def review_history(repository: FakePlumeRepository) -> Callable[[int], list[str]]:
    """Verdicts stored for a plume, oldest first (the fake keeps full history)."""
    return lambda plume_id: [r.verdict for r in repository.reviews_for(plume_id)]


@pytest.fixture
def client(
    repository: FakePlumeRepository, researcher_headers: dict[str, str]
) -> Iterator[TestClient]:
    """A client signed in as researcher `ana`."""
    # One shared instance so a POST is visible to a later GET in the same test.
    app.dependency_overrides[get_plume_repository] = lambda: repository
    yield TestClient(app, headers=researcher_headers)
    app.dependency_overrides.clear()


@pytest.fixture
def anonymous_client(repository: FakePlumeRepository) -> Iterator[TestClient]:
    """A client with no token."""
    app.dependency_overrides[get_plume_repository] = lambda: repository
    yield TestClient(app)
    app.dependency_overrides.clear()

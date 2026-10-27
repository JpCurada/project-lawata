from collections.abc import Callable
from datetime import date

import pytest

from lawata.sightings import service
from lawata.sightings.domain import (
    DEFAULT_PLUME_LIMIT,
    MAX_PLUME_LIMIT,
    InvalidFiltersError,
    NearbyHistory,
    PlumeFilters,
    PlumeNotFoundError,
    PlumeRepository,
    ReviewInput,
)


def test_list_plumes_returns_all_without_filters(repository: PlumeRepository) -> None:
    plumes = service.list_plumes(repository, PlumeFilters())
    assert [p.id for p in plumes] == [4, 3, 2, 1]


def test_list_plumes_dry_only_keeps_dry(repository: PlumeRepository) -> None:
    plumes = service.list_plumes(repository, PlumeFilters(dry_only=True))
    assert {p.id for p in plumes} == {1, 3}
    assert all(p.is_dry for p in plumes)


def test_list_plumes_place_and_dates_filter(repository: PlumeRepository) -> None:
    filters = PlumeFilters(
        place="binangonan", date_from=date(2026, 1, 1), date_to=date(2026, 12, 31)
    )
    assert [p.id for p in service.list_plumes(repository, filters)] == [3]


def test_list_plumes_respects_limit(repository: PlumeRepository) -> None:
    assert len(service.list_plumes(repository, PlumeFilters(limit=2))) == 2


def test_filters_default_limit() -> None:
    assert PlumeFilters().limit == DEFAULT_PLUME_LIMIT


def test_validate_filters_rejects_reversed_dates() -> None:
    with pytest.raises(InvalidFiltersError):
        service.validate_filters(PlumeFilters(date_from=date(2026, 2, 1), date_to=date(2026, 1, 1)))


@pytest.mark.parametrize("limit", [0, -1, MAX_PLUME_LIMIT + 1])
def test_validate_filters_rejects_out_of_bounds_limit(limit: int) -> None:
    with pytest.raises(InvalidFiltersError):
        service.validate_filters(PlumeFilters(limit=limit))


def test_list_plumes_validates_before_querying(repository: PlumeRepository) -> None:
    with pytest.raises(InvalidFiltersError):
        service.list_plumes(repository, PlumeFilters(limit=0))


def test_get_plume_returns_detail(repository: PlumeRepository) -> None:
    detail = service.get_plume(repository, 3)
    assert detail.place == "Binangonan"
    assert detail.latest_decision is not None


def test_get_plume_missing_raises_not_found(repository: PlumeRepository) -> None:
    with pytest.raises(PlumeNotFoundError):
        service.get_plume(repository, 999)


def test_plumes_geojson_builds_point_features(repository: PlumeRepository) -> None:
    collection = service.plumes_geojson(repository, PlumeFilters(dry_only=True))
    assert collection["type"] == "FeatureCollection"
    features = collection["features"]
    assert len(features) == 2
    first = features[0]
    assert first["type"] == "Feature"
    assert first["geometry"] == {"type": "Point", "coordinates": [121.46, 14.29]}
    assert first["properties"]["id"] == 3
    assert first["properties"]["date"] == "2026-05-06"
    assert first["properties"]["is_dry"] is True


def test_list_places_returns_places(repository: PlumeRepository) -> None:
    assert [p.name for p in service.list_places(repository)] == ["Lumban", "Binangonan"]


def test_add_review_returns_created_review(repository: PlumeRepository) -> None:
    review = service.add_review(
        repository, 3, ReviewInput(verdict="artifact", reason="Cloud shadow", reviewer="ana")
    )
    assert review.id >= 1
    assert review.plume_id == 3
    assert review.verdict == "artifact"
    assert review.reviewed_at is not None


def test_add_review_unknown_plume_raises(repository: PlumeRepository) -> None:
    with pytest.raises(PlumeNotFoundError):
        service.add_review(
            repository, 999, ReviewInput(verdict="confirmed", reason="x", reviewer="ana")
        )


def test_add_review_becomes_latest_and_history_is_appended(
    repository: PlumeRepository,
    review_history: Callable[[int], list[str]],
) -> None:
    service.add_review(repository, 1, ReviewInput("uncertain", "Hazy", "ana"))
    second = service.add_review(repository, 1, ReviewInput("artifact", "Sun glint", "ben"))
    detail = service.get_plume(repository, 1)
    assert detail.latest_review is not None
    assert detail.latest_review.verdict == "artifact"
    assert detail.latest_review.reviewed_at == second.reviewed_at
    assert review_history(1) == ["uncertain", "artifact"]


class RecordingHistory:
    def __init__(self) -> None:
        self.calls: list[tuple[float, float, float, date]] = []

    def nearby_history(
        self, lat: float, lon: float, radius_km: float, before: date
    ) -> NearbyHistory:
        self.calls.append((lat, lon, radius_km, before))
        return NearbyHistory(events=3, dry_events=2, last_seen=date(2026, 4, 1))


def test_nearby_history_defaults_to_one_km() -> None:
    source = RecordingHistory()
    history = service.nearby_history(source, 14.5, 121.1, date(2026, 5, 6))
    assert history.dry_events == 2
    assert source.calls == [(14.5, 121.1, 1.0, date(2026, 5, 6))]


@pytest.mark.parametrize("radius_km", [0, -1, 50])
def test_nearby_history_rejects_unusable_radius(radius_km: float) -> None:
    with pytest.raises(InvalidFiltersError):
        service.nearby_history(RecordingHistory(), 14.5, 121.1, date(2026, 5, 6), radius_km)

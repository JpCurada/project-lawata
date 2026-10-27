"""Sightings use cases: list, inspect and map plume history; record human reviews."""

from __future__ import annotations

import datetime as dt
from dataclasses import replace
from typing import Any

from lawata.sightings.domain import (
    DEFAULT_HISTORY_RADIUS_KM,
    MAX_HISTORY_RADIUS_KM,
    MAX_PLUME_LIMIT,
    EvidenceLinks,
    HistorySource,
    InvalidFiltersError,
    NearbyHistory,
    Place,
    PlumeDetail,
    PlumeFilters,
    PlumeNotFoundError,
    PlumeRepository,
    PlumeSummary,
    PlumeView,
    Review,
    ReviewInput,
    Viewer,
)


def validate_filters(filters: PlumeFilters) -> None:
    """Raise `InvalidFiltersError` if the date range is reversed or the limit is out of bounds."""
    if filters.date_from and filters.date_to and filters.date_from > filters.date_to:
        raise InvalidFiltersError("date_from must be on or before date_to")
    if not 1 <= filters.limit <= MAX_PLUME_LIMIT:
        raise InvalidFiltersError(f"limit must be between 1 and {MAX_PLUME_LIMIT}")


def list_plumes(repository: PlumeRepository, filters: PlumeFilters) -> list[PlumeSummary]:
    """Return plumes matching validated filters, newest first."""
    validate_filters(filters)
    return repository.list_plumes(filters)


def get_plume(repository: PlumeRepository, plume_id: int) -> PlumeDetail:
    """Return one plume or raise `PlumeNotFoundError`."""
    detail = repository.get_plume(plume_id)
    if detail is None:
        raise PlumeNotFoundError(f"plume {plume_id} not found")
    return detail


def view_plume(
    repository: PlumeRepository,
    plume_id: int,
    viewer: Viewer,
    links: EvidenceLinks | None = None,
) -> PlumeView:
    """Return one plume as `viewer` may see it, with its derived status.

    The stored crop URI becomes a viewable link through `links`; without them it is None.

    Raises:
        PlumeNotFoundError: for an unknown plume.
    """
    plume = get_plume(repository, plume_id)
    stored = plume.evidence_image_url
    url = links.url_for(stored) if links is not None and stored is not None else None
    return PlumeView.for_viewer(replace(plume, evidence_image_url=url), viewer)


def list_reviews(repository: PlumeRepository, plume_id: int) -> list[Review]:
    """Return a plume's review history, newest first; raises `PlumeNotFoundError`."""
    return repository.list_reviews(plume_id)


def add_review(repository: PlumeRepository, plume_id: int, review: ReviewInput) -> Review:
    """Append a human review; raises `PlumeNotFoundError` for an unknown plume."""
    return repository.add_review(plume_id, review)


def _feature(plume: PlumeSummary) -> dict[str, Any]:
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [plume.entry_lon, plume.entry_lat]},
        "properties": {
            "id": plume.id,
            "place": plume.place,
            "date": plume.date.isoformat(),
            "area_ha": plume.area_ha,
            "kind": plume.kind,
            "is_dry": plume.is_dry,
            "entry_lat": plume.entry_lat,
            "entry_lon": plume.entry_lon,
        },
    }


def plumes_geojson(repository: PlumeRepository, filters: PlumeFilters) -> dict[str, Any]:
    """Return matching plumes as a GeoJSON FeatureCollection of entry points."""
    plumes = list_plumes(repository, filters)
    return {"type": "FeatureCollection", "features": [_feature(p) for p in plumes]}


def list_places(repository: PlumeRepository) -> list[Place]:
    """Return all places."""
    return repository.list_places()


def nearby_history(
    source: HistorySource,
    lat: float,
    lon: float,
    before: dt.date,
    radius_km: float = DEFAULT_HISTORY_RADIUS_KM,
) -> NearbyHistory:
    """Earlier plumes near a point; raise `InvalidFiltersError` for an unusable radius."""
    if not 0 < radius_km <= MAX_HISTORY_RADIUS_KM:
        raise InvalidFiltersError(f"radius_km must be in (0, {MAX_HISTORY_RADIUS_KM}]")
    return source.nearby_history(lat, lon, radius_km, before)

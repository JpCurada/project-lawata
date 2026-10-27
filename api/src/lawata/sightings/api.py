"""Sightings HTTP routes: plume history, detail, reviews, GeoJSON map layer, places.

Lists, maps and plume detail are public; the detail hides the agent decision unless the caller
is a signed-in researcher. Review history and new reviews are researcher-only, and the
reviewer's name comes from the access token, never from the body.
"""

from __future__ import annotations

import datetime as dt
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, StringConstraints, model_validator

from lawata.shared.auth.api import RESEARCHER_RESPONSES, OptionalResearcher, Researcher
from lawata.shared.storage import evidence_links_from_env
from lawata.sightings import service
from lawata.sightings.adapters import NeonPlumeRepository
from lawata.sightings.domain import (
    DEFAULT_PLUME_LIMIT,
    MAX_PLUME_LIMIT,
    REVIEW_REASON_MAX_LENGTH,
    REVIEW_REASON_MIN_LENGTH,
    EvidenceLinks,
    InvalidFiltersError,
    PlumeFilters,
    PlumeNotFoundError,
    PlumeRepository,
    PlumeStatus,
    PlumeView,
    ReviewInput,
    ReviewVerdict,
    Viewer,
)

router = APIRouter(prefix="/api", tags=["sightings"])


class _FromDomain(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class PlumeSummaryOut(_FromDomain):
    """One plume in a list. `area_ha` in hectares; entry point in WGS84 degrees."""

    id: int
    place: str | None
    date: dt.date
    area_ha: float
    kind: str
    is_dry: bool
    entry_lat: float
    entry_lon: float


class ReviewOut(_FromDomain):
    """Latest human review."""

    verdict: str
    reviewed_at: dt.datetime


class ReviewIn(BaseModel):
    """A researcher's verdict on a plume; `reason` is trimmed, 3-500 chars.

    The reviewer comes from the access token.
    """

    model_config = ConfigDict(extra="forbid")

    verdict: ReviewVerdict
    reason: Annotated[
        str,
        StringConstraints(
            strip_whitespace=True,
            min_length=REVIEW_REASON_MIN_LENGTH,
            max_length=REVIEW_REASON_MAX_LENGTH,
        ),
    ]

    @model_validator(mode="before")
    @classmethod
    def _ignore_client_reviewer(cls, data: object) -> object:
        # Older clients still send `reviewer`; it is dropped, never trusted.
        if isinstance(data, dict) and "reviewer" in data:
            return {key: value for key, value in data.items() if key != "reviewer"}
        return data


class ReviewCreatedOut(_FromDomain):
    """A stored review, as appended to the plume's history."""

    id: int
    plume_id: int
    verdict: ReviewVerdict
    reason: str
    reviewer: str
    reviewed_at: dt.datetime


class PlumeReviewOut(_FromDomain):
    """One entry of a plume's review history (older rows may have no reason)."""

    id: int
    verdict: ReviewVerdict
    reason: str | None
    reviewer: str
    reviewed_at: dt.datetime


class AgentDecisionOut(_FromDomain):
    """Latest agent decision."""

    action: str
    reason: str
    created_at: dt.datetime


class PlumeDetailOut(_FromDomain):
    """Full plume context. Rainfall in mm over 3 and 7 days, acquisition day included.

    `latest_decision` is always null for `viewer: "public"`. `status` is derived server-side
    from reviews, sampling tasks and the agent decision (see `sightings.domain.plume_status`).
    """

    viewer: Viewer
    status: PlumeStatus

    id: int
    place: str | None
    province: str | None
    date: dt.date
    area_ha: float
    kind: str
    rain_3d_mm: float | None
    rain_7d_mm: float | None
    is_dry: bool
    entry_lat: float
    entry_lon: float
    latest_review: ReviewOut | None
    latest_decision: AgentDecisionOut | None
    evidence_image_url: str | None


class PointGeometry(BaseModel):
    """GeoJSON Point, coordinates `[lon, lat]`."""

    type: Literal["Point"]
    coordinates: tuple[float, float]


class PlumeFeature(BaseModel):
    """GeoJSON Feature at a plume's shore entry point."""

    type: Literal["Feature"]
    geometry: PointGeometry
    properties: PlumeSummaryOut


class PlumeFeatureCollection(BaseModel):
    """GeoJSON FeatureCollection of plumes."""

    type: Literal["FeatureCollection"]
    features: list[PlumeFeature]


class PlaceOut(_FromDomain):
    """A shoreline place (WGS84 degrees)."""

    id: int
    name: str
    province: str | None
    lat: float
    lon: float


def get_plume_repository() -> PlumeRepository:
    """Provide the plume repository (overridden in tests)."""
    return NeonPlumeRepository()


def get_evidence_links() -> EvidenceLinks | None:
    """Presigned links to crops in `LAWATA_BUCKET`; None (no images) when it is not set."""
    return evidence_links_from_env()


def plume_filters(
    place: str | None = None,
    dry_only: bool = False,
    date_from: Annotated[dt.date | None, Query(alias="from")] = None,
    date_to: Annotated[dt.date | None, Query(alias="to")] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PLUME_LIMIT)] = DEFAULT_PLUME_LIMIT,
) -> PlumeFilters:
    """Parse and validate plume query parameters (422 on invalid input)."""
    filters = PlumeFilters(
        place=place, dry_only=dry_only, date_from=date_from, date_to=date_to, limit=limit
    )
    try:
        service.validate_filters(filters)
    except InvalidFiltersError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return filters


Repository = Annotated[PlumeRepository, Depends(get_plume_repository)]
Filters = Annotated[PlumeFilters, Depends(plume_filters)]
Links = Annotated[EvidenceLinks | None, Depends(get_evidence_links)]


@router.get("/plumes", response_model=list[PlumeSummaryOut])
def list_plumes(repository: Repository, filters: Filters) -> list[PlumeSummaryOut]:
    """List plumes, newest first."""
    plumes = service.list_plumes(repository, filters)
    return [PlumeSummaryOut.model_validate(p) for p in plumes]


# Declared before /plumes/{plume_id} so the literal path is matched first.
@router.get("/plumes.geojson", response_model=PlumeFeatureCollection)
def plumes_geojson(repository: Repository, filters: Filters) -> PlumeFeatureCollection:
    """Plumes as a GeoJSON FeatureCollection of shore entry points."""
    return PlumeFeatureCollection.model_validate(service.plumes_geojson(repository, filters))


def _detail_out(view: PlumeView) -> PlumeDetailOut:
    fields = PlumeDetailOut.model_fields.keys() - {"viewer", "status"}
    values = {name: getattr(view.plume, name) for name in fields}
    return PlumeDetailOut.model_validate({**values, "viewer": view.viewer, "status": view.status})


_PLUME_NOT_FOUND = "Plume not found"
_REVIEW_ROUTE_RESPONSES: dict[int | str, dict[str, str]] = {
    **RESEARCHER_RESPONSES,
    404: {"description": _PLUME_NOT_FOUND},
}


@router.get(
    "/plumes/{plume_id}",
    response_model=PlumeDetailOut,
    responses={404: {"description": _PLUME_NOT_FOUND}},
)
def get_plume(
    plume_id: int, repository: Repository, links: Links, researcher: OptionalResearcher
) -> PlumeDetailOut:
    """One plume with rainfall, latest review, status and (researchers only) agent decision.

    `evidence_image_url` is a short-lived link to the 10 m crop, or null if none exists yet.
    Public endpoint: a missing or invalid token is served the public view, never a 401.
    """
    viewer: Viewer = "public" if researcher is None else "researcher"
    try:
        view = service.view_plume(repository, plume_id, viewer, links)
    except PlumeNotFoundError as error:
        raise HTTPException(status_code=404, detail=_PLUME_NOT_FOUND) from error
    return _detail_out(view)


@router.get(
    "/plumes/{plume_id}/reviews",
    response_model=list[PlumeReviewOut],
    responses=_REVIEW_ROUTE_RESPONSES,
)
def list_reviews(plume_id: int, repository: Repository, _: Researcher) -> list[PlumeReviewOut]:
    """A plume's human review history, newest first (researchers only)."""
    try:
        reviews = service.list_reviews(repository, plume_id)
    except PlumeNotFoundError as error:
        raise HTTPException(status_code=404, detail=_PLUME_NOT_FOUND) from error
    return [PlumeReviewOut.model_validate(review) for review in reviews]


@router.post(
    "/plumes/{plume_id}/reviews",
    response_model=ReviewCreatedOut,
    status_code=201,
    responses=_REVIEW_ROUTE_RESPONSES,
)
def add_review(
    plume_id: int, body: ReviewIn, repository: Repository, user: Researcher
) -> ReviewCreatedOut:
    """Append a researcher's review; the newest review becomes the plume's latest verdict."""
    review = ReviewInput(verdict=body.verdict, reason=body.reason, reviewer=user.username)
    try:
        created = service.add_review(repository, plume_id, review)
    except PlumeNotFoundError as error:
        raise HTTPException(status_code=404, detail=_PLUME_NOT_FOUND) from error
    return ReviewCreatedOut.model_validate(created)


@router.get("/places", response_model=list[PlaceOut])
def list_places(repository: Repository) -> list[PlaceOut]:
    """List shoreline places."""
    return [PlaceOut.model_validate(p) for p in service.list_places(repository)]

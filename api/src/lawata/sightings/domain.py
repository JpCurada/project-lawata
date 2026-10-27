"""Sightings domain: plume history, latest reviews and decisions, places.

"Dry weather" has one source of truth: the database view `v_dry_weather_plumes`
(verdict is not 'artifact', 3-day rain < 5 mm and 7-day rain < 15 mm). Adapters derive
`is_dry` from membership in that view rather than repeating its thresholds.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, replace
from typing import Literal, Protocol

DEFAULT_PLUME_LIMIT = 100
MAX_PLUME_LIMIT = 500
REVIEW_REASON_MIN_LENGTH = 3
REVIEW_REASON_MAX_LENGTH = 500
DEFAULT_HISTORY_RADIUS_KM = 1.0
MAX_HISTORY_RADIUS_KM = 10.0
# A watch-zone pass counts as unusual from this share of the zone (dry passes average ~12%,
# wet ones ~4%; Binangonan peaked at 46%). See notebooks/02_lake_story.ipynb.
ZONE_UNUSUAL_PCT = 10.0

# Mirrors the CHECK constraint on event_review.verdict.
ReviewVerdict = Literal["confirmed", "artifact", "uncertain"]

# Mirrors the `sampling_status` database enum. Sightings reads task status straight from the
# database (it must not import the sampling feature), so the values are restated here.
SamplingTaskStatus = Literal["pending_approval", "approved", "rejected", "done"]

# The agent action that proposes field sampling (mirrors the `agent_action` database enum).
CREATE_SAMPLING_TASK_ACTION = "create_sampling_task"

Viewer = Literal["public", "researcher"]
PlumeStatus = Literal["new", "triaged", "sampling_pending", "sampling_approved", "reviewed"]


class PlumeNotFoundError(LookupError):
    """Raised when a plume id does not exist."""


class InvalidFiltersError(ValueError):
    """Raised when plume filters are inconsistent or out of bounds."""


@dataclass(frozen=True)
class ReviewSummary:
    """Latest human review of a plume."""

    verdict: str
    reviewed_at: dt.datetime


@dataclass(frozen=True)
class ReviewInput:
    """A human verdict to append to a plume's review history.

    `reviewer` is the signed-in user's name from the access token, never client input.
    """

    verdict: ReviewVerdict
    reason: str
    reviewer: str


@dataclass(frozen=True)
class Review:
    """A stored human review. The newest (reviewed_at, then id) is the plume's latest."""

    id: int
    plume_id: int
    verdict: ReviewVerdict
    reason: str | None
    reviewer: str
    reviewed_at: dt.datetime


@dataclass(frozen=True)
class AgentDecisionSummary:
    """Latest agent decision for a plume."""

    action: str
    reason: str
    created_at: dt.datetime


@dataclass(frozen=True)
class PlumeSummary:
    """One plume event in a list. `area_ha` in hectares; entry point in WGS84 degrees."""

    id: int
    place: str | None
    date: dt.date
    area_ha: float
    kind: str
    is_dry: bool
    entry_lat: float
    entry_lon: float


@dataclass(frozen=True)
class PlumeDetail:
    """Full context for a single plume event. Rainfall in mm (window includes the day)."""

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
    latest_review: ReviewSummary | None
    latest_decision: AgentDecisionSummary | None
    # The repository fills in the stored crop URI (s3://...); `view_plume` swaps it for a
    # link a browser can open, or None.
    evidence_image_url: str | None
    # Status of the plume's newest sampling task, if any.
    latest_sampling_status: SamplingTaskStatus | None = None

    def summary(self) -> PlumeSummary:
        """Project this detail onto the list view."""
        return PlumeSummary(
            id=self.id,
            place=self.place,
            date=self.date,
            area_ha=self.area_ha,
            kind=self.kind,
            is_dry=self.is_dry,
            entry_lat=self.entry_lat,
            entry_lon=self.entry_lon,
        )


def plume_status(plume: PlumeDetail) -> PlumeStatus:
    """Derive where a plume is in triage. The first matching rule wins.

    1. Any human review exists -> "reviewed".
    2. Newest sampling task is approved or done -> "sampling_approved".
    3. Newest sampling task is pending_approval -> "sampling_pending".
    4. Newest sampling task is rejected -> "triaged" (the agent decided; sampling was declined).
    5. No task, latest agent decision is create_sampling_task -> "sampling_pending"
       (sampling still waits for a human; nothing is approved without one).
    6. Any other agent decision -> "triaged".
    7. Otherwise -> "new".
    """
    if plume.latest_review is not None:
        return "reviewed"
    task_status = plume.latest_sampling_status
    if task_status in ("approved", "done"):
        return "sampling_approved"
    if task_status == "pending_approval":
        return "sampling_pending"
    if task_status == "rejected":
        return "triaged"
    if plume.latest_decision is None:
        return "new"
    if plume.latest_decision.action == CREATE_SAMPLING_TASK_ACTION:
        return "sampling_pending"
    return "triaged"


@dataclass(frozen=True)
class PlumeView:
    """A plume as one viewer may see it. Public viewers never see the agent decision."""

    plume: PlumeDetail
    viewer: Viewer
    status: PlumeStatus

    @classmethod
    def for_viewer(cls, plume: PlumeDetail, viewer: Viewer) -> PlumeView:
        """Derive the status from the full record, then hide what `viewer` may not see."""
        status = plume_status(plume)
        if viewer == "public":
            plume = replace(plume, latest_decision=None)
        return cls(plume=plume, viewer=viewer, status=status)


@dataclass(frozen=True)
class PlumeFilters:
    """Query filters for plume lists. Dates are local acquisition days, inclusive."""

    place: str | None = None
    dry_only: bool = False
    date_from: dt.date | None = None
    date_to: dt.date | None = None
    limit: int = DEFAULT_PLUME_LIMIT


@dataclass(frozen=True)
class Place:
    """A named shoreline place with its point location (WGS84 degrees)."""

    id: int
    name: str
    province: str | None
    lat: float
    lon: float


@dataclass(frozen=True)
class NearbyHistory:
    """Earlier sightings near a point, for the agent.

    Plume events reviewed as artifacts do not count. Watch zones add the clear passes
    over a known hotspot and how many of them showed unusual water.
    """

    events: int
    dry_events: int
    last_seen: dt.date | None
    zone_passes: int = 0
    zone_unusual_passes: int = 0


class EvidenceLinks(Protocol):
    """Port that turns a stored crop URI into a link a browser can open."""

    def url_for(self, uri: str) -> str | None:
        """A viewable URL for `uri`, or None if it cannot be served."""
        ...


class HistorySource(Protocol):
    """Port for counting earlier plumes near a point."""

    def nearby_history(
        self, lat: float, lon: float, radius_km: float, before: dt.date
    ) -> NearbyHistory:
        """Plumes whose entry point is within `radius_km`, acquired before `before`."""
        ...


class PlumeRepository(Protocol):
    """Port for plume history and its append-only human reviews."""

    def list_plumes(self, filters: PlumeFilters) -> list[PlumeSummary]:
        """Return plumes matching `filters`, newest first."""
        ...

    def get_plume(self, plume_id: int) -> PlumeDetail | None:
        """Return one plume, or None if it does not exist."""
        ...

    def list_places(self) -> list[Place]:
        """Return all places ordered by name."""
        ...

    def add_review(self, plume_id: int, review: ReviewInput) -> Review:
        """Append a review (never update past ones); raise `PlumeNotFoundError` if missing."""
        ...

    def list_reviews(self, plume_id: int) -> list[Review]:
        """Return a plume's reviews, newest first; raise `PlumeNotFoundError` if missing."""
        ...

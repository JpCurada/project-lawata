"""Analysis domain: a researcher-drawn box over the lake and the agent runtime port."""

import math
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Literal, Protocol

from lawata.agent.domain import Candidate
from lawata.detection.domain import CropStore
from lawata.imagery.domain import PassCloud, SceneReader

# Laguna de Bay as (west, south, east, north), same as the web map bounds.
LAKE_BOUNDS = (121.0, 14.15, 121.5, 14.55)
MAX_SIDE_KM = 5.0
KM_PER_DEGREE = 111.32
LOOKBACK_DAYS = 30
MAX_SCENE_CLOUD_PCT = 60.0  # whole-tile pre-filter only; Laguna clouds are patchy
# A pass is clear when less than this share of the inspect window around the box is cloud.
MAX_LOCAL_CLOUD_FRAC = 0.2
# The plain box image: at least this much ground around the center, never finer than 10 m.
MIN_BOX_IMAGE_HALF_KM = 0.5
BOX_IMAGE_MIN_RES_M = 10.0

AnalysisStatus = Literal["investigated", "no_clear_pass"]
# "inspection": the agent's 10 m crop with outlines; "box": a plain true-color image of the box.
CropKind = Literal["inspection", "box"]


class InvalidAreaError(ValueError):
    """The box is outside the lake, inverted, or too large."""


@dataclass(frozen=True)
class AreaBox:
    """A WGS84 rectangle drawn on the map."""

    west: float
    south: float
    east: float
    north: float

    @property
    def center(self) -> tuple[float, float]:
        """(lat, lon) of the box center."""
        return (self.south + self.north) / 2, (self.west + self.east) / 2

    @property
    def width_km(self) -> float:
        """East-west side, measured at the box center latitude."""
        lat, _ = self.center
        return (self.east - self.west) * KM_PER_DEGREE * math.cos(math.radians(lat))

    @property
    def height_km(self) -> float:
        """North-south side."""
        return (self.north - self.south) * KM_PER_DEGREE

    @property
    def area_ha(self) -> float:
        """Box area in hectares."""
        return self.width_km * self.height_km * 100

    def validate(self) -> None:
        """Raise `InvalidAreaError` with a plain message when the box cannot be analyzed."""
        if self.west >= self.east or self.south >= self.north:
            raise InvalidAreaError("Draw a box with some width and height.")
        lake_west, lake_south, lake_east, lake_north = LAKE_BOUNDS
        inside = (
            lake_west <= self.west
            and self.east <= lake_east
            and lake_south <= self.south
            and self.north <= lake_north
        )
        if not inside:
            raise InvalidAreaError("Keep the box inside Laguna de Bay.")
        if max(self.width_km, self.height_km) > MAX_SIDE_KM:
            raise InvalidAreaError(f"Keep each side of the box under {MAX_SIDE_KM:g} km.")


@dataclass(frozen=True)
class AreaAnalysis:
    """What the agent decided about one box, or why it did not run."""

    status: AnalysisStatus
    candidate_id: str
    lat: float
    lon: float
    acquired_date: date | None = None
    action: str | None = None
    decision_status: str | None = None
    reason: str | None = None
    trace: list[dict[str, Any]] = field(default_factory=list)
    crop_url: str | None = None
    crop_kind: CropKind | None = None
    model: str | None = None


@dataclass(frozen=True)
class BoxImagery:
    """Ports for the plain true-color image of the box, used when the agent's crop is missing."""

    scenes: SceneReader
    store: CropStore


class SceneCatalog(Protocol):
    """Port for finding Sentinel-2 passes over a point."""

    def pass_clouds(
        self, lat: float, lon: float, until: date, days_back: int, max_tile_cloud_pct: float
    ) -> Iterable[PassCloud]:
        """Passes up to `until`, newest first, with cloud share around the point.

        Tile cloud cover below `max_tile_cloud_pct` is a pre-filter; implementations should
        measure local cloud lazily, so stopping early saves reads.
        """
        ...


def is_clear(found: PassCloud) -> bool:
    """True when the pass shows the box: enough data and little local cloud."""
    return found.local_cloud_frac is not None and found.local_cloud_frac < MAX_LOCAL_CLOUD_FRAC


class CropLinks(Protocol):
    """Port that turns a stored crop URI into a link a browser can open."""

    def url_for(self, uri: str) -> str | None:
        """A viewable URL for `uri`, or None if it cannot be served."""
        ...


class AgentRuntime(Protocol):
    """Port for running the agent loop on one candidate (AgentCore Runtime in production)."""

    def investigate(self, candidate: Candidate) -> dict[str, Any]:
        """Return the runtime's decision: action, status, reason, trace and model id."""
        ...

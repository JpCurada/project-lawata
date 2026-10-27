"""Imagery domain: band windows around a point and the scene reader port."""

from dataclasses import dataclass
from datetime import date
from typing import Protocol

import numpy as np

STAC_URL = "https://earth-search.aws.element84.com/v1"
COLLECTION = "sentinel-2-l2a"

# Sentinel-2 L2A scene classification: cloud shadow, cloud medium/high probability, cirrus.
CLOUD_SCL = (3, 8, 9, 10)
SCL_WATER = 6
INSPECT_BANDS = ("blue", "green", "red", "nir", "swir16", "scl")
SCL_NODATA = 0

# Local cloud is measured on the scene classification (SCL) over this window around the point,
# the same 3 km half-width the agent inspects at 10 m, read coarsely to stay cheap.
LOCAL_CLOUD_HALF_KM = 3.0
LOCAL_CLOUD_RES_M = 60.0
# Below this share of pixels with data (tile edge, swath gap) the window gives no answer.
MIN_VALID_FRAC = 0.5


@dataclass(frozen=True)
class PassCloud:
    """One scene over a point and its cloud share there (None when too little data)."""

    acquired: date
    scene_id: str
    local_cloud_frac: float | None


class SceneNotFoundError(LookupError):
    """Raised when no Sentinel-2 scene covers the point on the requested date."""


@dataclass(frozen=True)
class BandWindow:
    """A small square of one scene around a point, all bands on one grid.

    Reflectance bands are float32 (NaN where there is no data); `scl` is uint8.
    `point_px` is the (column, row) of the requested point.
    """

    scene_id: str
    res_m: float
    bands: dict[str, np.ndarray]
    point_px: tuple[int, int]

    @property
    def shape(self) -> tuple[int, int]:
        """Rows and columns of the window."""
        rows, cols = self.bands["green"].shape
        return rows, cols


class SceneReader(Protocol):
    """Port for reading a band window around a point from the best scene of one day."""

    def read_window(
        self, lat: float, lon: float, on: date, half_km: float, res_m: float
    ) -> BandWindow:
        """Read `INSPECT_BANDS`; raise `SceneNotFoundError` when no scene covers the point."""
        ...

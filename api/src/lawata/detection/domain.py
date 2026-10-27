"""Detection domain: inspection thresholds, the inspection result and the crop store port."""

from dataclasses import dataclass
from typing import Any, Protocol

from lawata.imagery.domain import LOCAL_CLOUD_HALF_KM

# Tuned on Laguna de Bay (see skill detection-pipeline).
COLOR_DISTANCE_THR = 4.0
CLOUD_BUFFER_M = 300
SHORE_ERODE_PX = 3
SHORE_TOUCH_M = 100
REFERENCE_SHORE_DIST_M = 500  # fallback reference inside the 10 m window
OPEN_LAKE_SHORE_DIST_M = 2000  # normal lake colour comes from water this far from shore
MIN_REFERENCE_PX = 200
SEARCH_RADIUS_M = 2500  # scan entry points can sit up a river mouth, inland
CLOUD_EDGE_FRAC = 0.3  # blobs with this share near cloud are not kept by the scan either
GLINT_PERCENTILE = 95
HAZE_Z = 4.0
BROWN_DELTA_LN_RG = 0.05
DARK_DELTA_LN_G = -0.1
INSPECT_HALF_KM = LOCAL_CLOUD_HALF_KM  # passes are chosen by cloud over this same window
INSPECT_RES_M = 10.0
CONTEXT_HALF_KM = 10.0  # coarse window around the point, for the open-lake colour
CONTEXT_RES_M = 60.0
CROP_MAX_PX = 512


@dataclass(frozen=True)
class Inspection:
    """What the 10 m re-read shows at the candidate point."""

    scene_id: str
    plume_found: bool
    clear_water_frac: float
    area_ha: float = 0.0
    kind: str = "none"
    near_cloud_frac: float = 0.0
    glint_frac: float = 0.0
    haze: bool = False
    texture: float = 0.0
    compactness: float = 0.0
    shore_attached: bool = False

    @property
    def cloud_edge(self) -> bool:
        """True when much of the blob sits in the cloud buffer."""
        return self.near_cloud_frac >= CLOUD_EDGE_FRAC

    def as_tool_result(self) -> dict[str, Any]:
        """Compact JSON for the agent (short keys, rounded, no arrays)."""
        result: dict[str, Any] = {
            "plume_found": self.plume_found,
            "clear_water_frac": round(self.clear_water_frac, 2),
        }
        if self.plume_found:
            result |= {
                "area_ha": round(self.area_ha),
                "kind": self.kind,
                "cloud_edge": self.cloud_edge,
                "near_cloud_frac": round(self.near_cloud_frac, 2),
                "glint_frac": round(self.glint_frac, 2),
                "haze": self.haze,
                "texture": round(self.texture, 2),
                "compactness": round(self.compactness, 2),
                "shore_attached": self.shore_attached,
            }
        return result


class CropStore(Protocol):
    """Port for saving evidence crops."""

    def put(self, key: str, jpeg: bytes) -> str:
        """Save a JPEG and return where it is (an S3 URI or a local marker)."""
        ...

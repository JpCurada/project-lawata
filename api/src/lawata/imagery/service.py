"""Imagery use cases: reflectance scaling, local cloud share and true-color rendering."""

import numpy as np

from lawata.imagery.domain import CLOUD_SCL, MIN_VALID_FRAC, SCL_NODATA, BandWindow

BOA_SCALE = 1e-4
BOA_OFFSET = -0.1
OFFSET_FROM_BASELINE = 4.0
TRUE_COLOR_GAIN = 3.5


def to_reflectance(dn: np.ndarray, offset_applied: bool, processing_baseline: float) -> np.ndarray:
    """Scale L2A digital numbers to reflectance; 0 (no data) becomes NaN.

    The -0.1 offset applies only from processing baseline 4 on, and only when Earth Search
    has not already applied it. Applying it twice makes every value negative.
    """
    reflectance = dn.astype(np.float32) * BOA_SCALE
    if not offset_applied and processing_baseline >= OFFSET_FROM_BASELINE:
        reflectance += BOA_OFFSET
    reflectance[dn == 0] = np.nan
    return reflectance


def true_color_bgr(window: BandWindow) -> np.ndarray:
    """8-bit BGR true-color image of the window (OpenCV channel order)."""
    stack = np.dstack([window.bands[b] for b in ("blue", "green", "red")])
    scaled = np.clip(np.nan_to_num(stack) * TRUE_COLOR_GAIN, 0, 1) ** (1 / 1.4)
    return (scaled * 255).astype(np.uint8)


def local_cloud_frac(scl: np.ndarray, min_valid_frac: float = MIN_VALID_FRAC) -> float | None:
    """Share of pixels with data whose SCL class is cloud, shadow or cirrus.

    Nodata pixels are left out of the denominator; None when fewer than `min_valid_frac`
    of the window has data.
    """
    valid = scl != SCL_NODATA
    valid_count = int(valid.sum())
    if scl.size == 0 or valid_count < min_valid_frac * scl.size:
        return None
    return float(np.isin(scl[valid], CLOUD_SCL).sum()) / valid_count

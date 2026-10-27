"""Detection use cases: inspect a candidate at 10 m with OpenCV 5 and render its crop."""

from dataclasses import dataclass
from datetime import date

import cv2
import numpy as np

from lawata.detection.domain import (
    BROWN_DELTA_LN_RG,
    CLOUD_BUFFER_M,
    COLOR_DISTANCE_THR,
    CONTEXT_HALF_KM,
    CONTEXT_RES_M,
    CROP_MAX_PX,
    DARK_DELTA_LN_G,
    GLINT_PERCENTILE,
    HAZE_Z,
    INSPECT_HALF_KM,
    INSPECT_RES_M,
    MIN_REFERENCE_PX,
    OPEN_LAKE_SHORE_DIST_M,
    REFERENCE_SHORE_DIST_M,
    SEARCH_RADIUS_M,
    SHORE_ERODE_PX,
    SHORE_TOUCH_M,
    CropStore,
    Inspection,
)
from lawata.imagery.domain import CLOUD_SCL, SCL_WATER, BandWindow, SceneReader
from lawata.imagery.service import true_color_bgr

EPS = 1e-6


@dataclass(frozen=True)
class InspectedCrop:
    """An inspection with its rendered evidence crop."""

    inspection: Inspection
    jpeg: bytes
    crop_uri: str


def _kernel(radius_px: int) -> np.ndarray:
    size = 2 * max(radius_px, 1) + 1
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size))


def _largest_component(mask: np.ndarray) -> np.ndarray:
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if count <= 1:
        return np.zeros_like(mask)
    biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return (labels == biggest).astype(np.uint8)


def _smooth_nan(values: np.ndarray, sigma: float = 2.0) -> np.ndarray:
    known = np.isfinite(values).astype(np.float32)
    filled = np.nan_to_num(values).astype(np.float32)
    weight = cv2.GaussianBlur(known, (0, 0), sigma)
    out = cv2.GaussianBlur(filled, (0, 0), sigma) / np.maximum(weight, 1e-3)
    out[known == 0] = np.nan
    return out


def _local_std(values: np.ndarray, size: int = 5) -> np.ndarray:
    filled = np.nan_to_num(values).astype(np.float32)
    mean = cv2.blur(filled, (size, size))
    return np.sqrt(np.maximum(cv2.blur(filled * filled, (size, size)) - mean * mean, 0))


def _robust(values: np.ndarray) -> tuple[float, float]:
    median = float(np.nanmedian(values))
    return median, float(np.nanmedian(np.abs(values - median))) * 1.4826 + EPS


def _masks(window: BandWindow) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Cloud buffer, clean lake water and shore-eroded water, as uint8 0/1 masks."""
    b = window.bands
    px_per_m = 1 / window.res_m
    cloud = np.isin(b["scl"], CLOUD_SCL).astype(np.uint8)
    cloud_buffer = cv2.dilate(cloud, _kernel(round(CLOUD_BUFFER_M * px_per_m)))

    mndwi = (b["green"] - b["swir16"]) / (b["green"] + b["swir16"] + EPS)
    valid = np.isfinite(mndwi)
    # MNDWI, not NDWI: Laguna is so green that NIR is high and NDWI misses the lake.
    water = ((np.nan_to_num(mndwi) > 0) | (b["scl"] == SCL_WATER)) & valid & (cloud == 0)
    water = water.astype(np.uint8)
    water = cv2.morphologyEx(water, cv2.MORPH_OPEN, _kernel(2))
    water = cv2.morphologyEx(water, cv2.MORPH_CLOSE, _kernel(2))
    lake = _largest_component(water)  # drops fishponds
    inner = cv2.erode(lake, _kernel(SHORE_ERODE_PX))
    return cloud_buffer, lake, inner


def _color_features(window: BandWindow) -> np.ndarray:
    b = window.bands
    r, g, bl = (np.clip(b[k], 1e-4, None) for k in ("red", "green", "blue"))
    return np.dstack([np.log(r / g), np.log(bl / g), np.log(g)]).astype(np.float32)


@dataclass(frozen=True)
class LakeColor:
    """Normal lake colour: centre and inverse covariance of [ln(r/g), ln(b/g), ln(g)]."""

    center: np.ndarray
    inv_cov: np.ndarray
    blue_median: float
    blue_spread: float


def _lake_color(window: BandWindow, reference: np.ndarray) -> LakeColor | None:
    in_ref = reference.astype(bool)
    ref = _color_features(window)[in_ref]
    ref = ref[np.all(np.isfinite(ref), axis=1)]
    if len(ref) < MIN_REFERENCE_PX:
        return None
    inv_cov = np.linalg.inv(np.cov(ref, rowvar=False) + np.eye(3) * EPS)
    blue_median, blue_spread = _robust(window.bands["blue"][in_ref])
    return LakeColor(np.median(ref, axis=0), inv_cov, blue_median, blue_spread)


def open_lake_color(context: BandWindow) -> LakeColor | None:
    """Lake colour from clear water far from any shore in a wide, coarse window.

    A large plume can fill the whole 10 m window, so the reference must come from
    open lake (see skill detection-pipeline, step 7), not from the water next to it.
    """
    cloud_buffer, lake, inner = _masks(context)
    shore_dist = cv2.distanceTransform(lake, cv2.DIST_L2, 5) * context.res_m
    far = (shore_dist > OPEN_LAKE_SHORE_DIST_M).astype(np.uint8)
    return _lake_color(context, inner & (1 - cloud_buffer) & far)


def _color_distance(features: np.ndarray, color: LakeColor) -> np.ndarray:
    """Mahalanobis distance of every pixel from the normal lake colour."""
    delta = features - color.center
    squared = np.einsum("...i,ij,...j->...", delta, color.inv_cov, delta)
    return _smooth_nan(np.sqrt(np.maximum(squared, 0)).astype(np.float32))


def _blob_at_point(mask: np.ndarray, point: tuple[int, int], radius_px: int) -> np.ndarray:
    """The connected blob at the point, or the nearest one within `radius_px`."""
    count, labels = cv2.connectedComponents(mask, connectivity=8)
    if count <= 1:
        return np.zeros_like(mask)
    col, row = point
    label = int(labels[row, col])
    if label == 0:
        rows, cols = np.nonzero(labels)
        nearest = int(np.argmin((rows - row) ** 2 + (cols - col) ** 2))
        if np.hypot(rows[nearest] - row, cols[nearest] - col) > radius_px:
            return np.zeros_like(mask)
        label = int(labels[rows[nearest], cols[nearest]])
    return (labels == label).astype(np.uint8)


def _kind(features: np.ndarray, in_blob: np.ndarray, color: LakeColor) -> str:
    brown = float(np.nanmedian(features[..., 0][in_blob])) - color.center[0] > BROWN_DELTA_LN_RG
    dark = float(np.nanmedian(features[..., 2][in_blob])) - color.center[2] < DARK_DELTA_LN_G
    return "brown+dark" if brown and dark else "brown" if brown else "dark" if dark else "other"


def _compactness(blob: np.ndarray) -> float:
    contours = cv2.findContours(blob, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0]
    outline = max(contours, key=cv2.contourArea)
    perimeter = cv2.arcLength(outline, True)
    return float(4 * np.pi * cv2.contourArea(outline) / max(perimeter * perimeter, EPS))


def inspect_window(
    window: BandWindow, lake_color: LakeColor | None = None
) -> tuple[Inspection, np.ndarray]:
    """Re-run the plume tests on a 10 m window; return the result and a BGR overlay.

    Without `lake_color`, clear water away from the shore inside the window is the reference.
    """
    px_per_m = 1 / window.res_m
    cloud_buffer, lake, inner = _masks(window)
    overlay = true_color_bgr(window)
    cloud_edges = cv2.findContours(cloud_buffer, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]
    cv2.drawContours(overlay, cloud_edges, -1, (0, 220, 255), 2)
    cv2.drawMarker(overlay, window.point_px, (255, 255, 255), cv2.MARKER_CROSS, 24, 2)

    clear = inner & (1 - cloud_buffer)
    clear_water_frac = float(clear.sum()) / max(int(lake.sum()), 1)
    if lake_color is None:
        shore_dist = cv2.distanceTransform(lake, cv2.DIST_L2, 5) * window.res_m
        local = clear & (shore_dist > REFERENCE_SHORE_DIST_M).astype(np.uint8)
        lake_color = _lake_color(window, local) or _lake_color(window, clear)
    if lake_color is None or clear.sum() < MIN_REFERENCE_PX:
        return Inspection(window.scene_id, False, clear_water_frac), overlay

    features = _color_features(window)
    distance = _color_distance(features, lake_color)
    candidate = ((np.nan_to_num(distance) > COLOR_DISTANCE_THR) & (inner == 1)).astype(np.uint8)
    candidate = cv2.morphologyEx(candidate, cv2.MORPH_OPEN, _kernel(3))
    candidate = cv2.morphologyEx(candidate, cv2.MORPH_CLOSE, _kernel(3))
    blob = _blob_at_point(candidate, window.point_px, round(SEARCH_RADIUS_M * px_per_m))
    if blob.sum() == 0:
        return Inspection(window.scene_id, False, clear_water_frac), overlay

    in_blob, in_clear = blob.astype(bool), clear.astype(bool)
    # Texture depends on resolution, so it is compared with clear water in this window.
    texture = _local_std(features[..., 2])
    glint_thr = float(np.percentile(texture[in_clear], GLINT_PERCENTILE))
    blue = float(np.nanmedian(window.bands["blue"][in_blob]))
    touch = cv2.dilate(blob, _kernel(round(SHORE_TOUCH_M * px_per_m))).astype(bool)
    land = (lake == 0) & np.isfinite(window.bands["green"])
    outline = cv2.findContours(blob, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]
    cv2.drawContours(overlay, outline, -1, (40, 40, 255), 2)

    inspection = Inspection(
        scene_id=window.scene_id,
        plume_found=True,
        clear_water_frac=clear_water_frac,
        area_ha=float(blob.sum()) * window.res_m**2 / 10_000,
        kind=_kind(features, in_blob, lake_color),
        near_cloud_frac=float(cloud_buffer[in_blob].mean()),
        glint_frac=float((texture[in_blob] > glint_thr).mean()),
        haze=(blue - lake_color.blue_median) / lake_color.blue_spread > HAZE_Z,
        texture=float(np.median(texture[in_blob]) / max(np.median(texture[in_clear]), EPS)),
        compactness=_compactness(blob),
        shore_attached=bool(np.any(touch & land)),
    )
    return inspection, overlay


def encode_crop(overlay: np.ndarray) -> bytes:
    """JPEG no larger than `CROP_MAX_PX` on its long side."""
    rows, cols = overlay.shape[:2]
    scale = min(1.0, CROP_MAX_PX / max(rows, cols))
    if scale < 1.0:
        size = (round(cols * scale), round(rows * scale))
        overlay = cv2.resize(overlay, size, interpolation=cv2.INTER_AREA)
    ok, buffer = cv2.imencode(".jpg", overlay, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not ok:
        raise ValueError("could not encode crop")
    return buffer.tobytes()


def inspect_candidate(
    reader: SceneReader, store: CropStore, candidate_id: str, lat: float, lon: float, on: date
) -> InspectedCrop:
    """Read a 10 m window at the candidate, inspect it and save the crop."""
    context = reader.read_window(lat, lon, on, CONTEXT_HALF_KM, CONTEXT_RES_M)
    window = reader.read_window(lat, lon, on, INSPECT_HALF_KM, INSPECT_RES_M)
    inspection, overlay = inspect_window(window, open_lake_color(context))
    jpeg = encode_crop(overlay)
    return InspectedCrop(inspection, jpeg, store.put(f"crops/{candidate_id}.jpg", jpeg))

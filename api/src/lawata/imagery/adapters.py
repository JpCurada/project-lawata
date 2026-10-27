"""Imagery adapters: Sentinel-2 L2A COGs on AWS Open Data via Earth Search STAC."""

from collections.abc import Iterator
from datetime import date, timedelta
from typing import Any

import numpy as np
import rasterio
from pystac_client import Client
from rasterio.enums import Resampling
from rasterio.warp import transform as warp_xy
from rasterio.windows import from_bounds

from lawata.imagery.domain import (
    COLLECTION,
    INSPECT_BANDS,
    LOCAL_CLOUD_HALF_KM,
    LOCAL_CLOUD_RES_M,
    STAC_URL,
    BandWindow,
    PassCloud,
    SceneNotFoundError,
)
from lawata.imagery.service import local_cloud_frac, to_reflectance

GDAL_ENV: dict[str, Any] = {
    "AWS_NO_SIGN_REQUEST": "YES",
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "GDAL_HTTP_MULTIRANGE": "YES",
    "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
}


class StacCogReader:
    """`SceneReader` that reads only the needed window of each band (never whole scenes).

    It also lists recent passes with their local cloud share (the analysis `SceneCatalog`).
    When several items cover a point on one day, the one with the least cloud around the
    point is used, so the agent inspects the same clear item the pass was chosen for.
    """

    def __init__(self, client: Any | None = None) -> None:
        self._client = client
        self._cloud_cache: dict[tuple[str, float, float], float | None] = {}

    def read_window(
        self, lat: float, lon: float, on: date, half_km: float, res_m: float
    ) -> BandWindow:
        """Read the bands around (lat, lon) from the least cloudy item of day `on`."""
        item = self._best_item(lat, lon, on)
        props = item.properties
        offset_applied = bool(props.get("earthsearch:boa_offset_applied", False))
        baseline = float(props.get("s2:processing_baseline", 0) or 0)

        with rasterio.Env(**GDAL_ENV):
            bounds = self._bounds(item, lat, lon, half_km)
            size = round(2 * half_km * 1000 / res_m)
            bands = {
                name: self._read_band(item.assets[name].href, bounds, size, name == "scl")
                for name in INSPECT_BANDS
            }
        for name in INSPECT_BANDS:
            if name != "scl":
                bands[name] = to_reflectance(bands[name], offset_applied, baseline)
        return BandWindow(item.id, res_m, bands, (size // 2, size // 2))

    def pass_clouds(
        self, lat: float, lon: float, until: date, days_back: int, max_tile_cloud_pct: float
    ) -> Iterator[PassCloud]:
        """Items over the point, newest first, with their local cloud share.

        The tile-level `eo:cloud_cover` is only a cheap pre-filter; each item's SCL is read
        lazily, so the caller pays only for the passes it looks at.
        """
        items = self._search(
            lat,
            lon,
            f"{until - timedelta(days=days_back)}/{until}",
            {"eo:cloud_cover": {"lt": max_tile_cloud_pct}},
        )
        items.sort(key=lambda it: (-it.datetime.timestamp(), _tile_cloud(it)))
        for item in items:
            yield PassCloud(item.datetime.date(), item.id, self._cached_cloud(item, lat, lon))

    def _best_item(self, lat: float, lon: float, on: date) -> Any:
        items = self._search(lat, lon, on.isoformat())
        if not items:
            raise SceneNotFoundError(f"no Sentinel-2 scene at {lat},{lon} on {on}")
        if len(items) == 1:
            return items[0]
        return min(
            items,
            key=lambda it: (_cloud_rank(self._cached_cloud(it, lat, lon)), _tile_cloud(it)),
        )

    def _search(
        self, lat: float, lon: float, datetime_range: str, query: dict[str, Any] | None = None
    ) -> list[Any]:
        client = self._client or Client.open(STAC_URL)
        search = client.search(
            collections=[COLLECTION],
            intersects={"type": "Point", "coordinates": [lon, lat]},
            datetime=datetime_range,
            query=query,
            max_items=50,
        )
        return [item for item in search.items() if item.datetime]

    def _cached_cloud(self, item: Any, lat: float, lon: float) -> float | None:
        key = (item.id, lat, lon)
        if key not in self._cloud_cache:
            self._cloud_cache[key] = self._item_cloud_frac(item, lat, lon)
        return self._cloud_cache[key]

    def _item_cloud_frac(self, item: Any, lat: float, lon: float) -> float | None:
        """Cloud share of the item's SCL over `LOCAL_CLOUD_HALF_KM` around the point (60 m)."""
        with rasterio.Env(**GDAL_ENV):
            bounds = self._bounds(item, lat, lon, LOCAL_CLOUD_HALF_KM)
            size = round(2 * LOCAL_CLOUD_HALF_KM * 1000 / LOCAL_CLOUD_RES_M)
            scl = self._read_band(item.assets["scl"].href, bounds, size, categorical=True)
        return local_cloud_frac(scl)

    @staticmethod
    def _bounds(
        item: Any, lat: float, lon: float, half_km: float
    ) -> tuple[float, float, float, float]:
        """Square window around the point in the item's projected CRS (call inside GDAL env)."""
        with rasterio.open(item.assets["green"].href) as ref:
            projected = warp_xy("EPSG:4326", ref.crs, [lon], [lat])
        x, y = projected[0][0], projected[1][0]
        half_m = half_km * 1000
        return (x - half_m, y - half_m, x + half_m, y + half_m)

    @staticmethod
    def _read_band(
        href: str, bounds: tuple[float, float, float, float], size: int, categorical: bool
    ) -> np.ndarray:
        with rasterio.open(href) as src:
            window = from_bounds(*bounds, transform=src.transform)
            return src.read(
                1,
                window=window,
                out_shape=(size, size),
                boundless=True,
                fill_value=0,
                resampling=Resampling.nearest if categorical else Resampling.bilinear,
            )


def _tile_cloud(item: Any) -> float:
    return float(item.properties.get("eo:cloud_cover", 100) or 100)


def _cloud_rank(frac: float | None) -> float:
    """Unknown local cloud (too little data) ranks after any measured value."""
    return 2.0 if frac is None else frac

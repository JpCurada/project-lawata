"""Synthetic 10 m band windows: land strip on the left, lake, optional brown plume."""

import numpy as np

from lawata.imagery.domain import BandWindow

SIZE = 200
LAND_COLS = 40
LAKE = {"blue": 0.03, "green": 0.08, "red": 0.04, "nir": 0.05, "swir16": 0.01}
LAND = {"blue": 0.05, "green": 0.08, "red": 0.09, "nir": 0.3, "swir16": 0.25}
BROWN = {"red": 0.075, "blue": 0.022}


def make_window(
    plume: bool = True,
    cloud_cols: tuple[int, int] | None = None,
    plume_rows: tuple[int, int] = (80, 130),
    plume_cols: tuple[int, int] = (LAND_COLS, 100),
) -> BandWindow:
    rng = np.random.default_rng(0)
    bands: dict[str, np.ndarray] = {}
    for name, lake_value in LAKE.items():
        band = np.full((SIZE, SIZE), lake_value, np.float32)
        band += rng.normal(0, 0.0015, band.shape).astype(np.float32)
        band[:, :LAND_COLS] = LAND[name]
        if plume and name in BROWN:
            band[slice(*plume_rows), slice(*plume_cols)] = BROWN[name]
        bands[name] = band
    scl = np.full((SIZE, SIZE), 6, np.uint8)
    scl[:, :LAND_COLS] = 4
    if cloud_cols:
        scl[60:150, cloud_cols[0] : cloud_cols[1]] = 9
        for name in LAKE:
            bands[name][60:150, cloud_cols[0] : cloud_cols[1]] = 0.4
    bands["scl"] = scl
    return BandWindow("S2B_TEST", 10.0, bands, (60, 105))

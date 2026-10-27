from datetime import date

import cv2
import numpy as np
import pytest

from detection.windows import LAND_COLS, SIZE, make_window
from lawata.detection.adapters import MemoryCropStore
from lawata.detection.domain import CROP_MAX_PX
from lawata.detection.service import (
    encode_crop,
    inspect_candidate,
    inspect_window,
    open_lake_color,
)
from lawata.imagery.domain import BandWindow
from lawata.imagery.service import to_reflectance


def test_finds_shore_attached_brown_plume_at_point() -> None:
    inspection, overlay = inspect_window(make_window())
    assert inspection.plume_found
    assert inspection.shore_attached
    assert not inspection.cloud_edge
    assert inspection.kind.startswith("brown")
    assert 20 <= inspection.area_ha <= 35
    assert overlay.shape == (SIZE, SIZE, 3)


def test_plume_next_to_cloud_is_a_cloud_edge() -> None:
    inspection, _ = inspect_window(make_window(cloud_cols=(105, 140)))
    assert inspection.plume_found
    assert inspection.cloud_edge
    assert inspection.as_tool_result()["cloud_edge"] is True


def test_clean_lake_has_no_plume() -> None:
    inspection, _ = inspect_window(make_window(plume=False))
    assert not inspection.plume_found
    assert set(inspection.as_tool_result()) == {"plume_found", "clear_water_frac"}


def test_plume_filling_the_window_is_found_against_open_lake_colour() -> None:
    whole_lake = make_window(plume_rows=(0, SIZE), plume_cols=(LAND_COLS, SIZE))
    alone, _ = inspect_window(whole_lake)
    assert not alone.plume_found  # the local reference is the plume itself

    open_lake = open_lake_color(BandWindow("S2B_TEST", 60.0, make_window(False).bands, (0, 0)))
    with_context, _ = inspect_window(whole_lake, open_lake)
    assert with_context.plume_found
    assert with_context.shore_attached


def test_tool_result_is_compact() -> None:
    inspection, _ = inspect_window(make_window())
    assert len(str(inspection.as_tool_result())) <= 300


def test_crop_is_jpeg_within_size_limit() -> None:
    jpeg = encode_crop(np.zeros((900, 600, 3), np.uint8))
    image = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
    assert image is not None
    assert max(image.shape[:2]) == CROP_MAX_PX


def test_inspect_candidate_reads_context_then_10m_window_and_saves_crop() -> None:
    reads: list[tuple[float, date]] = []

    class Reader:
        def read_window(
            self, lat: float, lon: float, on: date, half_km: float, res_m: float
        ) -> BandWindow:
            reads.append((res_m, on))
            return make_window()

    store = MemoryCropStore()
    result = inspect_candidate(Reader(), store, "dry", 14.5, 121.1, date(2026, 5, 6))
    assert reads == [(60.0, date(2026, 5, 6)), (10.0, date(2026, 5, 6))]
    assert result.inspection.plume_found
    assert result.crop_uri == "memory://crops/dry.jpg"
    assert store.crops["crops/dry.jpg"] == result.jpeg


@pytest.mark.parametrize(
    ("offset_applied", "baseline", "expected"),
    [(False, 5.0, 0.0), (True, 5.0, 0.1), (False, 3.0, 0.1)],
)
def test_reflectance_offset_applied_once(
    offset_applied: bool, baseline: float, expected: float
) -> None:
    reflectance = to_reflectance(np.array([1000, 0], np.uint16), offset_applied, baseline)
    assert reflectance[0] == pytest.approx(expected, abs=1e-6)
    assert np.isnan(reflectance[1])

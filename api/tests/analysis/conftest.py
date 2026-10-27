"""In-memory scene reader and crop store for the box image (no network, no S3)."""

from datetime import date

import numpy as np
import pytest

from lawata.imagery.domain import BandWindow


class FakeReader:
    """Returns a flat true-color window; records every read; can be told to fail."""

    def __init__(self) -> None:
        self.calls: list[tuple[float, float, date, float, float]] = []
        self.error: Exception | None = None

    def read_window(
        self, lat: float, lon: float, on: date, half_km: float, res_m: float
    ) -> BandWindow:
        self.calls.append((lat, lon, on, half_km, res_m))
        if self.error:
            raise self.error
        size = round(2 * half_km * 1000 / res_m)
        bands = {b: np.full((size, size), 0.05, np.float32) for b in ("blue", "green", "red")}
        return BandWindow("S2B_TEST", res_m, bands, (size // 2, size // 2))


class FakeStore:
    """Keeps crops in a dict and answers with `s3://evidence/<key>`."""

    def __init__(self) -> None:
        self.saved: dict[str, bytes] = {}

    def put(self, key: str, jpeg: bytes) -> str:
        self.saved[key] = jpeg
        return f"s3://evidence/{key}"


@pytest.fixture
def reader() -> FakeReader:
    return FakeReader()


@pytest.fixture
def store() -> FakeStore:
    return FakeStore()

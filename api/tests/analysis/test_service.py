from collections.abc import Iterator
from datetime import date
from typing import Any

from lawata.agent.domain import Candidate
from lawata.analysis.domain import AreaAnalysis, AreaBox, BoxImagery
from lawata.analysis.service import analyze_area
from lawata.detection.domain import CropStore
from lawata.imagery.domain import PassCloud, SceneNotFoundError, SceneReader

TODAY = date(2026, 10, 25)
PASS = date(2026, 10, 20)
BOX = AreaBox(west=121.140, south=14.495, east=121.150, north=14.505)
AGENT_CROP = "s3://evidence/crops/area-1.jpg"


class FakeCatalog:
    """Passes newest first, like `StacCogReader.pass_clouds`; counts how many were read."""

    def __init__(self, passes: list[PassCloud] | None = None) -> None:
        self.passes = [PassCloud(PASS, "S2B_CLEAR", 0.0)] if passes is None else passes
        self.read = 0

    def pass_clouds(
        self, lat: float, lon: float, until: date, days_back: int, max_tile_cloud_pct: float
    ) -> Iterator[PassCloud]:
        for found in self.passes:
            self.read += 1
            yield found


class FakeRuntime:
    def __init__(self, trace: list[dict[str, Any]]) -> None:
        self.trace = trace

    def investigate(self, candidate: Candidate) -> dict[str, Any]:
        return {
            "action": "mark_artifact",
            "status": "closed",
            "reason": "Cloud cover dominates the 10 m crop.",
            "trace": self.trace,
        }


class FakeLinks:
    """Links only objects in the `evidence` bucket, like `S3EvidenceLinks`."""

    def url_for(self, uri: str) -> str | None:
        prefix = "s3://evidence/"
        if not uri.startswith(prefix):
            return None
        return "https://signed.example/" + uri.removeprefix(prefix)


def _inspected(crop: str) -> list[dict[str, Any]]:
    return [
        {"tool": "inspect_plume", "args": {}, "result": {"plume_found": False, "crop": crop}},
        {"tool": "mark_artifact", "args": {"reason": "cloud"}},
    ]


def _run(
    trace: list[dict[str, Any]],
    reader: SceneReader,
    store: CropStore,
    catalog: FakeCatalog | None = None,
) -> AreaAnalysis:
    return analyze_area(
        BOX,
        None,
        TODAY,
        catalog or FakeCatalog(),
        FakeRuntime(trace),
        lambda: "abc123",
        links=FakeLinks(),
        box_imagery=BoxImagery(reader, store),
    )


def test_agent_crop_is_linked_when_the_agent_inspected(reader: Any, store: Any) -> None:
    result = _run(_inspected(AGENT_CROP), reader, store)
    assert result.crop_url == "https://signed.example/crops/area-1.jpg"
    assert result.crop_kind == "inspection"
    assert reader.calls == []


def test_box_is_rendered_when_the_agent_did_not_inspect(reader: Any, store: Any) -> None:
    result = _run([], reader, store)
    assert result.crop_kind == "box"
    assert result.crop_url == "https://signed.example/crops/area-abc123-box.jpg"
    ((lat, lon, on, half_km, res_m),) = reader.calls
    assert (round(lat, 3), round(lon, 3), on) == (14.5, 121.145, PASS)
    assert half_km >= 0.5
    assert res_m >= 10.0
    assert store.saved["crops/area-abc123-box.jpg"][:2] == b"\xff\xd8"  # JPEG


def test_box_is_rendered_when_the_agent_crop_cannot_be_linked(reader: Any, store: Any) -> None:
    result = _run(_inspected("memory://crops/area-1.jpg"), reader, store)
    assert result.crop_kind == "box"
    assert len(reader.calls) == 1


def test_box_image_failure_keeps_the_decision(reader: Any, store: Any) -> None:
    reader.error = SceneNotFoundError("none")
    result = _run([], reader, store)
    assert result.action == "mark_artifact"
    assert result.crop_url is None
    assert result.crop_kind is None


def test_no_clear_pass_renders_nothing(reader: Any, store: Any) -> None:
    result = _run([], reader, store, catalog=FakeCatalog([]))
    assert result.status == "no_clear_pass"
    assert result.crop_url is None
    assert reader.calls == []


# Local cloud over the inspect window at 14.345, 121.15 in October 2026 (real passes).
OCTOBER = [
    PassCloud(date(2026, 10, 23), "S2A_1023", 0.58),
    PassCloud(date(2026, 10, 18), "S2B_1018", 1.0),
    PassCloud(date(2026, 10, 15), "S2A_1015", 0.0),
    PassCloud(date(2026, 10, 13), "S2B_1013", 1.0),
]


def test_newest_pass_clear_over_the_box_is_chosen(reader: Any, store: Any) -> None:
    catalog = FakeCatalog(OCTOBER)
    result = _run([], reader, store, catalog=catalog)
    assert result.acquired_date == date(2026, 10, 15)
    assert catalog.read == 3  # stops at the first clear pass


def test_pass_without_enough_valid_pixels_is_skipped(reader: Any, store: Any) -> None:
    catalog = FakeCatalog([PassCloud(date(2026, 10, 23), "edge", None), *OCTOBER[2:]])
    assert _run([], reader, store, catalog=catalog).acquired_date == date(2026, 10, 15)


def test_only_cloudy_passes_is_no_clear_pass(reader: Any, store: Any) -> None:
    catalog = FakeCatalog([OCTOBER[0], OCTOBER[1], OCTOBER[3]])
    assert _run([], reader, store, catalog=catalog).status == "no_clear_pass"

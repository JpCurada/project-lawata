from collections.abc import Iterator
from datetime import date
from typing import Any

import pytest
from fastapi.testclient import TestClient

from lawata.agent.domain import Candidate
from lawata.analysis.api import (
    get_agent_runtime,
    get_box_imagery,
    get_crop_links,
    get_scene_catalog,
)
from lawata.analysis.domain import BoxImagery
from lawata.api.app import app
from lawata.imagery.domain import PassCloud

CROP_URI = "s3://evidence/crops/area-1.jpg"

# ~1.1 x 1.1 km off Binangonan, inside the lake.
BOX = {"west": 121.140, "south": 14.495, "east": 121.150, "north": 14.505}


class FakeCatalog:
    def __init__(self, latest: date | None) -> None:
        self.latest = latest

    def pass_clouds(
        self, lat: float, lon: float, until: date, days_back: int, max_tile_cloud_pct: float
    ) -> list[PassCloud]:
        return [PassCloud(self.latest, "S2B_TEST", 0.0)] if self.latest else []


class FakeLinks:
    def url_for(self, uri: str) -> str | None:
        return "https://signed.example/" + uri.rsplit("/", 1)[-1]


OVERRIDDEN = (get_scene_catalog, get_agent_runtime, get_crop_links, get_box_imagery)


class FakeRuntime:
    def __init__(self) -> None:
        self.candidates: list[Candidate] = []

    def investigate(self, candidate: Candidate) -> dict[str, Any]:
        self.candidates.append(candidate)
        return {
            "action": "create_sampling_task",
            "status": "pending_approval",
            "reason": "Suspicious, verify: dry-weather plume at the shore.",
            "trace": [
                {"tool": "inspect_plume", "args": {}, "result": {"crop": CROP_URI}},
                {"tool": "create_sampling_task", "args": {"reason": "dry"}},
            ],
            "model": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        }


@pytest.fixture
def runtime() -> FakeRuntime:
    return FakeRuntime()


@pytest.fixture
def catalog() -> FakeCatalog:
    return FakeCatalog(date(2026, 10, 20))


@pytest.fixture
def client(
    catalog: FakeCatalog,
    runtime: FakeRuntime,
    reader: Any,
    store: Any,
    researcher_headers: dict[str, str],
) -> Iterator[TestClient]:
    saved = {key: app.dependency_overrides.get(key) for key in OVERRIDDEN}
    app.dependency_overrides[get_scene_catalog] = lambda: catalog
    app.dependency_overrides[get_agent_runtime] = lambda: runtime
    app.dependency_overrides[get_crop_links] = FakeLinks
    app.dependency_overrides[get_box_imagery] = lambda: BoxImagery(reader, store)
    with TestClient(app, headers=researcher_headers) as test_client:
        yield test_client
    for key, provider in saved.items():
        if provider is None:
            app.dependency_overrides.pop(key, None)
        else:
            app.dependency_overrides[key] = provider


def test_box_center_goes_to_the_agent_on_latest_clear_pass(
    client: TestClient, runtime: FakeRuntime
) -> None:
    response = client.post("/api/analyses", json=BOX)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "investigated"
    assert body["action"] == "create_sampling_task"
    assert body["decision_status"] == "pending_approval"
    assert body["acquired_date"] == "2026-10-20"
    assert body["trace"][0]["tool"] == "inspect_plume"
    assert body["crop_url"] == "https://signed.example/area-1.jpg"
    assert body["crop_kind"] == "inspection"
    assert body["model"] == "us.anthropic.claude-haiku-4-5-20251001-v1:0"

    (candidate,) = runtime.candidates
    assert candidate.candidate_id.startswith("area-")
    assert (candidate.lat, candidate.lon) == (14.5, 121.145)
    assert candidate.acquired_date == "2026-10-20"
    assert 100 < candidate.area_ha < 150


def test_given_date_is_used_as_is(client: TestClient, runtime: FakeRuntime) -> None:
    response = client.post("/api/analyses", json=BOX | {"date": "2026-05-06"})
    assert response.status_code == 200
    assert runtime.candidates[0].acquired_date == "2026-05-06"


def test_no_clear_pass_never_calls_the_agent(
    client: TestClient, catalog: FakeCatalog, runtime: FakeRuntime
) -> None:
    catalog.latest = None
    response = client.post("/api/analyses", json=BOX)
    assert response.status_code == 200
    assert response.json()["status"] == "no_clear_pass"
    assert response.json()["crop_url"] is None
    assert response.json()["crop_kind"] is None
    assert runtime.candidates == []


@pytest.mark.parametrize(
    ("box", "message"),
    [
        (BOX | {"east": 121.200}, "under 5 km"),
        ({"west": 120.90, "south": 14.40, "east": 120.91, "north": 14.41}, "inside Laguna"),
        (BOX | {"east": BOX["west"]}, "width and height"),
    ],
)
def test_bad_box_is_422_without_calling_the_agent(
    client: TestClient, runtime: FakeRuntime, box: dict[str, float], message: str
) -> None:
    response = client.post("/api/analyses", json=box)
    assert response.status_code == 422
    assert message in response.json()["detail"]
    assert runtime.candidates == []


def test_future_date_is_422(client: TestClient) -> None:
    assert client.post("/api/analyses", json=BOX | {"date": "2999-01-01"}).status_code == 422


def test_runtime_failure_is_502(client: TestClient, runtime: FakeRuntime) -> None:
    def boom(candidate: Candidate) -> dict[str, Any]:
        raise RuntimeError("throttled")

    runtime.investigate = boom  # type: ignore[method-assign]
    response = client.post("/api/analyses", json=BOX)
    assert response.status_code == 502


def test_requires_a_researcher() -> None:
    with TestClient(app) as anonymous:
        assert anonymous.post("/api/analyses", json=BOX).status_code == 401


def _no_inspect(runtime: FakeRuntime) -> None:
    def no_inspect(candidate: Candidate) -> dict[str, Any]:
        runtime.candidates.append(candidate)
        return {"action": "schedule_recheck", "status": "recheck", "reason": "x", "trace": []}

    runtime.investigate = no_inspect  # type: ignore[method-assign]


def test_box_image_when_the_agent_did_not_inspect(client: TestClient, runtime: FakeRuntime) -> None:
    _no_inspect(runtime)
    body = client.post("/api/analyses", json=BOX).json()
    assert body["crop_kind"] == "box"
    assert body["crop_url"].startswith("https://signed.example/area-")
    assert body["crop_url"].endswith("-box.jpg")


def test_no_image_when_box_imagery_is_not_set_up(client: TestClient, runtime: FakeRuntime) -> None:
    _no_inspect(runtime)
    app.dependency_overrides[get_box_imagery] = lambda: None
    body = client.post("/api/analyses", json=BOX).json()
    assert body["crop_url"] is None
    assert body["crop_kind"] is None

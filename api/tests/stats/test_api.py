from fastapi.testclient import TestClient

from lawata.api.app import app
from lawata.stats.api import get_stats_repository
from lawata.stats.domain import DashboardStats


class _EmptyRepository:
    def get_stats(self) -> DashboardStats:
        return DashboardStats(0, 0, 0, None)


def test_stats_ok(client: TestClient) -> None:
    response = client.get("/api/stats")
    assert response.status_code == 200
    assert response.json() == {
        "total_plumes": 21,
        "dry_weather_plumes": 6,
        "pending_sampling_tasks": 1,
        "last_scene_date": "2026-06-01",
    }


def test_stats_empty_database_has_null_scene_date() -> None:
    app.dependency_overrides[get_stats_repository] = _EmptyRepository
    try:
        body = TestClient(app).get("/api/stats").json()
    finally:
        app.dependency_overrides.clear()
    assert body == {
        "total_plumes": 0,
        "dry_weather_plumes": 0,
        "pending_sampling_tasks": 0,
        "last_scene_date": None,
    }


def test_stats_response_model_is_typed_in_openapi(client: TestClient) -> None:
    schema = client.get("/openapi.json").json()
    ref = schema["paths"]["/api/stats"]["get"]["responses"]["200"]["content"]["application/json"]
    assert ref["schema"]["$ref"].endswith("/StatsOut")
    props = schema["components"]["schemas"]["StatsOut"]["properties"]
    assert set(props) == {
        "total_plumes",
        "dry_weather_plumes",
        "pending_sampling_tasks",
        "last_scene_date",
    }

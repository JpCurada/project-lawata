import os
import subprocess
import sys

import pytest
from fastapi.testclient import TestClient

from lawata.api import app as app_module
from lawata.api.app import app

DEV_ORIGIN = "http://localhost:5173"

EXPECTED_PATHS: dict[tuple[str, str], str] = {
    ("get", "/api/health"): "health",
    ("get", "/api/me"): "auth",
    ("get", "/api/plumes"): "sightings",
    ("get", "/api/plumes.geojson"): "sightings",
    ("get", "/api/plumes/{plume_id}"): "sightings",
    ("get", "/api/plumes/{plume_id}/reviews"): "sightings",
    ("post", "/api/plumes/{plume_id}/reviews"): "sightings",
    ("get", "/api/places"): "sightings",
    ("get", "/api/sampling-tasks"): "sampling",
    ("get", "/api/sampling-tasks/{task_id}"): "sampling",
    ("post", "/api/sampling-tasks/{task_id}/approve"): "sampling",
    ("post", "/api/sampling-tasks/{task_id}/reject"): "sampling",
    ("get", "/api/stats"): "stats",
    ("post", "/api/analyses"): "analysis",
}


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def _preflight(client: TestClient, origin: str, method: str = "GET"):
    return client.options(
        "/api/stats",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": method,
            "Access-Control-Request-Headers": "content-type",
        },
    )


def test_cors_preflight_from_dev_origin_is_allowed(client: TestClient) -> None:
    response = _preflight(client, DEV_ORIGIN, "POST")
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == DEV_ORIGIN
    assert "POST" in response.headers["access-control-allow-methods"]
    assert "content-type" in response.headers["access-control-allow-headers"].lower()


def test_cors_preflight_from_other_origin_gets_no_allow_origin(client: TestClient) -> None:
    response = _preflight(client, "http://evil.example")
    assert "access-control-allow-origin" not in response.headers


def test_cors_rejects_unneeded_method(client: TestClient) -> None:
    response = _preflight(client, DEV_ORIGIN, "DELETE")
    assert response.status_code == 400


def test_openapi_lists_every_path_with_its_tag(client: TestClient) -> None:
    schema = client.get("/openapi.json").json()
    for (method, path), tag in EXPECTED_PATHS.items():
        assert path in schema["paths"], path
        assert schema["paths"][path][method]["tags"] == [tag], (method, path)
    declared = {tag["name"] for tag in schema["tags"]}
    assert declared == set(EXPECTED_PATHS.values())
    assert all(tag["description"] for tag in schema["tags"])
    assert schema["info"]["title"] and schema["info"]["version"] and schema["info"]["description"]


def test_docs_page_is_served(client: TestClient) -> None:
    assert client.get("/docs").status_code == 200


def test_lambda_handler_wraps_the_same_app() -> None:
    assert app_module.handler.app is app


def test_cors_allows_authorization_header(client: TestClient) -> None:
    response = client.options(
        "/api/me",
        headers={
            "Origin": DEV_ORIGIN,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert response.status_code == 200
    assert "authorization" in response.headers["access-control-allow-headers"].lower()


def test_app_refuses_to_start_with_auth_disabled_in_lambda() -> None:
    env = {**os.environ, "AUTH_DISABLED": "true", "AWS_LAMBDA_FUNCTION_NAME": "lawata-api"}
    result = subprocess.run(
        [sys.executable, "-c", "import lawata.api.app"],
        env=env,
        capture_output=True,
        text=True,
        check=False,
        timeout=120,
    )
    assert result.returncode != 0
    assert "AUTH_DISABLED=true is refused in AWS Lambda" in result.stderr


def test_box_imagery_is_off_without_a_bucket(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LAWATA_BUCKET", raising=False)
    assert app_module.box_imagery_from_env() is None


def test_box_imagery_uses_the_evidence_bucket(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LAWATA_BUCKET", "evidence")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-west-2")
    imagery = app_module.box_imagery_from_env()
    assert imagery is not None
    assert imagery.store.put.__self__._bucket == "evidence"  # type: ignore[attr-defined]

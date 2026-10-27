from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from lawata.sampling.domain import SamplingStatus

from .conftest import FakeSamplingTaskRepository

BODY = {"note": "  Boat available Friday  "}
TokenFactory = Callable[..., str]


def test_list_tasks_newest_first(client: TestClient) -> None:
    response = client.get("/api/sampling-tasks")
    assert response.status_code == 200
    assert [t["id"] for t in response.json()] == [3, 2, 1]


def test_list_tasks_status_filter(client: TestClient) -> None:
    assert client.post("/api/sampling-tasks/2/approve", json=BODY).status_code == 200
    approved = client.get("/api/sampling-tasks", params={"status": "approved"}).json()
    assert [t["id"] for t in approved] == [2]
    pending = client.get("/api/sampling-tasks", params={"status": "pending_approval"}).json()
    assert [t["id"] for t in pending] == [3, 1]


@pytest.mark.parametrize("params", [{"status": "bogus"}, {"limit": 0}, {"limit": 201}])
def test_list_tasks_bad_query_is_422(client: TestClient, params: dict[str, object]) -> None:
    assert client.get("/api/sampling-tasks", params=params).status_code == 422


def test_get_task_detail(client: TestClient) -> None:
    response = client.get("/api/sampling-tasks/1")
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == 1
    assert body["event_id"] == 10
    assert body["place"] == "Binangonan"
    assert body["plume_date"] == "2026-05-06"
    assert body["status"] == "pending_approval"
    assert body["sites"][0] == {"label": "entry_point", "lon": 121.19, "lat": 14.46}
    assert body["reviewed_by"] is None


def test_get_task_missing_is_404(client: TestClient) -> None:
    assert client.get("/api/sampling-tasks/999").status_code == 404


def test_approve_ok_then_second_approve_is_409(client: TestClient) -> None:
    response = client.post("/api/sampling-tasks/1/approve", json=BODY)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "approved"
    assert body["reviewed_by"] == "ana"
    assert body["review_note"] == "Boat available Friday"
    assert body["reviewed_at"]

    again = client.post("/api/sampling-tasks/1/approve", json=BODY)
    assert again.status_code == 409
    assert again.json() == {
        "detail": "task 1 is approved; cannot approve",
        "status": "approved",
        "reviewed_by": "ana",
    }


def test_reject_after_approve_is_409(client: TestClient) -> None:
    assert client.post("/api/sampling-tasks/1/approve", json=BODY).status_code == 200
    response = client.post("/api/sampling-tasks/1/reject", json=BODY)
    assert response.status_code == 409
    assert response.json()["detail"] == "task 1 is approved; cannot reject"
    assert response.json()["status"] == "approved"


def test_reject_ok(client: TestClient) -> None:
    response = client.post("/api/sampling-tasks/1/reject", json=BODY)
    assert response.status_code == 200
    assert response.json()["status"] == "rejected"
    assert client.post("/api/sampling-tasks/1/approve", json=BODY).status_code == 409


@pytest.mark.parametrize("action", ["approve", "reject"])
def test_review_unknown_task_is_404(client: TestClient, action: str) -> None:
    assert client.post(f"/api/sampling-tasks/999/{action}", json=BODY).status_code == 404


@pytest.mark.parametrize("action", ["approve", "reject"])
@pytest.mark.parametrize(
    "body",
    [
        {"reviewer": "ana"},
        {"note": "ok"},
        {"note": "  ok  "},
        {},
        {"note": "     "},
        {"note": "x" * 501},
        {**BODY, "status": "done"},
    ],
)
def test_review_invalid_body_is_422(client: TestClient, action: str, body: dict[str, str]) -> None:
    assert client.post(f"/api/sampling-tasks/1/{action}", json=body).status_code == 422
    assert client.get("/api/sampling-tasks/1").json()["status"] == "pending_approval"


def test_no_http_route_completes_or_creates(client: TestClient) -> None:
    paths = client.get("/openapi.json").json()["paths"]
    sampling = {p: set(ops) for p, ops in paths.items() if p.startswith("/api/sampling-tasks")}
    assert sampling == {  # no create or complete route
        "/api/sampling-tasks": {"get"},
        "/api/sampling-tasks/{task_id}": {"get"},
        "/api/sampling-tasks/{task_id}/approve": {"post"},
        "/api/sampling-tasks/{task_id}/reject": {"post"},
    }


def test_openapi_declares_typed_responses(client: TestClient) -> None:
    schemas = client.get("/openapi.json").json()["components"]["schemas"]
    assert {"SamplingTaskOut", "SamplingSiteOut", "TaskReviewIn", "TaskConflictOut"} <= set(schemas)
    assert set(schemas["TaskReviewIn"]["properties"]) == {"note"}
    note = schemas["TaskReviewIn"]["properties"]["note"]
    assert (note["minLength"], note["maxLength"]) == (3, 500)


def test_responses_never_say_illegal(client: TestClient) -> None:
    client.post("/api/sampling-tasks/1/approve", json=BODY)
    texts = [
        client.get("/api/sampling-tasks").text,
        client.post("/api/sampling-tasks/1/approve", json=BODY).text,
        client.post("/api/sampling-tasks/1/reject", json=BODY).text,
    ]
    assert all("illegal" not in text.lower() for text in texts)


def test_note_boundaries_after_trim(client: TestClient) -> None:
    assert client.post("/api/sampling-tasks/1/approve", json={"note": "  abc  "}).status_code == 200
    assert client.post("/api/sampling-tasks/2/approve", json={"note": "x" * 500}).status_code == 200


def test_reviewer_comes_from_token_and_body_reviewer_is_ignored(
    client: TestClient, make_token: TokenFactory
) -> None:
    headers = {"Authorization": f"Bearer {make_token(**{'cognito:username': 'ben'})}"}
    body = {"note": "Boat available Friday", "reviewer": "mallory"}
    response = client.post("/api/sampling-tasks/1/approve", json=body, headers=headers)
    assert response.status_code == 200
    assert response.json()["reviewed_by"] == "ben"


def test_concurrent_approval_409_names_the_other_reviewer(
    client: TestClient, repository: FakeSamplingTaskRepository
) -> None:
    repository.before_update = lambda task_id: repository.force_status(
        task_id, SamplingStatus.REJECTED
    )
    response = client.post("/api/sampling-tasks/1/approve", json=BODY)
    assert response.status_code == 409
    assert response.json() == {
        "detail": "task 1 is rejected; cannot approve",
        "status": "rejected",
        "reviewed_by": "other",
    }


SAMPLING_ROUTES = [
    ("get", "/api/sampling-tasks"),
    ("get", "/api/sampling-tasks/1"),
    ("post", "/api/sampling-tasks/1/approve"),
    ("post", "/api/sampling-tasks/1/reject"),
]


@pytest.mark.parametrize(("method", "path"), SAMPLING_ROUTES)
def test_sampling_routes_require_sign_in(
    anonymous_client: TestClient, method: str, path: str
) -> None:
    response = anonymous_client.request(method, path, json=BODY)
    assert response.status_code == 401
    assert response.json() == {"detail": "Sign in required"}
    assert response.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize(("method", "path"), SAMPLING_ROUTES)
def test_sampling_routes_need_researchers_group(
    anonymous_client: TestClient, make_token: TokenFactory, method: str, path: str
) -> None:
    headers = {"Authorization": f"Bearer {make_token(**{'cognito:groups': ['observers']})}"}
    response = anonymous_client.request(method, path, json=BODY, headers=headers)
    assert response.status_code == 403
    assert response.json() == {"detail": "Researcher access required"}


def test_unauthorized_review_changes_nothing(
    anonymous_client: TestClient, repository: FakeSamplingTaskRepository
) -> None:
    anonymous_client.post("/api/sampling-tasks/1/approve", json=BODY)
    task = repository.get_task(1)
    assert task is not None
    assert task.status is SamplingStatus.PENDING_APPROVAL

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

TokenFactory = Callable[..., str]


def test_list_plumes_ok(client: TestClient) -> None:
    response = client.get("/api/plumes")
    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [4, 3, 2, 1]


def test_list_plumes_query_params(client: TestClient) -> None:
    response = client.get(
        "/api/plumes",
        params={"dry_only": "true", "from": "2026-01-01", "to": "2026-12-31", "limit": 10},
    )
    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [3]


def test_list_plumes_reversed_dates_is_422(client: TestClient) -> None:
    response = client.get("/api/plumes", params={"from": "2026-02-01", "to": "2026-01-01"})
    assert response.status_code == 422


def test_list_plumes_limit_over_max_is_422(client: TestClient) -> None:
    assert client.get("/api/plumes", params={"limit": 501}).status_code == 422


def test_geojson_route_not_shadowed_by_id(client: TestClient) -> None:
    response = client.get("/api/plumes.geojson", params={"dry_only": "true"})
    assert response.status_code == 200
    body = response.json()
    assert body["type"] == "FeatureCollection"
    assert len(body["features"]) == 2
    assert body["features"][0]["geometry"]["type"] == "Point"


def test_get_plume_detail(client: TestClient) -> None:
    response = client.get("/api/plumes/3")
    assert response.status_code == 200
    body = response.json()
    assert body["place"] == "Binangonan"
    assert body["latest_review"]["verdict"] == "confirmed"
    assert body["latest_decision"]["action"] == "create_sampling_task"
    assert body["evidence_image_url"] is None
    assert body["viewer"] == "researcher"
    assert body["status"] == "reviewed"


def test_get_plume_detail_public_hides_decision(anonymous_client: TestClient) -> None:
    body = anonymous_client.get("/api/plumes/3").json()
    assert body["viewer"] == "public"
    assert body["latest_decision"] is None
    assert body["status"] == "reviewed"
    assert body["latest_review"]["verdict"] == "confirmed"


@pytest.mark.parametrize(
    "token_args",
    [{"expires_in_s": -3600}, {"client_id": "wrong"}, {"cognito:groups": ["observers"]}],
)
def test_get_plume_invalid_or_non_researcher_token_is_public(
    anonymous_client: TestClient, make_token: TokenFactory, token_args: dict[str, object]
) -> None:
    for header in (f"Bearer {make_token(**token_args)}", "Bearer garbage"):
        response = anonymous_client.get("/api/plumes/3", headers={"Authorization": header})
        assert response.status_code == 200
        assert response.json()["viewer"] == "public"
        assert response.json()["latest_decision"] is None


def test_get_plume_missing_is_404(client: TestClient) -> None:
    assert client.get("/api/plumes/999").status_code == 404


def test_list_places(client: TestClient) -> None:
    response = client.get("/api/places")
    assert response.status_code == 200
    assert response.json()[0] == {
        "id": 5,
        "name": "Lumban",
        "province": "Laguna",
        "lat": 14.29,
        "lon": 121.46,
    }


def test_responses_never_say_illegal(client: TestClient) -> None:
    for path in ("/api/plumes", "/api/plumes/3", "/api/plumes.geojson", "/api/places"):
        assert "illegal" not in client.get(path).text.lower()


def test_openapi_declares_typed_responses(client: TestClient) -> None:
    schemas = client.get("/openapi.json").json()["components"]["schemas"]
    assert {"PlumeSummaryOut", "PlumeDetailOut", "PlumeFeatureCollection", "PlaceOut"} <= set(
        schemas
    )


REVIEW_BODY = {"verdict": "artifact", "reason": "  Cloud shadow  "}


def test_post_review_created(client: TestClient) -> None:
    response = client.post("/api/plumes/3/reviews", json=REVIEW_BODY)
    assert response.status_code == 201
    body = response.json()
    assert body["plume_id"] == 3
    assert body["verdict"] == "artifact"
    assert body["reason"] == "Cloud shadow"
    assert body["reviewer"] == "ana"
    assert isinstance(body["id"], int)
    assert body["reviewed_at"]


@pytest.mark.parametrize(
    "body",
    [
        {**REVIEW_BODY, "verdict": "illegal"},
        {**REVIEW_BODY, "reason": "   "},
        {**REVIEW_BODY, "reason": " ok "},
        {**REVIEW_BODY, "reason": "x" * 501},
        {**REVIEW_BODY, "extra": "x"},
        {"verdict": "confirmed"},
    ],
)
def test_post_review_invalid_body_is_422(client: TestClient, body: dict[str, str]) -> None:
    assert client.post("/api/plumes/3/reviews", json=body).status_code == 422


def test_post_review_unknown_plume_is_404(client: TestClient) -> None:
    assert client.post("/api/plumes/999/reviews", json=REVIEW_BODY).status_code == 404


def test_post_review_shows_as_latest_and_second_replaces_it(
    client: TestClient, review_history: Callable[[int], list[str]]
) -> None:
    first = {"verdict": "uncertain", "reason": "Hazy"}
    assert client.post("/api/plumes/1/reviews", json=first).status_code == 201
    assert client.get("/api/plumes/1").json()["latest_review"]["verdict"] == "uncertain"

    assert client.post("/api/plumes/1/reviews", json=REVIEW_BODY).status_code == 201
    assert client.get("/api/plumes/1").json()["latest_review"]["verdict"] == "artifact"
    assert review_history(1) == ["uncertain", "artifact"]


def test_post_review_reviewer_from_token_body_reviewer_ignored(
    client: TestClient, make_token: TokenFactory
) -> None:
    headers = {"Authorization": f"Bearer {make_token(**{'cognito:username': 'ben'})}"}
    body = {**REVIEW_BODY, "reviewer": "mallory"}
    response = client.post("/api/plumes/3/reviews", json=body, headers=headers)
    assert response.status_code == 201
    assert response.json()["reviewer"] == "ben"


def test_list_reviews_newest_first(client: TestClient) -> None:
    assert client.get("/api/plumes/1/reviews").json() == []
    client.post("/api/plumes/1/reviews", json={"verdict": "uncertain", "reason": "Hazy"})
    client.post("/api/plumes/1/reviews", json=REVIEW_BODY)
    response = client.get("/api/plumes/1/reviews")
    assert response.status_code == 200
    reviews = response.json()
    assert [r["verdict"] for r in reviews] == ["artifact", "uncertain"]
    assert set(reviews[0]) == {"id", "verdict", "reason", "reviewer", "reviewed_at"}
    assert reviews[0]["reviewer"] == "ana"


def test_list_reviews_unknown_plume_is_404(client: TestClient) -> None:
    assert client.get("/api/plumes/999/reviews").status_code == 404


@pytest.mark.parametrize("method", ["get", "post"])
def test_reviews_require_sign_in(anonymous_client: TestClient, method: str) -> None:
    response = anonymous_client.request(method, "/api/plumes/3/reviews", json=REVIEW_BODY)
    assert response.status_code == 401
    assert response.json() == {"detail": "Sign in required"}
    assert response.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize("method", ["get", "post"])
def test_reviews_need_researchers_group(
    anonymous_client: TestClient, make_token: TokenFactory, method: str
) -> None:
    headers = {"Authorization": f"Bearer {make_token(**{'cognito:groups': []})}"}
    response = anonymous_client.request(
        method, "/api/plumes/3/reviews", json=REVIEW_BODY, headers=headers
    )
    assert response.status_code == 403
    assert response.json() == {"detail": "Researcher access required"}


def test_openapi_plume_detail_has_viewer_and_status(client: TestClient) -> None:
    schemas = client.get("/openapi.json").json()["components"]["schemas"]
    detail = schemas["PlumeDetailOut"]["properties"]
    assert detail["viewer"]["enum"] == ["public", "researcher"]
    assert detail["status"]["enum"] == [
        "new",
        "triaged",
        "sampling_pending",
        "sampling_approved",
        "reviewed",
    ]
    assert set(schemas["ReviewIn"]["properties"]) == {"verdict", "reason"}
    assert "PlumeReviewOut" in schemas

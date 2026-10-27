import logging
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from lawata.api.app import app
from lawata.shared.auth.api import auth_settings
from lawata.shared.config import AuthSettings

TokenFactory = Callable[..., str]


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _assert_sign_in_required(response: Any) -> None:
    assert response.status_code == 401
    assert response.json() == {"detail": "Sign in required"}
    assert response.headers["www-authenticate"] == "Bearer"


def test_me_with_valid_token(client: TestClient, make_token: TokenFactory) -> None:
    response = client.get("/api/me", headers=_bearer(make_token(email="ana@example.org")))
    assert response.status_code == 200
    assert response.json() == {
        "username": "ana",
        "email": "ana@example.org",
        "groups": ["researchers"],
    }


def test_me_without_email_claim_is_null(client: TestClient, make_token: TokenFactory) -> None:
    assert client.get("/api/me", headers=_bearer(make_token())).json()["email"] is None


def test_me_missing_token_is_401(client: TestClient) -> None:
    _assert_sign_in_required(client.get("/api/me"))


@pytest.mark.parametrize(
    "token_args",
    [
        {"expires_in_s": -3600},
        {"client_id": "wrong-client"},
        {"token_use": "id"},
        {"iss": "https://cognito-idp.us-west-2.amazonaws.com/other-pool"},
    ],
    ids=["expired", "wrong_client_id", "wrong_token_use", "wrong_issuer"],
)
def test_me_invalid_token_is_401(
    client: TestClient, make_token: TokenFactory, token_args: dict[str, Any]
) -> None:
    _assert_sign_in_required(client.get("/api/me", headers=_bearer(make_token(**token_args))))


@pytest.mark.parametrize("header", ["Bearer not-a-jwt", "Basic YW5hOnB3", "Bearer", "bearer"])
def test_me_malformed_header_is_401(client: TestClient, header: str) -> None:
    _assert_sign_in_required(client.get("/api/me", headers={"Authorization": header}))


@pytest.mark.parametrize("groups", [[], ["observers"], None])
def test_me_not_in_researchers_is_403(
    client: TestClient, make_token: TokenFactory, groups: list[str] | None
) -> None:
    response = client.get("/api/me", headers=_bearer(make_token(**{"cognito:groups": groups})))
    assert response.status_code == 403
    assert response.json() == {"detail": "Researcher access required"}


def test_rejected_token_is_not_logged(
    client: TestClient, make_token: TokenFactory, caplog: pytest.LogCaptureFixture
) -> None:
    token = make_token(expires_in_s=-3600)
    with caplog.at_level(logging.DEBUG):
        client.get("/api/me", headers=_bearer(token))
    assert token not in caplog.text


def test_auth_disabled_makes_everyone_the_dev_researcher(client: TestClient) -> None:
    app.dependency_overrides[auth_settings] = lambda: AuthSettings(
        auth_disabled=True, aws_lambda_function_name=None
    )
    response = client.get("/api/me")
    assert response.status_code == 200
    assert response.json() == {"username": "dev", "email": None, "groups": ["researchers"]}


def test_openapi_declares_bearer_scheme_and_me(client: TestClient) -> None:
    schema = client.get("/openapi.json").json()
    assert "MeOut" in schema["components"]["schemas"]
    schemes = schema["components"]["securitySchemes"]
    assert schemes["CognitoAccessToken"] == {
        "type": "http",
        "scheme": "bearer",
        "description": "Cognito access token of a user in the `researchers` group.",
    }
    me = schema["paths"]["/api/me"]["get"]
    assert {"401", "403"} <= set(me["responses"])

from typing import Any

import pytest

from lawata.shared.auth.domain import (
    DEV_USER,
    AuthenticationError,
    AuthUser,
    CognitoPool,
    user_from_claims,
)

CLIENT_ID = "client-1"


def _claims(**overrides: Any) -> dict[str, Any]:
    claims: dict[str, Any] = {
        "token_use": "access",
        "client_id": CLIENT_ID,
        "cognito:username": "ana",
        "cognito:groups": ["researchers"],
    }
    claims.update(overrides)
    return {name: value for name, value in claims.items() if value is not None}


def test_pool_issuer_and_jwks_url() -> None:
    pool = CognitoPool(region="us-west-2", user_pool_id="us-west-2_abc", client_id=CLIENT_ID)
    assert pool.issuer == "https://cognito-idp.us-west-2.amazonaws.com/us-west-2_abc"
    assert pool.jwks_url == f"{pool.issuer}/.well-known/jwks.json"


def test_user_from_claims_valid() -> None:
    user = user_from_claims(_claims(email="ana@example.org"), CLIENT_ID)
    assert user == AuthUser(username="ana", email="ana@example.org", groups=("researchers",))
    assert user.is_researcher


def test_user_from_claims_falls_back_to_username_claim() -> None:
    claims = _claims(**{"cognito:username": None, "username": "ben"})
    assert user_from_claims(claims, CLIENT_ID).username == "ben"


def test_user_without_groups_is_not_researcher() -> None:
    user = user_from_claims(_claims(**{"cognito:groups": None}), CLIENT_ID)
    assert user.groups == ()
    assert not user.is_researcher
    assert user.email is None


@pytest.mark.parametrize(
    "overrides",
    [
        {"token_use": "id"},
        {"token_use": None},
        {"client_id": "other-client"},
        {"client_id": None},
        {"cognito:username": None},
        {"cognito:username": "   "},
        {"cognito:groups": "researchers"},
        {"cognito:groups": [1]},
    ],
)
def test_user_from_claims_rejects(overrides: dict[str, Any]) -> None:
    with pytest.raises(AuthenticationError):
        user_from_claims(_claims(**overrides), CLIENT_ID)


def test_dev_user_is_researcher() -> None:
    assert DEV_USER.username == "dev"
    assert DEV_USER.is_researcher

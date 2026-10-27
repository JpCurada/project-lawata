"""Auth fixtures for every test: a local RSA key signs Cognito-like access tokens (no network).

The JWKS adapter is replaced by a static key source, but signature, issuer and expiry are still
checked by the real PyJWT decoder, and the claim rules by the real domain code.
"""

import time
import uuid
from collections.abc import Callable, Iterator
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from lawata.api.app import app
from lawata.shared.auth.adapters import PyJwtTokenDecoder
from lawata.shared.auth.api import auth_settings, token_decoder
from lawata.shared.auth.domain import CognitoPool
from lawata.shared.config import AuthSettings

TEST_POOL = CognitoPool(
    region="us-west-2", user_pool_id="us-west-2_TestPool", client_id="test-client-id"
)
TEST_AUTH_SETTINGS = AuthSettings(
    cognito_region=TEST_POOL.region,
    cognito_user_pool_id=TEST_POOL.user_pool_id,
    cognito_client_id=TEST_POOL.client_id,
    auth_disabled=False,
    aws_lambda_function_name=None,
)
KEY_ID = "test-kid"

TokenFactory = Callable[..., str]


class StaticKeySource:
    """Stands in for the Cognito JWKS: always returns one public key."""

    def __init__(self, key: Any) -> None:
        self._key = key

    def key_for(self, token: str) -> Any:
        return self._key


@pytest.fixture(scope="session")
def rsa_private_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(scope="session")
def make_token(rsa_private_key: rsa.RSAPrivateKey) -> TokenFactory:
    """Sign an access token. Keyword args override claims; a None value removes the claim."""

    def make(
        *,
        signing_key: Any = None,
        algorithm: str = "RS256",
        expires_in_s: int = 3600,
        **claims: Any,
    ) -> str:
        now = int(time.time())
        payload: dict[str, Any] = {
            "sub": str(uuid.uuid4()),
            "iss": TEST_POOL.issuer,
            "client_id": TEST_POOL.client_id,
            "token_use": "access",
            "scope": "openid email profile",
            "cognito:username": "ana",
            "cognito:groups": ["researchers"],
            "auth_time": now,
            "iat": now,
            "exp": now + expires_in_s,
        }
        payload.update(claims)
        payload = {name: value for name, value in payload.items() if value is not None}
        key = rsa_private_key if signing_key is None else signing_key
        return jwt.encode(payload, key, algorithm=algorithm, headers={"kid": KEY_ID})

    return make


@pytest.fixture
def test_pool() -> CognitoPool:
    return TEST_POOL


@pytest.fixture
def stub_decoder(rsa_private_key: rsa.RSAPrivateKey) -> PyJwtTokenDecoder:
    """The real PyJWT decoder with the JWKS fetch replaced by the local public key."""
    return PyJwtTokenDecoder(StaticKeySource(rsa_private_key.public_key()), TEST_POOL.issuer)


@pytest.fixture(autouse=True)
def stub_auth(stub_decoder: PyJwtTokenDecoder) -> Iterator[None]:
    """Point the API's auth dependencies at the test pool and the local key."""
    decoder = stub_decoder
    app.dependency_overrides[auth_settings] = lambda: TEST_AUTH_SETTINGS
    app.dependency_overrides[token_decoder] = lambda: decoder
    yield
    app.dependency_overrides.pop(auth_settings, None)
    app.dependency_overrides.pop(token_decoder, None)


@pytest.fixture
def researcher_headers(make_token: TokenFactory) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token()}"}

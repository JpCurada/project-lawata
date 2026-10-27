"""PyJWT implementation of the token decoder, with Cognito's JWKS fetched once and cached."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol

import jwt

from lawata.shared.auth.domain import (
    CLOCK_LEEWAY_S,
    SIGNING_ALGORITHMS,
    AuthenticationError,
    CognitoPool,
)

JWKS_CACHE_LIFESPAN_S = 3600
JWKS_TIMEOUT_S = 5


class SigningKeySource(Protocol):
    """Finds the public key that signed a token (by its `kid` header)."""

    def key_for(self, token: str) -> Any:
        """Return a key usable by `jwt.decode`, or raise `AuthenticationError`."""
        ...


class CognitoJwksKeySource:
    """Public keys from a Cognito pool's JWKS URL.

    `PyJWKClient` caches the key set for `JWKS_CACHE_LIFESPAN_S` and refetches once when it sees
    an unknown `kid` (key rotation). One instance per process keeps the cache warm on Lambda.
    """

    def __init__(self, jwks_url: str) -> None:
        self._client = jwt.PyJWKClient(
            jwks_url,
            cache_keys=True,
            cache_jwk_set=True,
            lifespan=JWKS_CACHE_LIFESPAN_S,
            timeout=JWKS_TIMEOUT_S,
        )

    def key_for(self, token: str) -> Any:
        """Return the signing key for `token`'s `kid`."""
        try:
            return self._client.get_signing_key_from_jwt(token).key
        except jwt.PyJWTError as error:
            raise AuthenticationError(f"no signing key: {type(error).__name__}") from error


class PyJwtTokenDecoder:
    """Verifies RS256 signature, `iss`, and `exp`/`nbf` (with leeway) using PyJWT."""

    def __init__(self, key_source: SigningKeySource, issuer: str) -> None:
        self._key_source = key_source
        self._issuer = issuer

    def decode(self, token: str) -> Mapping[str, Any]:
        """Return verified claims or raise `AuthenticationError`."""
        key = self._key_source.key_for(token)
        try:
            return jwt.decode(
                token,
                key,
                algorithms=list(SIGNING_ALGORITHMS),
                issuer=self._issuer,
                leeway=CLOCK_LEEWAY_S,
                # Cognito access tokens have no `aud`; the app client is checked in the domain.
                options={"require": ["exp", "iss"], "verify_aud": False},
            )
        except jwt.PyJWTError as error:
            raise AuthenticationError(f"invalid token: {type(error).__name__}") from error


def cognito_token_decoder(pool: CognitoPool) -> PyJwtTokenDecoder:
    """Build the production decoder for `pool`."""
    return PyJwtTokenDecoder(CognitoJwksKeySource(pool.jwks_url), pool.issuer)

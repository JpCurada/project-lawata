"""FastAPI dependencies for researcher sign-in, and `GET /api/me`.

- `require_researcher`: 401 `{"detail": "Sign in required"}` (+ `WWW-Authenticate: Bearer`)
  for a missing or invalid token; 403 `{"detail": "Researcher access required"}` for a valid
  token outside the `researchers` group.
- `optional_researcher`: the researcher, or None for a missing, invalid or non-researcher
  token. It never fails the request, so public routes stay public.

With `AUTH_DISABLED=true` (refused in Lambda) every request is the `dev` researcher.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from lawata.shared.auth import service
from lawata.shared.auth.adapters import cognito_token_decoder
from lawata.shared.auth.domain import (
    DEV_USER,
    AuthenticationError,
    AuthUser,
    CognitoPool,
    TokenDecoder,
)
from lawata.shared.config import AuthSettings, ConfigError, get_auth_settings
from lawata.shared.logging import get_logger

logger = get_logger(__name__)

SIGN_IN_REQUIRED = "Sign in required"
RESEARCHER_REQUIRED = "Researcher access required"

_bearer = HTTPBearer(
    auto_error=False,
    scheme_name="CognitoAccessToken",
    description="Cognito access token of a user in the `researchers` group.",
)


def auth_settings() -> AuthSettings:
    """Provide auth settings (overridden in tests)."""
    return get_auth_settings()


Settings = Annotated[AuthSettings, Depends(auth_settings)]


def cognito_pool(settings: AuthSettings) -> CognitoPool:
    """Return the configured pool, or raise `ConfigError` naming the missing variables."""
    if settings.cognito_user_pool_id is None or settings.cognito_client_id is None:
        raise ConfigError("Set COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID (or AUTH_DISABLED=true)")
    return CognitoPool(
        region=settings.cognito_region,
        user_pool_id=settings.cognito_user_pool_id,
        client_id=settings.cognito_client_id,
    )


@lru_cache(maxsize=4)
def _decoder_for(pool: CognitoPool) -> TokenDecoder:
    # One decoder per pool per process, so the JWKS cache survives across requests.
    return cognito_token_decoder(pool)


def token_decoder(settings: Settings) -> TokenDecoder | None:
    """Provide the token decoder (overridden in tests).

    None when auth is disabled or Cognito is not configured; in the latter case a request that
    carries a token fails loudly with `ConfigError`, while requests without one are unaffected.
    """
    if settings.auth_disabled:
        return None
    try:
        return _decoder_for(cognito_pool(settings))
    except ConfigError:
        return None


Credentials = Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]
Decoder = Annotated[TokenDecoder | None, Depends(token_decoder)]


def _resolve_user(
    credentials: HTTPAuthorizationCredentials | None,
    settings: AuthSettings,
    decoder: TokenDecoder | None,
) -> AuthUser:
    if settings.auth_disabled:
        return DEV_USER
    if credentials is None:
        raise AuthenticationError("no bearer token")
    if decoder is None:
        raise ConfigError("Set COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID (or AUTH_DISABLED=true)")
    try:
        return service.authenticate(
            decoder, credentials.credentials, cognito_pool(settings).client_id
        )
    except AuthenticationError as error:
        # The reason is logged, never the token.
        logger.info("rejected bearer token: %s", error)
        raise


def require_researcher(credentials: Credentials, settings: Settings, decoder: Decoder) -> AuthUser:
    """Return the signed-in researcher or fail with 401/403."""
    try:
        user = _resolve_user(credentials, settings, decoder)
    except AuthenticationError as error:
        raise HTTPException(
            status_code=401, detail=SIGN_IN_REQUIRED, headers={"WWW-Authenticate": "Bearer"}
        ) from error
    if not user.is_researcher:
        raise HTTPException(status_code=403, detail=RESEARCHER_REQUIRED)
    return user


def optional_researcher(
    credentials: Credentials, settings: Settings, decoder: Decoder
) -> AuthUser | None:
    """Return the signed-in researcher, or None for anyone else (never fails).

    A missing Cognito configuration is logged and served as public here; researcher-only
    routes surface it as a 500 instead.
    """
    try:
        user = _resolve_user(credentials, settings, decoder)
    except AuthenticationError:
        return None
    except ConfigError as error:
        logger.error("auth not configured, serving public view: %s", error)
        return None
    return user if user.is_researcher else None


Researcher = Annotated[AuthUser, Depends(require_researcher)]
OptionalResearcher = Annotated[AuthUser | None, Depends(optional_researcher)]

# OpenAPI descriptions for routes guarded by `require_researcher`.
RESEARCHER_RESPONSES: dict[int | str, dict[str, str]] = {
    401: {"description": f"{SIGN_IN_REQUIRED} (missing or invalid bearer token)"},
    403: {"description": RESEARCHER_REQUIRED},
}

router = APIRouter(prefix="/api", tags=["auth"])


class MeOut(BaseModel):
    """The signed-in researcher."""

    username: str
    email: str | None
    groups: list[str]


@router.get("/me", response_model=MeOut, responses=RESEARCHER_RESPONSES)
def me(user: Researcher) -> MeOut:
    """Who is signed in (researchers only)."""
    return MeOut(username=user.username, email=user.email, groups=list(user.groups))

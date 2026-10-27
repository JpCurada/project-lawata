"""Auth domain: the signed-in user and the rules a verified Cognito access token must meet.

Signature, issuer and expiry are checked by the `TokenDecoder` adapter; the claim rules that
are specific to Lawata (token use, app client, researcher group) live here and only here.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Protocol

RESEARCHERS_GROUP = "researchers"
ACCESS_TOKEN_USE = "access"
CLOCK_LEEWAY_S = 60
SIGNING_ALGORITHMS = ("RS256",)

# Contract field first; Cognito access tokens carry the same value as `username`.
_USERNAME_CLAIMS = ("cognito:username", "username")


class AuthenticationError(Exception):
    """Raised when a token is missing, malformed, unverifiable or fails a claim rule.

    The message is for logs only; clients always get the same generic 401.
    """


@dataclass(frozen=True)
class CognitoPool:
    """A Cognito user pool and the app client whose access tokens the API accepts."""

    region: str
    user_pool_id: str
    client_id: str

    @property
    def issuer(self) -> str:
        """Expected `iss` claim."""
        return f"https://cognito-idp.{self.region}.amazonaws.com/{self.user_pool_id}"

    @property
    def jwks_url(self) -> str:
        """Public signing keys of the pool."""
        return f"{self.issuer}/.well-known/jwks.json"


@dataclass(frozen=True)
class AuthUser:
    """A signed-in person. `groups` are Cognito groups."""

    username: str
    email: str | None
    groups: tuple[str, ...]

    @property
    def is_researcher(self) -> bool:
        """True if the user may see agent decisions, sampling tasks and reviews."""
        return RESEARCHERS_GROUP in self.groups


# The user every request gets when AUTH_DISABLED=true (local dev and tests only).
DEV_USER = AuthUser(username="dev", email=None, groups=(RESEARCHERS_GROUP,))


class TokenDecoder(Protocol):
    """Port: verify a JWT's signature, issuer and expiry and return its claims."""

    def decode(self, token: str) -> Mapping[str, Any]:
        """Return verified claims or raise `AuthenticationError`."""
        ...


def _username(claims: Mapping[str, Any]) -> str:
    for name in _USERNAME_CLAIMS:
        value = claims.get(name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    raise AuthenticationError("token has no username")


def _groups(claims: Mapping[str, Any]) -> tuple[str, ...]:
    raw = claims.get("cognito:groups", [])
    if not isinstance(raw, list) or not all(isinstance(group, str) for group in raw):
        raise AuthenticationError("cognito:groups is not a list of strings")
    return tuple(raw)


def user_from_claims(claims: Mapping[str, Any], client_id: str) -> AuthUser:
    """Apply Lawata's claim rules to verified claims and build the user.

    Rules: `token_use` is "access" and `client_id` is our app client. Group membership is not
    checked here; see `AuthUser.is_researcher`.

    Raises:
        AuthenticationError: if a rule fails or a claim is malformed.
    """
    if claims.get("token_use") != ACCESS_TOKEN_USE:
        raise AuthenticationError("token_use is not 'access'")
    if claims.get("client_id") != client_id:
        raise AuthenticationError("client_id does not match")
    email = claims.get("email")
    return AuthUser(
        username=_username(claims),
        email=email if isinstance(email, str) and email else None,
        groups=_groups(claims),
    )

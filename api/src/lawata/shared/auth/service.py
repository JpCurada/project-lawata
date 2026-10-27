"""Auth use case: turn a bearer token into a signed-in user."""

from __future__ import annotations

from lawata.shared.auth.domain import AuthUser, TokenDecoder, user_from_claims


def authenticate(decoder: TokenDecoder, token: str, client_id: str) -> AuthUser:
    """Verify `token` and apply the claim rules.

    Raises:
        AuthenticationError: if the token is invalid for any reason.
    """
    return user_from_claims(decoder.decode(token), client_id)

from collections.abc import Callable
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from lawata.shared.auth import service
from lawata.shared.auth.adapters import PyJwtTokenDecoder
from lawata.shared.auth.domain import AuthenticationError, CognitoPool

TokenFactory = Callable[..., str]
YEAR_2100_S = 4_102_444_800


def test_decode_valid_token(
    stub_decoder: PyJwtTokenDecoder, make_token: TokenFactory, test_pool: CognitoPool
) -> None:
    assert stub_decoder.decode(make_token())["cognito:username"] == "ana"
    user = service.authenticate(stub_decoder, make_token(), test_pool.client_id)
    assert user.username == "ana"
    assert user.is_researcher


def test_expired_within_leeway_is_accepted(
    stub_decoder: PyJwtTokenDecoder, make_token: TokenFactory
) -> None:
    assert stub_decoder.decode(make_token(expires_in_s=-30))


@pytest.mark.parametrize(
    "token_args",
    [
        {"expires_in_s": -120},
        {"iss": "https://cognito-idp.us-west-2.amazonaws.com/other-pool"},
        {"iss": None},
        {"exp": None},
        {"nbf": YEAR_2100_S},
    ],
)
def test_decode_rejects(
    stub_decoder: PyJwtTokenDecoder, make_token: TokenFactory, token_args: dict[str, Any]
) -> None:
    with pytest.raises(AuthenticationError):
        stub_decoder.decode(make_token(**token_args))


def test_decode_rejects_token_signed_by_another_key(
    stub_decoder: PyJwtTokenDecoder, make_token: TokenFactory
) -> None:
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with pytest.raises(AuthenticationError):
        stub_decoder.decode(make_token(signing_key=other_key))


def test_decode_rejects_hs256_unsigned_and_garbage(
    stub_decoder: PyJwtTokenDecoder, test_pool: CognitoPool
) -> None:
    claims = {"iss": test_pool.issuer, "exp": YEAR_2100_S}
    hs256 = jwt.encode(claims, "x" * 32, algorithm="HS256")
    unsigned = jwt.encode(claims, "", algorithm="none")
    for token in (hs256, unsigned, "not-a-jwt"):
        with pytest.raises(AuthenticationError):
            stub_decoder.decode(token)


@pytest.mark.parametrize("token_args", [{"client_id": "other-client"}, {"token_use": "id"}])
def test_authenticate_applies_claim_rules(
    stub_decoder: PyJwtTokenDecoder,
    make_token: TokenFactory,
    test_pool: CognitoPool,
    token_args: dict[str, Any],
) -> None:
    with pytest.raises(AuthenticationError):
        service.authenticate(stub_decoder, make_token(**token_args), test_pool.client_id)

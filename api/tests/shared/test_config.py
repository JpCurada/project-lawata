from collections.abc import Iterator

import pytest

from lawata.shared import config
from lawata.shared.config import ConfigError, get_auth_settings, get_settings, load_auth_settings

SECRET_URL = "postgresql://user:s3cr3t-pass@example.neon.tech/db?sslmode=require"
PARAM_NAME = "/lawata/database_url"
ENV_VARS = ("DATABASE_URL", "DATABASE_URL_PARAM", "AWS_REGION", "AWS_DEFAULT_REGION")


@pytest.fixture(autouse=True)
def clean_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    for name in ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _fail_fetch(name: str, region: str) -> str:
    raise AssertionError("SSM must not be called")


def _recording_fetch(calls: list[tuple[str, str]]):
    def fetch(name: str, region: str) -> str:
        calls.append((name, region))
        return SECRET_URL

    return fetch


def test_database_url_read_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", SECRET_URL)
    monkeypatch.setattr(config, "fetch_ssm_parameter", _fail_fetch)
    assert get_settings().require_database_url() == SECRET_URL


def test_database_url_param_routes_to_ssm_fetcher(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, str]] = []
    monkeypatch.setenv("DATABASE_URL_PARAM", PARAM_NAME)
    monkeypatch.setattr(config, "fetch_ssm_parameter", _recording_fetch(calls))
    assert get_settings().require_database_url() == SECRET_URL
    assert calls == [(PARAM_NAME, "us-west-2")]


def test_ssm_region_taken_from_aws_env(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, str]] = []
    monkeypatch.setenv("DATABASE_URL_PARAM", PARAM_NAME)
    monkeypatch.setenv("AWS_REGION", "ap-southeast-1")
    monkeypatch.setattr(config, "fetch_ssm_parameter", _recording_fetch(calls))
    get_settings()
    assert calls == [(PARAM_NAME, "ap-southeast-1")]


def test_get_settings_is_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, str]] = []
    monkeypatch.setenv("DATABASE_URL_PARAM", PARAM_NAME)
    monkeypatch.setattr(config, "fetch_ssm_parameter", _recording_fetch(calls))
    assert get_settings() is get_settings()
    assert len(calls) == 1


def test_both_set_raises_without_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", SECRET_URL)
    monkeypatch.setenv("DATABASE_URL_PARAM", PARAM_NAME)
    monkeypatch.setattr(config, "fetch_ssm_parameter", _fail_fetch)
    with pytest.raises(ConfigError, match="not both") as error:
        get_settings()
    assert "s3cr3t" not in str(error.value)


def test_neither_set_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "fetch_ssm_parameter", _fail_fetch)
    with pytest.raises(ConfigError, match="DATABASE_URL_PARAM"):
        get_settings()


def test_blank_database_url_counts_as_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "  ")
    with pytest.raises(ConfigError):
        get_settings()


def test_secret_hidden_in_repr_and_str(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", SECRET_URL)
    settings = get_settings()
    for text in (repr(settings), str(settings), repr(settings.database_url)):
        assert "s3cr3t" not in text


def test_ssm_secret_hidden_in_repr_and_str(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL_PARAM", PARAM_NAME)
    monkeypatch.setattr(config, "fetch_ssm_parameter", _recording_fetch([]))
    settings = get_settings()
    assert "s3cr3t" not in repr(settings)
    assert "s3cr3t" not in str(settings)


AUTH_ENV_VARS = (
    "AUTH_DISABLED",
    "AWS_LAMBDA_FUNCTION_NAME",
    "COGNITO_REGION",
    "COGNITO_USER_POOL_ID",
    "COGNITO_CLIENT_ID",
)


@pytest.fixture
def clean_auth_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    for name in AUTH_ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    get_auth_settings.cache_clear()
    yield
    get_auth_settings.cache_clear()


@pytest.mark.usefixtures("clean_auth_env")
def test_auth_settings_read_cognito_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("COGNITO_USER_POOL_ID", "us-west-2_abc")
    monkeypatch.setenv("COGNITO_CLIENT_ID", "client-1")
    settings = load_auth_settings()
    assert settings.cognito_region == "us-west-2"
    assert settings.cognito_user_pool_id == "us-west-2_abc"
    assert settings.cognito_client_id == "client-1"
    assert settings.auth_disabled is False


@pytest.mark.usefixtures("clean_auth_env")
def test_auth_disabled_allowed_outside_lambda(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTH_DISABLED", "true")
    assert get_auth_settings().auth_disabled is True


@pytest.mark.usefixtures("clean_auth_env")
def test_auth_disabled_refused_in_lambda(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTH_DISABLED", "true")
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "lawata-api")
    with pytest.raises(ConfigError, match="AUTH_DISABLED=true is refused in AWS Lambda"):
        load_auth_settings()
    with pytest.raises(ConfigError):
        get_auth_settings()


@pytest.mark.usefixtures("clean_auth_env")
def test_auth_enabled_in_lambda_is_fine(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTH_DISABLED", "false")
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "lawata-api")
    assert load_auth_settings().running_in_lambda is True

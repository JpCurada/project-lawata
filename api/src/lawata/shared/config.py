"""Application settings loaded from the environment (and optionally SSM Parameter Store)."""

from __future__ import annotations

from collections.abc import Callable
from functools import lru_cache

from pydantic import AliasChoices, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_AWS_REGION = "us-west-2"

ParameterFetcher = Callable[[str, str], str]


class ConfigError(ValueError):
    """Raised when settings are missing or ambiguous. Never carries secret values."""


class Settings(BaseSettings):
    """Runtime settings. Secrets are `SecretStr` so they never appear in repr or logs."""

    model_config = SettingsConfigDict(extra="ignore", frozen=True)

    database_url: SecretStr | None = None
    database_url_param: str | None = None
    aws_region: str = Field(
        default=DEFAULT_AWS_REGION,
        validation_alias=AliasChoices("AWS_REGION", "AWS_DEFAULT_REGION"),
    )

    @field_validator("database_url", "database_url_param", mode="before")
    @classmethod
    def _blank_is_unset(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    def require_database_url(self) -> str:
        """Return the plain database URL, or raise `ConfigError` if it is not resolved."""
        if self.database_url is None:
            raise ConfigError("DATABASE_URL is not configured")
        return self.database_url.get_secret_value()


def fetch_ssm_parameter(name: str, region: str) -> str:
    """Read a SecureString from SSM Parameter Store with decryption.

    boto3 is imported lazily so cold starts that never touch SSM stay fast.
    """
    import boto3

    client = boto3.client("ssm", region_name=region)
    response = client.get_parameter(Name=name, WithDecryption=True)
    return response["Parameter"]["Value"]


def load_settings(fetch_parameter: ParameterFetcher | None = None) -> Settings:
    """Build settings and resolve the database URL.

    Exactly one of `DATABASE_URL` or `DATABASE_URL_PARAM` must be set; both or neither
    raises `ConfigError`.

    Args:
        fetch_parameter: SSM fetcher `(name, region) -> value`; defaults to
            `fetch_ssm_parameter`.
    """
    settings = Settings()
    has_url = settings.database_url is not None
    param_name = settings.database_url_param
    if has_url and param_name is not None:
        raise ConfigError("Set only one of DATABASE_URL or DATABASE_URL_PARAM, not both")
    if has_url:
        return settings
    if param_name is None:
        raise ConfigError("Set DATABASE_URL or DATABASE_URL_PARAM (SSM parameter name)")

    fetcher = fetch_parameter or fetch_ssm_parameter
    value = fetcher(param_name, settings.aws_region)
    if not value:
        raise ConfigError(f"SSM parameter {param_name!r} is empty")
    return settings.model_copy(update={"database_url": SecretStr(value)})


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return process-wide settings (cached; call `get_settings.cache_clear()` in tests)."""
    return load_settings()


class AuthSettings(BaseSettings):
    """Researcher sign-in settings (Cognito).

    Kept apart from `Settings` so auth never needs the database URL. `AUTH_DISABLED` is for
    local dev and tests only.
    """

    model_config = SettingsConfigDict(extra="ignore", frozen=True)

    cognito_region: str = DEFAULT_AWS_REGION
    cognito_user_pool_id: str | None = None
    cognito_client_id: str | None = None
    auth_disabled: bool = False
    aws_lambda_function_name: str | None = None

    @field_validator(
        "cognito_user_pool_id", "cognito_client_id", "aws_lambda_function_name", mode="before"
    )
    @classmethod
    def _blank_is_unset(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @property
    def running_in_lambda(self) -> bool:
        """True when `AWS_LAMBDA_FUNCTION_NAME` is set (the Lambda runtime sets it)."""
        return self.aws_lambda_function_name is not None


def load_auth_settings() -> AuthSettings:
    """Build auth settings, refusing `AUTH_DISABLED=true` inside AWS Lambda.

    Raises:
        ConfigError: if auth is disabled while `AWS_LAMBDA_FUNCTION_NAME` is set.
    """
    settings = AuthSettings()
    if settings.auth_disabled and settings.running_in_lambda:
        raise ConfigError(
            "AUTH_DISABLED=true is refused in AWS Lambda (AWS_LAMBDA_FUNCTION_NAME is set); "
            "it is for local dev and tests only"
        )
    return settings


@lru_cache(maxsize=1)
def get_auth_settings() -> AuthSettings:
    """Return process-wide auth settings (cached; `get_auth_settings.cache_clear()` in tests)."""
    return load_auth_settings()

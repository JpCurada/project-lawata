"""Short-lived browser links to evidence crops in the S3 bucket (`LAWATA_BUCKET`)."""

import os
from functools import lru_cache
from typing import Any

import boto3
from botocore.config import Config as BotoConfig

# Evidence crop links expire after this long; pages are re-fetched well within it.
EVIDENCE_URL_TTL_S = 3600


class S3EvidenceLinks:
    """Presigns short-lived GET URLs for crops in the evidence bucket."""

    def __init__(self, client: Any, bucket: str, expires_s: int = EVIDENCE_URL_TTL_S) -> None:
        self._client = client
        self._bucket = bucket
        self._expires_s = expires_s

    def url_for(self, uri: str) -> str | None:
        """A presigned URL for `s3://<bucket>/<key>`; None for any other location."""
        prefix = f"s3://{self._bucket}/"
        if not uri.startswith(prefix):
            return None
        return self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._bucket, "Key": uri.removeprefix(prefix)},
            ExpiresIn=self._expires_s,
        )


@lru_cache(maxsize=1)
def evidence_links_from_env() -> S3EvidenceLinks | None:
    """Links for `LAWATA_BUCKET`; None (no images) when it is not set."""
    bucket = os.environ.get("LAWATA_BUCKET")
    if not bucket:
        return None
    return S3EvidenceLinks(boto3.client("s3", config=BotoConfig(signature_version="s3v4")), bucket)

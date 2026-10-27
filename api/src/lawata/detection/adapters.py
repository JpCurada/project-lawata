"""Detection adapters: where evidence crops are saved."""

from typing import Any


class S3CropStore:
    """`CropStore` in the evidence bucket (`crops/{id}.jpg`)."""

    def __init__(self, client: Any, bucket: str) -> None:
        self._client = client
        self._bucket = bucket

    def put(self, key: str, jpeg: bytes) -> str:
        """Upload the JPEG and return its S3 URI."""
        self._client.put_object(Bucket=self._bucket, Key=key, Body=jpeg, ContentType="image/jpeg")
        return f"s3://{self._bucket}/{key}"


class MemoryCropStore:
    """`CropStore` for local runs and tests: keeps crops in a dict."""

    def __init__(self) -> None:
        self.crops: dict[str, bytes] = {}

    def put(self, key: str, jpeg: bytes) -> str:
        """Keep the JPEG in memory."""
        self.crops[key] = jpeg
        return f"memory://{key}"

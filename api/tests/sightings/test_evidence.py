"""Evidence crop links: stored s3:// URI -> presigned URL on the plume detail."""

from collections.abc import Iterator
from dataclasses import replace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from lawata.api.app import app
from lawata.sightings import service
from lawata.sightings.adapters import S3EvidenceLinks
from lawata.sightings.api import get_evidence_links, get_plume_repository

from .conftest import DEFAULT_PLUMES, FakePlumeRepository

BUCKET = "lawata-evidence"
CROP_URI = f"s3://{BUCKET}/crops/plume-3.jpg"


class FakeS3:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def generate_presigned_url(self, operation: str, Params: dict[str, str], ExpiresIn: int) -> str:  # noqa: N803
        self.calls.append({"operation": operation, **Params, "expires": ExpiresIn})
        return f"https://signed.example/{Params['Key']}"


class PrefixLinks:
    def url_for(self, uri: str) -> str | None:
        return f"https://view/{uri}"


@pytest.fixture
def cropped_repository() -> FakePlumeRepository:
    plumes = tuple(
        replace(p, evidence_image_url=CROP_URI) if p.id == 3 else p for p in DEFAULT_PLUMES
    )
    return FakePlumeRepository(plumes)


def test_presigns_keys_in_the_evidence_bucket() -> None:
    s3 = FakeS3()
    url = S3EvidenceLinks(s3, BUCKET, expires_s=60).url_for(CROP_URI)
    assert url == "https://signed.example/crops/plume-3.jpg"
    assert s3.calls == [
        {"operation": "get_object", "Bucket": BUCKET, "Key": "crops/plume-3.jpg", "expires": 60}
    ]


@pytest.mark.parametrize("uri", ["s3://other-bucket/crops/x.jpg", "memory://crops/x.jpg"])
def test_other_locations_get_no_link(uri: str) -> None:
    s3 = FakeS3()
    assert S3EvidenceLinks(s3, BUCKET).url_for(uri) is None
    assert s3.calls == []


def test_view_plume_turns_stored_uri_into_link(cropped_repository: FakePlumeRepository) -> None:
    view = service.view_plume(cropped_repository, 3, "public", PrefixLinks())
    assert view.plume.evidence_image_url == f"https://view/{CROP_URI}"


def test_view_plume_without_links_never_leaks_the_s3_uri(
    cropped_repository: FakePlumeRepository,
) -> None:
    assert service.view_plume(cropped_repository, 3, "public").plume.evidence_image_url is None


def test_view_plume_without_crop_stays_null(cropped_repository: FakePlumeRepository) -> None:
    view = service.view_plume(cropped_repository, 1, "public", PrefixLinks())
    assert view.plume.evidence_image_url is None


@pytest.fixture
def evidence_client(cropped_repository: FakePlumeRepository) -> Iterator[TestClient]:
    app.dependency_overrides[get_plume_repository] = lambda: cropped_repository
    app.dependency_overrides[get_evidence_links] = lambda: S3EvidenceLinks(FakeS3(), BUCKET)
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_detail_returns_presigned_evidence_url(evidence_client: TestClient) -> None:
    body = evidence_client.get("/api/plumes/3").json()
    assert body["evidence_image_url"] == "https://signed.example/crops/plume-3.jpg"

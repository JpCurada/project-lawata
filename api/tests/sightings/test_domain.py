from dataclasses import replace
from datetime import UTC, datetime

import pytest

from lawata.sightings.domain import (
    AgentDecisionSummary,
    PlumeView,
    SamplingTaskStatus,
    plume_status,
)

from .conftest import make_detail

REVIEWED = make_detail(1)
UNREVIEWED = replace(REVIEWED, latest_review=None)


def _decision(action: str) -> AgentDecisionSummary:
    return AgentDecisionSummary(
        action=action, reason="r", created_at=datetime(2026, 1, 1, tzinfo=UTC)
    )


def test_review_wins_over_everything() -> None:
    assert plume_status(replace(REVIEWED, latest_sampling_status="approved")) == "reviewed"


@pytest.mark.parametrize(
    ("task_status", "expected"),
    [
        ("approved", "sampling_approved"),
        ("done", "sampling_approved"),
        ("pending_approval", "sampling_pending"),
        ("rejected", "triaged"),
    ],
)
def test_sampling_task_status_decides(task_status: SamplingTaskStatus, expected: str) -> None:
    assert plume_status(replace(UNREVIEWED, latest_sampling_status=task_status)) == expected


@pytest.mark.parametrize(
    ("action", "expected"),
    [
        ("create_sampling_task", "sampling_pending"),
        ("schedule_recheck", "triaged"),
        ("mark_artifact", "triaged"),
    ],
)
def test_decision_without_task(action: str, expected: str) -> None:
    assert plume_status(replace(UNREVIEWED, latest_decision=_decision(action))) == expected


def test_nothing_yet_is_new() -> None:
    assert plume_status(replace(UNREVIEWED, latest_decision=None)) == "new"


def test_public_view_hides_decision_but_keeps_status() -> None:
    plume = replace(UNREVIEWED, latest_sampling_status="pending_approval")
    public = PlumeView.for_viewer(plume, "public")
    assert public.plume.latest_decision is None
    assert public.status == "sampling_pending"
    researcher = PlumeView.for_viewer(plume, "researcher")
    assert researcher.plume.latest_decision is not None

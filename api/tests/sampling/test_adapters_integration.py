"""Live Neon check, always rolled back. Runs only when DATABASE_URL is set in the environment."""

import os
from collections.abc import Iterator

import psycopg
import pytest

from lawata.sampling import service
from lawata.sampling.adapters import NeonSamplingTaskRepository
from lawata.sampling.domain import (
    InvalidTransitionError,
    NewSamplingTask,
    SamplingStatus,
    SamplingTaskFilters,
    TaskReview,
)

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="DATABASE_URL not set"),
]

REVIEWER = "pytest-rollback"

# The demo seed task, found by its plume's place and date (never a hardcoded id).
_SEED_TASK_SQL = """
SELECT t.task_id, t.status::text
FROM sampling_task t
JOIN plume_event e ON e.event_id = t.event_id
JOIN acquisition a ON a.acquisition_id = e.acquisition_id
JOIN place p ON p.place_id = e.place_id
WHERE p.name ILIKE %s AND a.acquired_date = %s
ORDER BY t.task_id
LIMIT 1
"""


def _seed_task(connection: psycopg.Connection) -> tuple[int, str]:
    row = connection.execute(_SEED_TASK_SQL, ("Binangonan%", "2026-05-06")).fetchone()
    assert row is not None, "seed sampling task for Binangonan 2026-05-06 is missing"
    return row[0], row[1]


@pytest.fixture
def rollback_connection() -> Iterator[psycopg.Connection]:
    """A dedicated non-autocommit connection that is always rolled back, so nothing persists."""
    connection = psycopg.connect(os.environ["DATABASE_URL"], prepare_threshold=None)
    try:
        yield connection
    finally:
        connection.rollback()
        connection.close()


def test_integration_approve_twice_then_rollback_keeps_seed_pending(
    rollback_connection: psycopg.Connection,
) -> None:
    task_id, status = _seed_task(rollback_connection)
    assert status == "pending_approval", "seed must be pending before the test"
    repository = NeonSamplingTaskRepository(connection=rollback_connection)

    detail = service.get_task(repository, task_id)
    assert detail.place is not None and detail.place.startswith("Binangonan")
    assert detail.plume_date is not None and detail.plume_date.isoformat() == "2026-05-06"
    assert detail.sites

    approved = service.approve_task(repository, task_id, TaskReview(REVIEWER, "rollback test"))
    assert approved.status is SamplingStatus.APPROVED
    assert approved.reviewed_by == REVIEWER
    assert approved.reviewed_at is not None
    assert approved.place == detail.place

    with pytest.raises(InvalidTransitionError, match=f"^task {task_id} is approved"):
        service.approve_task(repository, task_id, TaskReview(REVIEWER, "again"))
    # The adapter's compare-and-set guard on its own: a stale expected status updates nothing.
    stale = repository.update_status(
        task_id,
        SamplingStatus.PENDING_APPROVAL,
        SamplingStatus.APPROVED,
        TaskReview(REVIEWER, "stale"),
    )
    assert stale is None

    listed = service.list_tasks(repository, SamplingTaskFilters(SamplingStatus.APPROVED))
    assert task_id in {t.id for t in listed}

    rollback_connection.rollback()
    assert _seed_task(rollback_connection) == (task_id, "pending_approval")


def test_integration_create_is_pending_and_rolled_back(
    rollback_connection: psycopg.Connection,
) -> None:
    task_id, _ = _seed_task(rollback_connection)
    repository = NeonSamplingTaskRepository(connection=rollback_connection)
    event_id = service.get_task(repository, task_id).event_id

    created = service.create_task(
        repository,
        NewSamplingTask(event_id=event_id, decision_id=None, sites=(), requested_reason=REVIEWER),
    )
    assert created.status is SamplingStatus.PENDING_APPROVAL
    assert created.place is not None

    rollback_connection.rollback()
    count = rollback_connection.execute(
        "SELECT count(*) FROM sampling_task WHERE requested_reason = %s", (REVIEWER,)
    ).fetchone()
    assert count == (0,)
    assert service.get_task(repository, task_id).status is SamplingStatus.PENDING_APPROVAL

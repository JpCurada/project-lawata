"""In-memory SamplingTaskRepository and fixtures shared by sampling tests."""

from collections.abc import Callable, Iterator
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from lawata.api.app import app
from lawata.sampling.api import get_sampling_repository
from lawata.sampling.domain import (
    EventNotFoundError,
    NewSamplingTask,
    SamplingSite,
    SamplingStatus,
    SamplingTask,
    SamplingTaskFilters,
    TaskReview,
)

# event_id -> (place, acquisition date), standing in for plume_event/acquisition/place.
PLUMES: dict[int, tuple[str | None, date]] = {
    10: ("Binangonan", date(2026, 5, 6)),
    11: ("Lumban", date(2025, 4, 23)),
    12: (None, date(2026, 6, 1)),
}

SITES = (
    SamplingSite(label="entry_point", lon=121.19, lat=14.46),
    SamplingSite(label="plume_centroid", lon=121.20, lat=14.45),
)


class FakeSamplingTaskRepository:
    """Same semantics as the Neon adapter: compare-and-set status updates, newest first."""

    def __init__(self) -> None:
        self._tasks: dict[int, SamplingTask] = {}
        self._clock = datetime(2026, 5, 7, tzinfo=UTC)
        # Runs just before a status update, to simulate a concurrent writer.
        self.before_update: Callable[[int], None] | None = None

    def _now(self) -> datetime:
        self._clock += timedelta(minutes=1)
        return self._clock

    def create_task(self, new: NewSamplingTask) -> SamplingTask:
        if new.event_id not in PLUMES:
            raise EventNotFoundError(f"plume {new.event_id} not found")
        place, plume_date = PLUMES[new.event_id]
        task = SamplingTask.pending(
            id=len(self._tasks) + 1,
            event_id=new.event_id,
            decision_id=new.decision_id,
            sites=new.sites,
            requested_reason=new.requested_reason,
            created_at=self._now(),
            place=place,
            plume_date=plume_date,
        )
        self._tasks[task.id] = task
        return task

    def list_tasks(self, filters: SamplingTaskFilters) -> list[SamplingTask]:
        tasks = sorted(self._tasks.values(), key=lambda t: (t.created_at, t.id), reverse=True)
        matches = [t for t in tasks if filters.status is None or t.status is filters.status]
        return matches[: filters.limit]

    def get_task(self, task_id: int) -> SamplingTask | None:
        return self._tasks.get(task_id)

    def update_status(
        self,
        task_id: int,
        expected: SamplingStatus,
        target: SamplingStatus,
        review: TaskReview | None,
    ) -> SamplingTask | None:
        if self.before_update is not None:
            self.before_update(task_id)
        task = self._tasks.get(task_id)
        if task is None or task.status is not expected:
            return None
        if review is not None:
            task = replace(
                task,
                reviewed_by=review.reviewer,
                review_note=review.note,
                reviewed_at=self._now(),
            )
        task = replace(task, status=target)
        self._tasks[task_id] = task
        return task

    def force_status(self, task_id: int, status: SamplingStatus) -> None:
        """Test helper: another writer changed the row."""
        task = self._tasks[task_id]
        self._tasks[task_id] = replace(
            task, status=status, reviewed_by="other", reviewed_at=self._now()
        )


def new_task(event_id: int = 10) -> NewSamplingTask:
    return NewSamplingTask(
        event_id=event_id,
        decision_id=None,
        sites=SITES,
        requested_reason="Suspicious, verify: dry-weather plume.",
    )


@pytest.fixture
def repository() -> FakeSamplingTaskRepository:
    repo = FakeSamplingTaskRepository()
    repo.create_task(new_task(10))  # task 1
    repo.create_task(new_task(11))  # task 2
    repo.create_task(new_task(12))  # task 3
    return repo


@pytest.fixture
def client(
    repository: FakeSamplingTaskRepository, researcher_headers: dict[str, str]
) -> Iterator[TestClient]:
    """A client signed in as researcher `ana`."""
    app.dependency_overrides[get_sampling_repository] = lambda: repository
    yield TestClient(app, headers=researcher_headers)
    app.dependency_overrides.clear()


@pytest.fixture
def anonymous_client(repository: FakeSamplingTaskRepository) -> Iterator[TestClient]:
    """A client with no token."""
    app.dependency_overrides[get_sampling_repository] = lambda: repository
    yield TestClient(app)
    app.dependency_overrides.clear()

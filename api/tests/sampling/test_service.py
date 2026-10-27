import inspect

import pytest

from lawata.sampling import service
from lawata.sampling.adapters import NeonSamplingTaskRepository
from lawata.sampling.domain import (
    EventNotFoundError,
    InvalidTransitionError,
    NewSamplingTask,
    SamplingStatus,
    SamplingTask,
    SamplingTaskFilters,
    SamplingTaskNotFoundError,
    SamplingTaskRepository,
    TaskReview,
)

from .conftest import FakeSamplingTaskRepository, new_task

REVIEW = TaskReview(reviewer="ana", note="Boat available Friday")


def test_create_task_is_pending_approval(repository: SamplingTaskRepository) -> None:
    task = service.create_task(repository, new_task(11))
    assert task.status is SamplingStatus.PENDING_APPROVAL
    assert task.reviewed_by is None
    assert task.reviewed_at is None


@pytest.mark.parametrize(
    "creator",
    [
        service.create_task,
        SamplingTask.pending,
        NeonSamplingTaskRepository.create_task,
        FakeSamplingTaskRepository.create_task,
        NewSamplingTask,
    ],
)
def test_creation_paths_take_no_status(creator: object) -> None:
    assert callable(creator)
    assert "status" not in inspect.signature(creator).parameters


def test_create_task_unknown_event_raises(repository: SamplingTaskRepository) -> None:
    with pytest.raises(EventNotFoundError):
        service.create_task(repository, new_task(999))


def test_list_tasks_newest_first(repository: SamplingTaskRepository) -> None:
    assert [t.id for t in service.list_tasks(repository, SamplingTaskFilters())] == [3, 2, 1]


def test_list_tasks_status_filter_and_limit(repository: SamplingTaskRepository) -> None:
    service.approve_task(repository, 1, REVIEW)
    approved = service.list_tasks(repository, SamplingTaskFilters(SamplingStatus.APPROVED))
    assert [t.id for t in approved] == [1]
    pending = SamplingTaskFilters(SamplingStatus.PENDING_APPROVAL, limit=1)
    assert [t.id for t in service.list_tasks(repository, pending)] == [3]


@pytest.mark.parametrize("limit", [0, 201])
def test_list_tasks_rejects_bad_limit(repository: SamplingTaskRepository, limit: int) -> None:
    with pytest.raises(ValueError, match="limit"):
        service.list_tasks(repository, SamplingTaskFilters(limit=limit))


def test_get_task_missing_raises(repository: SamplingTaskRepository) -> None:
    with pytest.raises(SamplingTaskNotFoundError):
        service.get_task(repository, 999)


def test_approve_sets_review_fields(repository: SamplingTaskRepository) -> None:
    task = service.approve_task(repository, 1, REVIEW)
    assert task.status is SamplingStatus.APPROVED
    assert task.reviewed_by == "ana"
    assert task.review_note == "Boat available Friday"
    assert task.reviewed_at is not None


def test_second_approve_is_invalid(repository: SamplingTaskRepository) -> None:
    service.approve_task(repository, 1, REVIEW)
    with pytest.raises(InvalidTransitionError, match="^task 1 is approved; cannot approve$"):
        service.approve_task(repository, 1, REVIEW)


def test_reject_after_approve_is_invalid(repository: SamplingTaskRepository) -> None:
    service.approve_task(repository, 1, REVIEW)
    with pytest.raises(InvalidTransitionError, match="cannot reject"):
        service.reject_task(repository, 1, REVIEW)


def test_reject_then_approve_is_invalid(repository: SamplingTaskRepository) -> None:
    assert service.reject_task(repository, 1, REVIEW).status is SamplingStatus.REJECTED
    with pytest.raises(InvalidTransitionError, match="task 1 is rejected"):
        service.approve_task(repository, 1, REVIEW)


def test_complete_after_approve_keeps_reviewer(repository: SamplingTaskRepository) -> None:
    approved = service.approve_task(repository, 1, REVIEW)
    done = service.complete_task(repository, 1)
    assert done.status is SamplingStatus.DONE
    assert done.reviewed_by == "ana"
    assert done.reviewed_at == approved.reviewed_at


def test_complete_pending_is_invalid(repository: SamplingTaskRepository) -> None:
    with pytest.raises(InvalidTransitionError, match="pending_approval; cannot complete"):
        service.complete_task(repository, 1)


def test_review_unknown_task_raises_not_found(repository: SamplingTaskRepository) -> None:
    with pytest.raises(SamplingTaskNotFoundError):
        service.approve_task(repository, 999, REVIEW)


def test_concurrent_change_between_read_and_write_is_invalid(
    repository: FakeSamplingTaskRepository,
) -> None:
    # Another reviewer approves after our read but before our write: compare-and-set fails.
    repository.before_update = lambda task_id: repository.force_status(
        task_id, SamplingStatus.APPROVED
    )
    with pytest.raises(InvalidTransitionError, match="^task 1 is approved; cannot approve$"):
        service.approve_task(repository, 1, REVIEW)


def test_invalid_transition_carries_status_and_reviewer(
    repository: SamplingTaskRepository,
) -> None:
    service.approve_task(repository, 1, REVIEW)
    with pytest.raises(InvalidTransitionError) as error:
        service.reject_task(repository, 1, TaskReview(reviewer="ben", note="Too late"))
    assert error.value.status is SamplingStatus.APPROVED
    assert error.value.reviewed_by == "ana"

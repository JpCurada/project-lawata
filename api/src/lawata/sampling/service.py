"""Sampling use cases: create (always pending), list, inspect and move tasks through review."""

from __future__ import annotations

from collections.abc import Callable

from lawata.sampling.domain import (
    MAX_TASK_LIMIT,
    InvalidTransitionError,
    NewSamplingTask,
    SamplingTask,
    SamplingTaskFilters,
    SamplingTaskNotFoundError,
    SamplingTaskRepository,
    TaskAction,
    TaskReview,
)

# Signature shared by the human review use cases (approve, reject).
ReviewUseCase = Callable[[SamplingTaskRepository, int, TaskReview], SamplingTask]


def create_task(repository: SamplingTaskRepository, new: NewSamplingTask) -> SamplingTask:
    """Store a new task; it is always `pending_approval` until a human reviews it."""
    return repository.create_task(new)


def list_tasks(
    repository: SamplingTaskRepository, filters: SamplingTaskFilters
) -> list[SamplingTask]:
    """Return tasks matching `filters`, newest first."""
    if not 1 <= filters.limit <= MAX_TASK_LIMIT:
        raise ValueError(f"limit must be between 1 and {MAX_TASK_LIMIT}")
    return repository.list_tasks(filters)


def get_task(repository: SamplingTaskRepository, task_id: int) -> SamplingTask:
    """Return one task or raise `SamplingTaskNotFoundError`."""
    task = repository.get_task(task_id)
    if task is None:
        raise SamplingTaskNotFoundError(f"sampling task {task_id} not found")
    return task


def _transition(
    repository: SamplingTaskRepository,
    task_id: int,
    action: TaskAction,
    review: TaskReview | None,
) -> SamplingTask:
    task = get_task(repository, task_id)
    target = task.next_status(action)
    updated = repository.update_status(task_id, task.status, target, review)
    if updated is not None:
        return updated
    # Someone changed the task between our read and our write; report its status now.
    current = get_task(repository, task_id)
    current.next_status(action)
    raise InvalidTransitionError(
        f"task {task_id} changed concurrently; cannot {action.value}",
        current.status,
        current.reviewed_by,
    )


def approve_task(
    repository: SamplingTaskRepository, task_id: int, review: TaskReview
) -> SamplingTask:
    """Approve a pending task (human only). Raises not-found or `InvalidTransitionError`."""
    return _transition(repository, task_id, TaskAction.APPROVE, review)


def reject_task(
    repository: SamplingTaskRepository, task_id: int, review: TaskReview
) -> SamplingTask:
    """Reject a pending task (human only). Raises not-found or `InvalidTransitionError`."""
    return _transition(repository, task_id, TaskAction.REJECT, review)


def complete_task(repository: SamplingTaskRepository, task_id: int) -> SamplingTask:
    """Mark an approved task done, keeping the approver's review fields."""
    return _transition(repository, task_id, TaskAction.COMPLETE, None)

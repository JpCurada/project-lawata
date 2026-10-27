"""Sampling domain: field-sampling tasks that a human must approve before anyone goes out.

The status state machine lives here and only here (`next_status`). Tasks are only ever
created as `pending_approval` (`SamplingTask.pending`, `NewSamplingTask` has no status).
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

DEFAULT_TASK_LIMIT = 50
MAX_TASK_LIMIT = 200
REVIEW_NOTE_MIN_LENGTH = 3
REVIEW_NOTE_MAX_LENGTH = 500


class SamplingStatus(StrEnum):
    """Task status; values mirror the `sampling_status` database enum."""

    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    REJECTED = "rejected"
    DONE = "done"


class TaskAction(StrEnum):
    """Something a person can do to a task."""

    APPROVE = "approve"
    REJECT = "reject"
    COMPLETE = "complete"


# The single source of truth for status changes. Anything not listed is forbidden; nothing
# leads back to pending_approval, and rejected/done are terminal.
_TRANSITIONS: dict[tuple[SamplingStatus, TaskAction], SamplingStatus] = {
    (SamplingStatus.PENDING_APPROVAL, TaskAction.APPROVE): SamplingStatus.APPROVED,
    (SamplingStatus.PENDING_APPROVAL, TaskAction.REJECT): SamplingStatus.REJECTED,
    (SamplingStatus.APPROVED, TaskAction.COMPLETE): SamplingStatus.DONE,
}


class SamplingTaskNotFoundError(LookupError):
    """Raised when a sampling task id does not exist."""


class EventNotFoundError(LookupError):
    """Raised when a task is requested for a plume event that does not exist."""


class InvalidTransitionError(ValueError):
    """Raised when an action is not allowed from a task's current status.

    Carries the task's current `status` and who last reviewed it, so a client can tell the
    person that someone else already decided.
    """

    def __init__(
        self, message: str, status: SamplingStatus, reviewed_by: str | None = None
    ) -> None:
        super().__init__(message)
        self.status = status
        self.reviewed_by = reviewed_by


def next_status(
    current: SamplingStatus,
    action: TaskAction,
    task_id: int | None = None,
    reviewed_by: str | None = None,
) -> SamplingStatus:
    """Return the status `action` moves a task to from `current`.

    Raises:
        InvalidTransitionError: if the transition is not allowed.
    """
    target = _TRANSITIONS.get((current, action))
    if target is None:
        subject = "task" if task_id is None else f"task {task_id}"
        raise InvalidTransitionError(
            f"{subject} is {current.value}; cannot {action.value}", current, reviewed_by
        )
    return target


@dataclass(frozen=True)
class SamplingSite:
    """A proposed sampling location (WGS84 degrees)."""

    label: str
    lon: float
    lat: float


@dataclass(frozen=True)
class TaskReview:
    """Who reviewed a task and why.

    `reviewer` is the signed-in user's name from the access token, never client input;
    `note` is trimmed and 3-500 chars at the edge.
    """

    reviewer: str
    note: str


@dataclass(frozen=True)
class NewSamplingTask:
    """A request for field sampling. It has no status: every new task is pending approval."""

    event_id: int
    decision_id: int | None
    sites: tuple[SamplingSite, ...]
    requested_reason: str | None


@dataclass(frozen=True)
class SamplingTask:
    """A stored sampling task with its plume's place and acquisition date."""

    id: int
    event_id: int
    decision_id: int | None
    status: SamplingStatus
    sites: tuple[SamplingSite, ...]
    requested_reason: str | None
    reviewed_by: str | None
    review_note: str | None
    created_at: dt.datetime
    reviewed_at: dt.datetime | None
    place: str | None
    plume_date: dt.date | None

    @classmethod
    def pending(
        cls,
        id: int,
        event_id: int,
        decision_id: int | None,
        sites: tuple[SamplingSite, ...],
        requested_reason: str | None,
        created_at: dt.datetime,
        place: str | None,
        plume_date: dt.date | None,
    ) -> SamplingTask:
        """Build a freshly created task; the status is always `pending_approval`."""
        return cls(
            id=id,
            event_id=event_id,
            decision_id=decision_id,
            status=SamplingStatus.PENDING_APPROVAL,
            sites=sites,
            requested_reason=requested_reason,
            reviewed_by=None,
            review_note=None,
            created_at=created_at,
            reviewed_at=None,
            place=place,
            plume_date=plume_date,
        )

    def next_status(self, action: TaskAction) -> SamplingStatus:
        """Return the status `action` moves this task to, or raise `InvalidTransitionError`."""
        return next_status(self.status, action, task_id=self.id, reviewed_by=self.reviewed_by)


@dataclass(frozen=True)
class SamplingTaskFilters:
    """Query filters for task lists."""

    status: SamplingStatus | None = None
    limit: int = DEFAULT_TASK_LIMIT


class SamplingTaskRepository(Protocol):
    """Port for sampling tasks."""

    def create_task(self, new: NewSamplingTask) -> SamplingTask:
        """Store a task as `pending_approval`; raise `EventNotFoundError` for an unknown plume."""
        ...

    def list_tasks(self, filters: SamplingTaskFilters) -> list[SamplingTask]:
        """Return tasks matching `filters`, newest first."""
        ...

    def get_task(self, task_id: int) -> SamplingTask | None:
        """Return one task, or None if it does not exist."""
        ...

    def update_status(
        self,
        task_id: int,
        expected: SamplingStatus,
        target: SamplingStatus,
        review: TaskReview | None,
    ) -> SamplingTask | None:
        """Atomically move a task from `expected` to `target` (compare-and-set).

        With a `review`, also sets reviewed_by, review_note and reviewed_at (now); without
        one those fields are kept. Returns None if no task has `task_id` and `expected`.
        """
        ...

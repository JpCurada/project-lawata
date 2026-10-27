"""Sampling HTTP routes: list and inspect tasks; human approval or rejection.

There is deliberately no route to create a task or mark it done: the agent creates tasks
(always `pending_approval`) and only these human-facing endpoints review them. Every route is
researcher-only; the reviewer's name comes from the access token, never from the body.
"""

from __future__ import annotations

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, StringConstraints, model_validator

from lawata.sampling import service
from lawata.sampling.adapters import NeonSamplingTaskRepository
from lawata.sampling.domain import (
    DEFAULT_TASK_LIMIT,
    MAX_TASK_LIMIT,
    REVIEW_NOTE_MAX_LENGTH,
    REVIEW_NOTE_MIN_LENGTH,
    InvalidTransitionError,
    SamplingStatus,
    SamplingTask,
    SamplingTaskFilters,
    SamplingTaskNotFoundError,
    SamplingTaskRepository,
    TaskReview,
)
from lawata.shared.auth.api import RESEARCHER_RESPONSES, Researcher, require_researcher

router = APIRouter(
    prefix="/api",
    tags=["sampling"],
    dependencies=[Depends(require_researcher)],
    responses=RESEARCHER_RESPONSES,
)

_NOT_FOUND = "Sampling task not found"


class _FromDomain(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class SamplingSiteOut(_FromDomain):
    """A proposed sampling location (WGS84 degrees)."""

    label: str
    lon: float
    lat: float


class SamplingTaskOut(_FromDomain):
    """A field-sampling task with its plume's place and acquisition date."""

    id: int
    event_id: int
    decision_id: int | None
    status: SamplingStatus
    sites: list[SamplingSiteOut]
    requested_reason: str | None
    reviewed_by: str | None
    review_note: str | None
    created_at: dt.datetime
    reviewed_at: dt.datetime | None
    place: str | None
    plume_date: dt.date | None


class TaskReviewIn(BaseModel):
    """A researcher's decision note, trimmed, 3-500 chars. The reviewer comes from the token."""

    model_config = ConfigDict(extra="forbid")

    note: Annotated[
        str,
        StringConstraints(
            strip_whitespace=True,
            min_length=REVIEW_NOTE_MIN_LENGTH,
            max_length=REVIEW_NOTE_MAX_LENGTH,
        ),
    ]

    @model_validator(mode="before")
    @classmethod
    def _ignore_client_reviewer(cls, data: object) -> object:
        # Older clients still send `reviewer`; it is dropped, never trusted.
        if isinstance(data, dict) and "reviewer" in data:
            return {key: value for key, value in data.items() if key != "reviewer"}
        return data


class TaskConflictOut(BaseModel):
    """409 body: the task was already decided (or changed) by someone else."""

    detail: str
    status: SamplingStatus
    reviewed_by: str | None


def get_sampling_repository() -> SamplingTaskRepository:
    """Provide the sampling task repository (overridden in tests)."""
    return NeonSamplingTaskRepository()


Repository = Annotated[SamplingTaskRepository, Depends(get_sampling_repository)]

_REVIEW_RESPONSES: dict[int | str, dict[str, object]] = {
    404: {"description": _NOT_FOUND},
    409: {
        "description": "Transition not allowed from the task's current status",
        "model": TaskConflictOut,
    },
}


def _out(task: SamplingTask) -> SamplingTaskOut:
    return SamplingTaskOut.model_validate(task)


@router.get("/sampling-tasks", response_model=list[SamplingTaskOut])
def list_tasks(
    repository: Repository,
    status: SamplingStatus | None = None,
    limit: Annotated[int, Query(ge=1, le=MAX_TASK_LIMIT)] = DEFAULT_TASK_LIMIT,
) -> list[SamplingTaskOut]:
    """List sampling tasks, newest first, optionally by status."""
    tasks = service.list_tasks(repository, SamplingTaskFilters(status=status, limit=limit))
    return [_out(task) for task in tasks]


@router.get(
    "/sampling-tasks/{task_id}",
    response_model=SamplingTaskOut,
    responses={404: {"description": _NOT_FOUND}},
)
def get_task(task_id: int, repository: Repository) -> SamplingTaskOut:
    """One sampling task."""
    try:
        return _out(service.get_task(repository, task_id))
    except SamplingTaskNotFoundError as error:
        raise HTTPException(status_code=404, detail=_NOT_FOUND) from error


def _review(
    review_task: service.ReviewUseCase,
    repository: SamplingTaskRepository,
    task_id: int,
    body: TaskReviewIn,
    reviewer: str,
) -> SamplingTaskOut | JSONResponse:
    try:
        task = review_task(repository, task_id, TaskReview(reviewer=reviewer, note=body.note))
    except SamplingTaskNotFoundError as error:
        raise HTTPException(status_code=404, detail=_NOT_FOUND) from error
    except InvalidTransitionError as error:
        conflict = TaskConflictOut(
            detail=str(error), status=error.status, reviewed_by=error.reviewed_by
        )
        return JSONResponse(status_code=409, content=conflict.model_dump(mode="json"))
    return _out(task)


@router.post(
    "/sampling-tasks/{task_id}/approve",
    response_model=SamplingTaskOut,
    responses=_REVIEW_RESPONSES,
)
def approve_task(
    task_id: int, body: TaskReviewIn, repository: Repository, user: Researcher
) -> SamplingTaskOut | JSONResponse:
    """Approve a pending task so field sampling can go ahead (signed-in researcher only)."""
    return _review(service.approve_task, repository, task_id, body, user.username)


@router.post(
    "/sampling-tasks/{task_id}/reject",
    response_model=SamplingTaskOut,
    responses=_REVIEW_RESPONSES,
)
def reject_task(
    task_id: int, body: TaskReviewIn, repository: Repository, user: Researcher
) -> SamplingTaskOut | JSONResponse:
    """Reject a pending task (signed-in researcher only)."""
    return _review(service.reject_task, repository, task_id, body, user.username)

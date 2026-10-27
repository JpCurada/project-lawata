"""Neon (Postgres) implementation of the sampling task repository."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any, LiteralString

from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from lawata.sampling.domain import (
    EventNotFoundError,
    NewSamplingTask,
    SamplingSite,
    SamplingStatus,
    SamplingTask,
    SamplingTaskFilters,
    TaskReview,
)
from lawata.shared.db import get_conn

# Applied to a row source aliased `t` with sampling_task columns; adds the plume's place/date.
_TASK_COLUMNS = """
SELECT t.task_id, t.event_id, t.decision_id, t.status::text AS status, t.sites,
       t.requested_reason, t.reviewed_by, t.review_note, t.created_at, t.reviewed_at,
       p.name AS place, a.acquired_date AS plume_date
"""

_PLUME_JOINS = """
LEFT JOIN plume_event e ON e.event_id = t.event_id
LEFT JOIN acquisition a ON a.acquisition_id = e.acquisition_id
LEFT JOIN place p ON p.place_id = e.place_id
"""

_LIST_SQL = (
    _TASK_COLUMNS
    + "FROM sampling_task t"
    + _PLUME_JOINS
    + """
WHERE (%(status)s::text IS NULL OR t.status = %(status)s::sampling_status)
ORDER BY t.created_at DESC, t.task_id DESC
LIMIT %(limit)s
"""
)

_GET_SQL = _TASK_COLUMNS + "FROM sampling_task t" + _PLUME_JOINS + "WHERE t.task_id = %(task_id)s\n"

# Status is a literal, not a parameter: no code path can create a task in another status.
# INSERT ... SELECT from plume_event, so a missing plume inserts nothing (no FK error).
_CREATE_SQL = (
    """
WITH t AS (
    INSERT INTO sampling_task (event_id, decision_id, status, sites, requested_reason)
    SELECT e.event_id, %(decision_id)s, 'pending_approval', %(sites)s, %(requested_reason)s
    FROM plume_event e
    WHERE e.event_id = %(event_id)s
    RETURNING *
)
"""
    + _TASK_COLUMNS
    + "FROM t"
    + _PLUME_JOINS
)

# Compare-and-set: the row changes only if it still has the expected status, so of two
# concurrent approvals the second blocks on the row lock, re-checks the WHERE after the first
# commits, matches nothing and returns no row (-> 409). reviewed_by, review_note and
# reviewed_at are set together (ck_sampling_task_reviewed); without a reviewer they are kept.
_UPDATE_STATUS_SQL = (
    """
WITH t AS (
    UPDATE sampling_task
    SET status = %(target)s::sampling_status,
        reviewed_by = COALESCE(%(reviewer)s::text, reviewed_by),
        review_note = COALESCE(%(note)s::text, review_note),
        reviewed_at = CASE WHEN %(reviewer)s::text IS NULL THEN reviewed_at ELSE now() END
    WHERE task_id = %(task_id)s AND status = %(expected)s::sampling_status
    RETURNING *
)
"""
    + _TASK_COLUMNS
    + "FROM t"
    + _PLUME_JOINS
)


def _to_site(raw: dict[str, Any]) -> SamplingSite:
    return SamplingSite(label=str(raw["label"]), lon=float(raw["lon"]), lat=float(raw["lat"]))


def _to_task(row: dict[str, Any]) -> SamplingTask:
    return SamplingTask(
        id=row["task_id"],
        event_id=row["event_id"],
        decision_id=row["decision_id"],
        status=SamplingStatus(row["status"]),
        sites=tuple(_to_site(site) for site in row["sites"] or ()),
        requested_reason=row["requested_reason"],
        reviewed_by=row["reviewed_by"],
        review_note=row["review_note"],
        created_at=row["created_at"],
        reviewed_at=row["reviewed_at"],
        place=row["place"],
        plume_date=row["plume_date"],
    )


class NeonSamplingTaskRepository:
    """Sampling tasks in Neon.

    By default each call borrows a pooled connection and commits on success. When a
    `connection` is injected, calls run on it and the caller owns commit or rollback.
    """

    def __init__(self, connection: Connection | None = None) -> None:
        self._connection = connection

    @contextmanager
    def _conn(self) -> Iterator[Connection]:
        if self._connection is not None:
            yield self._connection
            return
        with get_conn() as conn:
            yield conn

    def _fetch_one(self, sql: LiteralString, params: dict[str, Any]) -> SamplingTask | None:
        with self._conn() as conn, conn.cursor(row_factory=dict_row) as cursor:
            row = cursor.execute(sql, params).fetchone()
        return None if row is None else _to_task(row)

    def create_task(self, new: NewSamplingTask) -> SamplingTask:
        """Store a task as `pending_approval`; raise `EventNotFoundError` for an unknown plume."""
        params = {
            "event_id": new.event_id,
            "decision_id": new.decision_id,
            "sites": Jsonb([{"label": s.label, "lon": s.lon, "lat": s.lat} for s in new.sites]),
            "requested_reason": new.requested_reason,
        }
        task = self._fetch_one(_CREATE_SQL, params)
        if task is None:
            raise EventNotFoundError(f"plume {new.event_id} not found")
        return task

    def list_tasks(self, filters: SamplingTaskFilters) -> list[SamplingTask]:
        """Return tasks matching `filters`, newest first."""
        params = {
            "status": None if filters.status is None else filters.status.value,
            "limit": filters.limit,
        }
        with self._conn() as conn, conn.cursor(row_factory=dict_row) as cursor:
            rows = cursor.execute(_LIST_SQL, params).fetchall()
        return [_to_task(row) for row in rows]

    def get_task(self, task_id: int) -> SamplingTask | None:
        """Return one task, or None if it does not exist."""
        return self._fetch_one(_GET_SQL, {"task_id": task_id})

    def update_status(
        self,
        task_id: int,
        expected: SamplingStatus,
        target: SamplingStatus,
        review: TaskReview | None,
    ) -> SamplingTask | None:
        """Move a task from `expected` to `target` in one statement; None if it did not match."""
        params = {
            "task_id": task_id,
            "expected": expected.value,
            "target": target.value,
            "reviewer": None if review is None else review.reviewer,
            "note": None if review is None else review.note,
        }
        return self._fetch_one(_UPDATE_STATUS_SQL, params)

"""Neon (Postgres + PostGIS) implementation of the sightings repository."""

from __future__ import annotations

import datetime as dt
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from psycopg import Connection
from psycopg.rows import dict_row

from lawata.shared.db import get_conn
from lawata.shared.storage import S3EvidenceLinks as S3EvidenceLinks
from lawata.sightings.domain import (
    ZONE_UNUSUAL_PCT,
    AgentDecisionSummary,
    NearbyHistory,
    Place,
    PlumeDetail,
    PlumeFilters,
    PlumeNotFoundError,
    PlumeSummary,
    Review,
    ReviewInput,
    ReviewSummary,
)

# `is_dry` is membership in v_dry_weather_plumes, so the view stays the only definition.
# `evidence_image_url` carries the stored crop URI; the service turns it into a viewable link.
_PLUME_SELECT = """
SELECT c.event_id,
       c.place,
       c.province,
       c.acquired_date,
       c.area_ha::float8 AS area_ha,
       c.kind_code,
       c.rain_3d_mm::numeric::float8 AS rain_3d_mm,
       c.rain_7d_mm::numeric::float8 AS rain_7d_mm,
       EXISTS (SELECT 1 FROM v_dry_weather_plumes d WHERE d.event_id = c.event_id) AS is_dry,
       ST_Y(c.entry_geom) AS entry_lat,
       ST_X(c.entry_geom) AS entry_lon,
       lr.verdict AS review_verdict,
       lr.reviewed_at AS review_reviewed_at,
       ad.action::text AS decision_action,
       ad.reason AS decision_reason,
       ad.created_at AS decision_created_at,
       st.status::text AS sampling_status,
       pe.crop_uri AS evidence_image_url
FROM v_plume_event_context c
JOIN plume_event pe ON pe.event_id = c.event_id
LEFT JOIN v_event_latest_review lr ON lr.event_id = c.event_id
LEFT JOIN LATERAL (
    SELECT action, reason, created_at
    FROM agent_decision
    WHERE agent_decision.event_id = c.event_id
    ORDER BY created_at DESC, decision_id DESC
    LIMIT 1
) ad ON true
LEFT JOIN LATERAL (
    SELECT status
    FROM sampling_task
    WHERE sampling_task.event_id = c.event_id
    ORDER BY created_at DESC, task_id DESC
    LIMIT 1
) st ON true
"""

_LIST_SQL = (
    _PLUME_SELECT
    + """
WHERE (%(place)s::text IS NULL OR lower(c.place) = lower(%(place)s::text))
  AND (NOT %(dry_only)s::boolean
       OR c.event_id IN (SELECT event_id FROM v_dry_weather_plumes))
  AND (%(date_from)s::date IS NULL OR c.acquired_date >= %(date_from)s::date)
  AND (%(date_to)s::date IS NULL OR c.acquired_date <= %(date_to)s::date)
ORDER BY c.acquired_date DESC, c.event_id DESC
LIMIT %(limit)s
"""
)

_GET_SQL = _PLUME_SELECT + "WHERE c.event_id = %(plume_id)s\n"

_WITHOUT_CROP_SQL = (
    _PLUME_SELECT
    + """
WHERE pe.crop_uri IS NULL
ORDER BY c.acquired_date DESC, c.event_id DESC
LIMIT %(limit)s
"""
)

_SET_CROP_SQL = "UPDATE plume_event SET crop_uri = %(uri)s WHERE event_id = %(plume_id)s"

_PLACES_SQL = """
SELECT place_id, name, province, ST_Y(geom) AS lat, ST_X(geom) AS lon
FROM place
ORDER BY name, place_id
"""


# Append-only: INSERT ... SELECT from plume_event, so the existence check and the insert are one
# atomic statement (no row inserted means the plume does not exist). reviewed_at uses the column
# default now(); ties within one transaction are broken by review_id, matching the
# `ORDER BY reviewed_at DESC, review_id DESC` in v_event_latest_review.
_ADD_REVIEW_SQL = """
INSERT INTO event_review (event_id, verdict, reason, reviewer)
SELECT e.event_id, %(verdict)s, %(reason)s, %(reviewer)s
FROM plume_event e
WHERE e.event_id = %(plume_id)s
RETURNING review_id, event_id, verdict, reason, reviewer, reviewed_at
"""

# LEFT JOIN from plume_event: no rows means no plume; one row with a NULL review_id means a
# plume without reviews. Same newest-first order as v_event_latest_review.
_LIST_REVIEWS_SQL = """
SELECT e.event_id, r.review_id, r.verdict, r.reason, r.reviewer, r.reviewed_at
FROM plume_event e
LEFT JOIN event_review r ON r.event_id = e.event_id
WHERE e.event_id = %(plume_id)s
ORDER BY r.reviewed_at DESC, r.review_id DESC
"""

# Distances on ::geography so radius_m is in metres. Reviewed artifacts are not history;
# "dry" is membership in v_dry_weather_plumes, as everywhere else.
_NEARBY_HISTORY_SQL = """
SELECT count(*) AS events,
       count(d.event_id) AS dry_events,
       max(c.acquired_date) AS last_seen
FROM v_plume_event_context c
LEFT JOIN v_dry_weather_plumes d ON d.event_id = c.event_id
WHERE c.verdict <> 'artifact'
  AND c.acquired_date < %(before)s
  AND ST_DWithin(
        c.entry_geom::geography,
        ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography,
        %(radius_m)s)
"""

_NEARBY_ZONE_SQL = """
SELECT count(*) AS passes,
       count(*) FILTER (WHERE o.anomaly_pct >= %(unusual_pct)s) AS unusual
FROM watch_zone z
JOIN zone_observation o ON o.zone_id = z.zone_id
WHERE o.acquired_date < %(before)s
  AND ST_DWithin(
        z.geom::geography,
        ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography,
        %(radius_m)s)
"""


def _to_review(row: dict[str, Any]) -> Review:
    return Review(
        id=row["review_id"],
        plume_id=row["event_id"],
        verdict=row["verdict"],
        reason=row["reason"],
        reviewer=row["reviewer"],
        reviewed_at=row["reviewed_at"],
    )


def _to_detail(row: dict[str, Any]) -> PlumeDetail:
    review = None
    if row["review_verdict"] is not None:
        review = ReviewSummary(verdict=row["review_verdict"], reviewed_at=row["review_reviewed_at"])
    decision = None
    if row["decision_action"] is not None:
        decision = AgentDecisionSummary(
            action=row["decision_action"],
            reason=row["decision_reason"],
            created_at=row["decision_created_at"],
        )
    return PlumeDetail(
        id=row["event_id"],
        place=row["place"],
        province=row["province"],
        date=row["acquired_date"],
        area_ha=row["area_ha"],
        kind=row["kind_code"],
        rain_3d_mm=row["rain_3d_mm"],
        rain_7d_mm=row["rain_7d_mm"],
        is_dry=row["is_dry"],
        entry_lat=row["entry_lat"],
        entry_lon=row["entry_lon"],
        latest_review=review,
        latest_decision=decision,
        evidence_image_url=row["evidence_image_url"],
        latest_sampling_status=row["sampling_status"],
    )


class NeonPlumeRepository:
    """Plume history in Neon.

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

    def list_plumes(self, filters: PlumeFilters) -> list[PlumeSummary]:
        """Return plumes matching `filters`, newest first."""
        params = {
            "place": filters.place,
            "dry_only": filters.dry_only,
            "date_from": filters.date_from,
            "date_to": filters.date_to,
            "limit": filters.limit,
        }
        with self._conn() as conn, conn.cursor(row_factory=dict_row) as cursor:
            rows = cursor.execute(_LIST_SQL, params).fetchall()
        return [_to_detail(row).summary() for row in rows]

    def get_plume(self, plume_id: int) -> PlumeDetail | None:
        """Return one plume, or None if it does not exist."""
        with self._conn() as conn, conn.cursor(row_factory=dict_row) as cursor:
            row = cursor.execute(_GET_SQL, {"plume_id": plume_id}).fetchone()
        return None if row is None else _to_detail(row)

    def plumes_without_crop(self, limit: int) -> list[PlumeSummary]:
        """Plumes that have no evidence crop yet, newest first."""
        with self._conn() as conn, conn.cursor(row_factory=dict_row) as cursor:
            rows = cursor.execute(_WITHOUT_CROP_SQL, {"limit": limit}).fetchall()
        return [_to_detail(row).summary() for row in rows]

    def set_crop_uri(self, plume_id: int, uri: str) -> None:
        """Store where the plume's evidence crop lives."""
        with self._conn() as conn:
            conn.execute(_SET_CROP_SQL, {"plume_id": plume_id, "uri": uri})

    def list_places(self) -> list[Place]:
        """Return all places ordered by name."""
        with self._conn() as conn, conn.cursor(row_factory=dict_row) as cursor:
            rows = cursor.execute(_PLACES_SQL).fetchall()
        return [
            Place(
                id=row["place_id"],
                name=row["name"],
                province=row["province"],
                lat=row["lat"],
                lon=row["lon"],
            )
            for row in rows
        ]

    def add_review(self, plume_id: int, review: ReviewInput) -> Review:
        """Append a review; raise `PlumeNotFoundError` if the plume does not exist."""
        params = {
            "plume_id": plume_id,
            "verdict": review.verdict,
            "reason": review.reason,
            "reviewer": review.reviewer,
        }
        with self._conn() as conn, conn.cursor(row_factory=dict_row) as cursor:
            row = cursor.execute(_ADD_REVIEW_SQL, params).fetchone()
        if row is None:
            raise PlumeNotFoundError(f"plume {plume_id} not found")
        return _to_review(row)

    def list_reviews(self, plume_id: int) -> list[Review]:
        """Return a plume's reviews, newest first; raise `PlumeNotFoundError` if missing."""
        with self._conn() as conn, conn.cursor(row_factory=dict_row) as cursor:
            rows = cursor.execute(_LIST_REVIEWS_SQL, {"plume_id": plume_id}).fetchall()
        if not rows:
            raise PlumeNotFoundError(f"plume {plume_id} not found")
        return [_to_review(row) for row in rows if row["review_id"] is not None]

    def nearby_history(
        self, lat: float, lon: float, radius_km: float, before: dt.date
    ) -> NearbyHistory:
        """Count earlier non-artifact plumes whose entry point is within `radius_km`."""
        params = {
            "lat": lat,
            "lon": lon,
            "radius_m": radius_km * 1000,
            "before": before,
            "unusual_pct": ZONE_UNUSUAL_PCT,
        }
        with self._conn() as conn, conn.cursor(row_factory=dict_row) as cursor:
            events = cursor.execute(_NEARBY_HISTORY_SQL, params).fetchone()
            zone = cursor.execute(_NEARBY_ZONE_SQL, params).fetchone()
        assert events is not None and zone is not None  # aggregates always return one row
        return NearbyHistory(
            events["events"],
            events["dry_events"],
            events["last_seen"],
            zone["passes"],
            zone["unusual"],
        )

"""Neon (Postgres) implementation of the read-only stats repository."""

from __future__ import annotations

from psycopg.rows import dict_row

from lawata.shared.db import get_conn
from lawata.stats.domain import DashboardStats

# One statement, so all four numbers come from the same snapshot. Read only.
# - total_plumes counts v_plume_event_context, the same rows GET /api/plumes lists.
# - dry_weather_plumes counts v_dry_weather_plumes, the view behind sightings `is_dry`.
# - 'pending_approval' is the sampling_status enum value for tasks awaiting a human.
# - last_scene_date is the newest usable acquisition day (cloud-free enough to analyse).
_STATS_SQL = """
SELECT (SELECT count(*) FROM v_plume_event_context) AS total_plumes,
       (SELECT count(*) FROM v_dry_weather_plumes) AS dry_weather_plumes,
       (SELECT count(*) FROM sampling_task
         WHERE status = 'pending_approval'::sampling_status) AS pending_sampling_tasks,
       (SELECT max(acquired_date) FROM acquisition WHERE is_usable) AS last_scene_date
"""


class NeonStatsRepository:
    """Dashboard aggregates from Neon; borrows a pooled connection per call."""

    def get_stats(self) -> DashboardStats:
        """Return all headline counts from one query."""
        with get_conn() as conn, conn.cursor(row_factory=dict_row) as cursor:
            row = cursor.execute(_STATS_SQL).fetchone()
        if row is None:
            raise RuntimeError("stats query returned no row")
        return DashboardStats(
            total_plumes=row["total_plumes"],
            dry_weather_plumes=row["dry_weather_plumes"],
            pending_sampling_tasks=row["pending_sampling_tasks"],
            last_scene_date=row["last_scene_date"],
        )

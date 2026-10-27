"""Rebuild the throwaway e2e database: seed + migrations + the "fresh pass" demo state.

Run by e2e/global-setup.ts through the api venv:
    uv run --project ../api python e2e/fixtures/reset_db.py

Reads E2E_DATABASE_URL and refuses anything that is not localhost, so it can never wipe Neon.

Demo state, applied on top of the real seed:
- The seed reviews for the three demo plumes (#26 Pililla, #34 Calamba, #27 Binangonan) are
  removed, so the plumes look freshly detected (no human has looked yet).
- One agent_decision per demo plume is inserted from the grounded replay (real seed rainfall
  and watch-zone history). STAND-IN: nothing in the product writes agent_decision yet; the scan
  Lambda is a stub. Replace with the real persistence step once it exists.
- The seeded sampling task for #27 is linked to its decision.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

import psycopg

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "docs" / "blueprint"))

from grounded_replay import run as grounded_run  # noqa: E402

DEMO_EVENTS = (26, 27, 34)
MODEL_ID = "scripted-mock (grounded replay, e2e fixture)"


def _local_url() -> str:
    url = os.environ.get("E2E_DATABASE_URL", "")
    host = urlparse(url).hostname
    if host not in {"localhost", "127.0.0.1"}:
        sys.exit("E2E_DATABASE_URL must point at a local throwaway Postgres (localhost)")
    return url


def main() -> None:
    """Drop and reload the local e2e schema, then apply the demo state."""
    url = _local_url()
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute("DROP SCHEMA public CASCADE")
        conn.execute("CREATE SCHEMA public")

    env = {**os.environ, "DATABASE_URL": url}
    for script in ("migrate_sqlite_to_postgres.py", "apply_migrations.py"):
        args = [sys.executable, str(ROOT / "db" / script)]
        if script.startswith("migrate"):
            args.append(str(ROOT / "db" / "seed" / "lawata.db"))
        subprocess.run(args, env=env, check=True, capture_output=True)

    # Seed mode: production history SQL on this DB, seed rainfall, proxy inspection (offline).
    os.environ["E2E_DATABASE_URL"] = url
    decisions = {r["event_id"]: r for r in grounded_run("seed", Path("test-results/crops"))}
    with psycopg.connect(url) as conn:
        conn.execute("DELETE FROM event_review WHERE event_id = ANY(%s)", (list(DEMO_EVENTS),))
        for event_id in DEMO_EVENTS:
            d = decisions[event_id]
            decision_id = conn.execute(
                "INSERT INTO agent_decision (event_id, action, reason, trace, model_id) "
                "VALUES (%s, %s, %s, %s, %s) RETURNING decision_id",
                (event_id, d["action"], d["reason"], json.dumps(d["trace"]), MODEL_ID),
            ).fetchone()[0]
            conn.execute(
                "UPDATE sampling_task SET decision_id = %s WHERE event_id = %s",
                (decision_id, event_id),
            )
    print("e2e db ready:", {e: decisions[e]["action"] for e in DEMO_EVENTS})  # noqa: T201


if __name__ == "__main__":
    main()

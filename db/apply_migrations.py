"""Apply db/migrations/*.sql in sorted order, once each.

Usage (from the repo root):
    uv run --project api python db/apply_migrations.py

Reads DATABASE_URL from the environment and never prints it. Each file runs in its own
transaction together with its schema_migrations row, so a failed file leaves no record.
"""

import os
import sys
from contextlib import AbstractContextManager
from pathlib import Path
from typing import Any, Protocol

from lawata.shared.logging import get_logger

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
CREATE_LEDGER_SQL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
"""

logger = get_logger(__name__)


class Connection(Protocol):
    """The slice of a psycopg connection the runner needs."""

    def execute(self, query: Any, params: Any = None, /) -> Any:
        """Run one SQL string, optionally with parameters."""
        ...

    def transaction(self) -> AbstractContextManager[Any]:
        """Open a transaction block."""
        ...


def apply_pending(conn: Connection, migrations_dir: Path = MIGRATIONS_DIR) -> list[str]:
    """Apply every unrecorded migration file in name order.

    Returns:
        Filenames applied during this call (skipped ones are only logged).
    """
    with conn.transaction():
        conn.execute(CREATE_LEDGER_SQL)
    rows = conn.execute("SELECT filename FROM schema_migrations").fetchall()
    already_applied = {row[0] for row in rows}
    applied_now: list[str] = []
    for path in sorted(migrations_dir.glob("*.sql")):
        if path.name in already_applied:
            logger.info("skipped %s", path.name)
            continue
        with conn.transaction():
            conn.execute(path.read_text(encoding="utf-8"))
            conn.execute("INSERT INTO schema_migrations (filename) VALUES (%s)", (path.name,))
        logger.info("applied %s", path.name)
        applied_now.append(path.name)
    return applied_now


def main() -> int:
    """Connect with DATABASE_URL and apply pending migrations."""
    import psycopg

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        logger.error("DATABASE_URL is not set")
        return 1
    with psycopg.connect(database_url, autocommit=True) as conn:
        applied_now = apply_pending(conn)
    logger.info("done: %d applied", len(applied_now))
    return 0


if __name__ == "__main__":
    sys.exit(main())

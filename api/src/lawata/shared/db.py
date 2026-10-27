"""Lazy psycopg 3 connection pool sized for Lambda against Neon's pooled endpoint."""

from __future__ import annotations

import threading
from collections.abc import Iterator
from contextlib import contextmanager

from psycopg import Connection
from psycopg_pool import ConnectionPool

from lawata.shared.config import get_settings

POOL_MIN_SIZE = 0
POOL_MAX_SIZE = 4
POOL_TIMEOUT_S = 10.0
POOL_MAX_IDLE_S = 60.0

_pool: ConnectionPool | None = None
_pool_lock = threading.Lock()


def _get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                # sslmode and other options come from the URL (Neon needs sslmode=require).
                # Neon's pooled endpoint (PgBouncer, transaction mode) cannot keep
                # server-side prepared statements, so disable them.
                _pool = ConnectionPool(
                    conninfo=get_settings().require_database_url(),
                    min_size=POOL_MIN_SIZE,
                    max_size=POOL_MAX_SIZE,
                    timeout=POOL_TIMEOUT_S,
                    max_idle=POOL_MAX_IDLE_S,
                    kwargs={"prepare_threshold": None},
                    open=True,
                )
    return _pool


@contextmanager
def get_conn() -> Iterator[Connection]:
    """Yield a pooled connection; commits on success, rolls back on error."""
    with _get_pool().connection() as conn:
        yield conn


def close_pool() -> None:
    """Close the pool if it was opened (call on shutdown)."""
    global _pool
    with _pool_lock:
        if _pool is not None:
            _pool.close()
            _pool = None

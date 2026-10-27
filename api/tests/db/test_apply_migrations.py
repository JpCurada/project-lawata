import importlib.util
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from types import ModuleType
from typing import Any

RUNNER_PATH = Path(__file__).resolve().parents[3] / "db" / "apply_migrations.py"


def _load_runner() -> ModuleType:
    spec = importlib.util.spec_from_file_location("apply_migrations", RUNNER_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _Result:
    def __init__(self, rows: list[tuple[Any, ...]]) -> None:
        self._rows = rows

    def fetchall(self) -> list[tuple[Any, ...]]:
        return self._rows


class FakeConnection:
    def __init__(self, recorded: set[str]) -> None:
        self.recorded = set(recorded)
        self.executed: list[str] = []
        self.transactions = 0

    def execute(self, query: Any, params: Any = None, /) -> _Result:
        if query.startswith("SELECT filename"):
            return _Result([(name,) for name in sorted(self.recorded)])
        if query.startswith("INSERT INTO schema_migrations"):
            self.recorded.add(params[0])
        else:
            self.executed.append(query)
        return _Result([])

    @contextmanager
    def transaction(self) -> Iterator[None]:
        self.transactions += 1
        yield


def _write(directory: Path, name: str) -> None:
    (directory / name).write_text(f"-- {name}", encoding="utf-8")


def test_apply_pending_runs_files_in_name_order_and_skips_recorded(tmp_path: Path) -> None:
    runner = _load_runner()
    for name in ["003_c.sql", "001_a.sql", "002_b.sql", "notes.txt"]:
        _write(tmp_path, name)
    conn = FakeConnection(recorded={"002_b.sql"})

    applied = runner.apply_pending(conn, tmp_path)

    assert applied == ["001_a.sql", "003_c.sql"]
    assert conn.executed[1:] == ["-- 001_a.sql", "-- 003_c.sql"]
    assert conn.recorded == {"001_a.sql", "002_b.sql", "003_c.sql"}
    assert conn.transactions == 3  # ledger + one per applied file


def test_apply_pending_applies_nothing_when_all_recorded(tmp_path: Path) -> None:
    runner = _load_runner()
    _write(tmp_path, "001_a.sql")
    conn = FakeConnection(recorded={"001_a.sql"})

    assert runner.apply_pending(conn, tmp_path) == []
    assert len(conn.executed) == 1  # only the ledger CREATE TABLE IF NOT EXISTS

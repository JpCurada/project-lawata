"""StacCogReader item choice with a fake STAC client; the SCL read is stubbed (no network)."""

from datetime import UTC, date, datetime
from typing import Any

import pytest

from lawata.imagery.adapters import StacCogReader
from lawata.imagery.domain import PassCloud, SceneNotFoundError


class FakeItem:
    def __init__(self, item_id: str, day: date, tile_cloud_pct: float) -> None:
        self.id = item_id
        self.datetime = datetime(day.year, day.month, day.day, 2, 30, tzinfo=UTC)
        self.properties = {"eo:cloud_cover": tile_cloud_pct}


class FakeSearch:
    def __init__(self, items: list[FakeItem]) -> None:
        self._items = items

    def items(self) -> list[FakeItem]:
        return self._items


class FakeStac:
    def __init__(self, items: list[FakeItem]) -> None:
        self.items = items
        self.searches: list[dict[str, Any]] = []

    def search(self, **kwargs: Any) -> FakeSearch:
        self.searches.append(kwargs)
        return FakeSearch(self.items)


def _reader(
    items: list[FakeItem], local: dict[str, float | None], stac: FakeStac | None = None
) -> tuple[StacCogReader, list[str]]:
    reader = StacCogReader(stac or FakeStac(items))
    scored: list[str] = []

    def fake_cloud(item: Any, lat: float, lon: float) -> float | None:
        scored.append(item.id)
        return local[item.id]

    reader._item_cloud_frac = fake_cloud  # type: ignore[method-assign]
    return reader, scored


def test_best_item_of_a_day_has_the_least_local_cloud() -> None:
    day = date(2026, 10, 18)
    items = [FakeItem("tile-a", day, 5.0), FakeItem("tile-b", day, 40.0)]
    reader, _ = _reader(items, {"tile-a": 0.9, "tile-b": 0.05})
    assert reader._best_item(14.345, 121.15, day).id == "tile-b"


def test_single_item_is_used_without_reading_cloud() -> None:
    day = date(2026, 10, 18)
    reader, scored = _reader([FakeItem("only", day, 5.0)], {})
    assert reader._best_item(14.345, 121.15, day).id == "only"
    assert scored == []


def test_no_item_raises() -> None:
    reader, _ = _reader([], {})
    with pytest.raises(SceneNotFoundError):
        reader._best_item(14.345, 121.15, date(2026, 10, 18))


def test_passes_come_newest_first_and_are_read_lazily() -> None:
    items = [
        FakeItem("old", date(2026, 10, 15), 30.0),
        FakeItem("new", date(2026, 10, 18), 20.0),
    ]
    stac = FakeStac(items)
    reader, scored = _reader(items, {"new": 1.0, "old": 0.0}, stac)
    passes = reader.pass_clouds(14.345, 121.15, date(2026, 10, 25), 30, 60.0)
    assert next(iter(passes)) == PassCloud(date(2026, 10, 18), "new", 1.0)
    assert scored == ["new"]  # the older pass is not read until asked for
    assert stac.searches[0]["query"] == {"eo:cloud_cover": {"lt": 60.0}}  # tile pre-filter

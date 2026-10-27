"""Tool schemas shown to the model and the in-process handlers behind them."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from typing import Any

from lawata.agent.domain import Candidate
from lawata.detection.domain import CropStore
from lawata.detection.service import inspect_candidate
from lawata.imagery.domain import SceneReader
from lawata.sightings.domain import HistorySource
from lawata.sightings.service import nearby_history
from lawata.weather.domain import RainfallSource
from lawata.weather.service import summarize_rain

Handler = Callable[..., dict[str, Any]]


def _spec(name: str, description: str, props: dict[str, str]) -> dict[str, Any]:
    schema = {
        "type": "object",
        "properties": {k: {"type": v} for k, v in props.items()},
        "required": list(props),
    }
    return {"toolSpec": {"name": name, "description": description, "inputSchema": {"json": schema}}}


TOOL_SPECS: list[dict[str, Any]] = [
    _spec(
        "inspect_plume",
        "Re-read the plume at 10 m with OpenCV and return cloud edge, glint, texture, shape "
        "and shore contact. You also get the 10 m crop as an image.",
        {"id": "string"},
    ),
    _spec(
        "get_rainfall",
        "Rain in mm over 3 and 7 days up to the date (YYYY-MM-DD).",
        {"lat": "number", "lon": "number", "date": "string"},
    ),
    _spec(
        "get_history",
        "Earlier plumes within 1 km of this point (dry-weather ones too), and clear passes "
        "over a nearby watch zone that showed unusual water.",
        {"lat": "number", "lon": "number"},
    ),
    _spec("mark_artifact", "End: not a real plume (cloud, glint, haze).", {"reason": "string"}),
    _spec("log_expected", "End: explained by rain or a known source.", {"reason": "string"}),
    _spec("schedule_recheck", "End: unclear, look again on the next pass.", {"reason": "string"}),
    _spec(
        "create_sampling_task",
        "End: propose field sampling; a human must approve.",
        {"reason": "string"},
    ),
]


@dataclass(frozen=True)
class ToolPorts:
    """What the tools read from; the composition root supplies the adapters."""

    scenes: SceneReader
    crops: CropStore
    rainfall: RainfallSource
    history: HistorySource


def build_handlers(
    candidate: Candidate, ports: ToolPorts, images: dict[str, bytes]
) -> dict[str, Handler]:
    """Wire tool names to feature services for one candidate.

    `inspect_plume` stores its crop in `images` (keyed by the `crop` URI in its result)
    so the model adapter can show the picture to the model on the next turn.
    """
    acquired = date.fromisoformat(candidate.acquired_date)

    def inspect_plume(**_: Any) -> dict[str, Any]:
        crop = inspect_candidate(
            ports.scenes,
            ports.crops,
            candidate.candidate_id,
            candidate.lat,
            candidate.lon,
            acquired,
        )
        images[crop.crop_uri] = crop.jpeg
        return crop.inspection.as_tool_result() | {"crop": crop.crop_uri}

    def get_rainfall(lat: float, lon: float, date: str) -> dict[str, Any]:
        rain = summarize_rain(ports.rainfall, lat, lon, _parse_date(date))
        return {
            "rain_3d_mm": round(rain.rain_3d_mm, 1),
            "rain_7d_mm": round(rain.rain_7d_mm, 1),
            "is_dry": rain.is_dry,
        }

    def get_history(lat: float, lon: float) -> dict[str, Any]:
        found = nearby_history(ports.history, lat, lon, before=acquired)
        last_seen = found.last_seen.isoformat() if found.last_seen else None
        return {
            "events": found.events,
            "dry_events": found.dry_events,
            "last_seen": last_seen,
            "zone_passes": found.zone_passes,
            "zone_unusual_passes": found.zone_unusual_passes,
        }

    return {
        "inspect_plume": inspect_plume,
        "get_rainfall": get_rainfall,
        "get_history": get_history,
    }


def _parse_date(value: str) -> date:
    return date.fromisoformat(value[:10])

"""Analysis use case: turn a drawn box into an agent candidate and investigate it."""

from collections.abc import Callable
from datetime import date
from typing import Any

from lawata.agent.domain import Candidate
from lawata.analysis.domain import (
    BOX_IMAGE_MIN_RES_M,
    LOOKBACK_DAYS,
    MAX_SCENE_CLOUD_PCT,
    MIN_BOX_IMAGE_HALF_KM,
    AgentRuntime,
    AreaAnalysis,
    AreaBox,
    BoxImagery,
    CropKind,
    CropLinks,
    SceneCatalog,
    is_clear,
)
from lawata.detection.domain import CROP_MAX_PX
from lawata.detection.service import encode_crop
from lawata.imagery.service import true_color_bgr
from lawata.shared.logging import get_logger

logger = get_logger(__name__)


def analyze_area(
    box: AreaBox,
    on: date | None,
    today: date,
    catalog: SceneCatalog,
    runtime: AgentRuntime,
    new_id: Callable[[], str],
    links: CropLinks | None = None,
    box_imagery: BoxImagery | None = None,
) -> AreaAnalysis:
    """Investigate the box center with the agent on `on`, or on the latest clear pass.

    Without a pass that is clear over the box in the last `LOOKBACK_DAYS` the model is
    never called. The result
    links the agent's 10 m crop, or else a plain true-color image of the box (see
    `evidence_image`).
    """
    box.validate()
    lat, lon = box.center
    candidate_id = f"area-{new_id()}"
    acquired = on or latest_clear_date(catalog, lat, lon, today)
    if acquired is None:
        return AreaAnalysis("no_clear_pass", candidate_id, lat, lon)

    candidate = Candidate(
        candidate_id=candidate_id,
        place="Selected area",
        lat=round(lat, 5),
        lon=round(lon, 5),
        acquired_date=acquired.isoformat(),
        area_ha=round(box.area_ha, 1),
    )
    decision = runtime.investigate(candidate)
    trace = list(decision.get("trace", []))
    crop_url, crop_kind = evidence_image(box, acquired, candidate_id, trace, links, box_imagery)
    return AreaAnalysis(
        status="investigated",
        candidate_id=candidate_id,
        lat=lat,
        lon=lon,
        acquired_date=acquired,
        action=decision.get("action"),
        decision_status=decision.get("status"),
        reason=decision.get("reason"),
        trace=trace,
        crop_url=crop_url,
        crop_kind=crop_kind,
        model=decision.get("model"),
    )


def latest_clear_date(catalog: SceneCatalog, lat: float, lon: float, today: date) -> date | None:
    """Newest pass in the lookback whose cloud over the box is low (`is_clear`).

    Tile cloud cover only pre-filters: a tile can be mostly clear while the box is under cirrus.
    """
    passes = catalog.pass_clouds(lat, lon, today, LOOKBACK_DAYS, MAX_SCENE_CLOUD_PCT)
    return next((found.acquired for found in passes if is_clear(found)), None)


def evidence_image(
    box: AreaBox,
    acquired: date,
    candidate_id: str,
    trace: list[dict[str, Any]],
    links: CropLinks | None,
    box_imagery: BoxImagery | None,
) -> tuple[str | None, CropKind | None]:
    """A viewable link to the agent's crop, else to a freshly rendered image of the box.

    The box image is a convenience: when it cannot be read or stored, the decision still
    goes back without a picture.
    """
    if links is None:
        return None, None
    agent_crop = latest_crop(trace)
    if agent_crop and (url := links.url_for(agent_crop)):
        return url, "inspection"
    if box_imagery is None:
        return None, None
    try:
        uri = render_box_image(box, acquired, candidate_id, box_imagery)
    except Exception as error:  # noqa: BLE001 - STAC/COG/S3 failure must not lose the decision
        logger.warning("box image for %s failed: %s", candidate_id, type(error).__name__)
        return None, None
    url = links.url_for(uri)
    return (url, "box") if url else (None, None)


def render_box_image(box: AreaBox, acquired: date, candidate_id: str, ports: BoxImagery) -> str:
    """Read one true-color window over the box, save it as a JPEG and return its URI.

    The window is square around the center, covers the longer side and is at most
    `CROP_MAX_PX` pixels across (10 m pixels for boxes up to ~5 km).
    """
    lat, lon = box.center
    half_km = max(max(box.width_km, box.height_km) / 2, MIN_BOX_IMAGE_HALF_KM)
    res_m = max(BOX_IMAGE_MIN_RES_M, 2 * half_km * 1000 / CROP_MAX_PX)
    window = ports.scenes.read_window(lat, lon, acquired, half_km, res_m)
    jpeg = encode_crop(true_color_bgr(window))
    return ports.store.put(f"crops/{candidate_id}-box.jpg", jpeg)


def latest_crop(trace: list[dict[str, Any]]) -> str | None:
    """Where the last `inspect_plume` stored the 10 m crop the agent looked at."""
    for step in reversed(trace):
        result = step.get("result")
        if step.get("tool") == "inspect_plume" and isinstance(result, dict) and result.get("crop"):
            return str(result["crop"])
    return None

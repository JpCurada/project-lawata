"""Analysis HTTP route: a researcher draws a box on the map and the agent investigates it.

Researcher-only because every request may call the model. The call is synchronous (the agent
finishes in well under a minute) and nothing is stored: the decision goes back to the page.
"""

from __future__ import annotations

import datetime as dt
import os
import uuid
from typing import Annotated, Any

import boto3
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from lawata.analysis import service
from lawata.analysis.adapters import AgentCoreRuntime
from lawata.analysis.domain import (
    AgentRuntime,
    AnalysisStatus,
    AreaBox,
    BoxImagery,
    CropKind,
    CropLinks,
    InvalidAreaError,
    SceneCatalog,
)
from lawata.shared.auth.api import RESEARCHER_RESPONSES, require_researcher
from lawata.shared.logging import get_logger
from lawata.shared.storage import evidence_links_from_env

logger = get_logger(__name__)

router = APIRouter(
    prefix="/api",
    tags=["analysis"],
    dependencies=[Depends(require_researcher)],
    responses=RESEARCHER_RESPONSES,
)


def get_scene_catalog() -> SceneCatalog:
    """Scene catalog; `lawata.api.app` wires `StacCogReader` (features may not build it)."""
    raise HTTPException(status_code=503, detail="Area analysis is not set up here.")


def get_agent_runtime() -> AgentRuntime:
    """Production agent runtime (tests override this)."""
    runtime_arn = os.environ.get("AGENT_RUNTIME_ARN")
    if not runtime_arn:
        raise HTTPException(status_code=503, detail="Area analysis is not set up here.")
    return AgentCoreRuntime(boto3.client("bedrock-agentcore"), runtime_arn)


def get_crop_links() -> CropLinks | None:
    """Short-lived links to crops in the evidence bucket; None when no bucket is set."""
    return evidence_links_from_env()


def get_box_imagery() -> BoxImagery | None:
    """Scene reader and crop store for the plain box image; None draws no box image.

    `lawata.api.app` (the composition root) wires the real adapters, because features may not
    import `lawata.imagery.adapters`.
    """
    return None


class AreaIn(BaseModel):
    """A box in WGS84 degrees; `date` defaults to the latest clear pass in the last 30 days."""

    model_config = ConfigDict(extra="forbid")

    west: float
    south: float
    east: float
    north: float
    date: dt.date | None = None


class AnalysisOut(BaseModel):
    """The agent's decision for the box center, or why it did not run."""

    status: AnalysisStatus
    candidate_id: str
    lat: float
    lon: float
    acquired_date: dt.date | None
    action: str | None
    decision_status: str | None
    reason: str | None
    trace: list[dict[str, Any]]
    crop_url: str | None = Field(
        description=(
            "Short-lived link to a Sentinel-2 image of the box: the agent's 10 m crop when it "
            "inspected one, else a plain true-color image of the box on the same pass."
        )
    )
    crop_kind: CropKind | None = Field(
        description=(
            "'inspection': the agent's crop (red = plume, yellow = cloud buffer, white cross = "
            "box center); 'box': plain true-color image without outlines; null: no image."
        )
    )
    model: str | None = Field(
        default=None, description="Bedrock model id the agent ran on; null if not reported."
    )


@router.post("/analyses", response_model=AnalysisOut)
def analyze_area(
    body: AreaIn,
    catalog: Annotated[SceneCatalog, Depends(get_scene_catalog)],
    runtime: Annotated[AgentRuntime, Depends(get_agent_runtime)],
    links: Annotated[CropLinks | None, Depends(get_crop_links)],
    box_imagery: Annotated[BoxImagery | None, Depends(get_box_imagery)],
) -> AnalysisOut:
    """Investigate a drawn box with the agent (can take up to a minute).

    Without a `date`, the newest pass in the last 30 days that is clear over the box is used.
    """
    today = dt.datetime.now(dt.UTC).date()
    if body.date is not None and body.date > today:
        raise HTTPException(status_code=422, detail="Pick a date that is not in the future.")
    box = AreaBox(body.west, body.south, body.east, body.north)
    try:
        result = service.analyze_area(
            box,
            body.date,
            today,
            catalog,
            runtime,
            lambda: uuid.uuid4().hex[:8],
            links=links,
            box_imagery=box_imagery,
        )
    except InvalidAreaError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:  # noqa: BLE001 - STAC or runtime failure; details go to logs
        logger.exception("area analysis failed")
        raise HTTPException(
            status_code=502, detail="The agent could not finish. Try again in a minute."
        ) from error
    return AnalysisOut(
        status=result.status,
        candidate_id=result.candidate_id,
        lat=result.lat,
        lon=result.lon,
        acquired_date=result.acquired_date,
        action=result.action,
        decision_status=result.decision_status,
        reason=result.reason,
        trace=result.trace,
        crop_url=result.crop_url,
        crop_kind=result.crop_kind,
        model=result.model,
    )

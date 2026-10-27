"""FastAPI app (composition root). Served on Lambda through Mangum."""

import os
from importlib.metadata import PackageNotFoundError, version

import boto3
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum
from pydantic import BaseModel

from lawata.analysis.api import get_box_imagery, get_scene_catalog
from lawata.analysis.api import router as analysis_router
from lawata.analysis.domain import BoxImagery
from lawata.detection.adapters import S3CropStore
from lawata.imagery.adapters import StacCogReader
from lawata.sampling.api import router as sampling_router
from lawata.shared.auth.api import router as auth_router
from lawata.shared.config import get_auth_settings
from lawata.sightings.api import router as sightings_router
from lawata.stats.api import router as stats_router

# In production the web app is served same-origin through CloudFront, so CORS only matters
# for the Vite dev server. Never widen this to "*".
CORS_ALLOWED_ORIGINS = ["http://localhost:5173"]
CORS_ALLOWED_METHODS = ["GET", "POST"]
CORS_ALLOWED_HEADERS = ["content-type", "authorization"]

OPENAPI_TAGS = [
    {"name": "health", "description": "Liveness check used after deploys."},
    {"name": "auth", "description": "The signed-in researcher (Cognito access token)."},
    {"name": "sightings", "description": "Plume history, details, human reviews and places."},
    {"name": "sampling", "description": "Field-sampling tasks and their human approval."},
    {"name": "stats", "description": "Headline counts for the dashboard."},
    {"name": "analysis", "description": "Agent investigation of a box a researcher draws."},
]

# Fail at cold start, not on first request, if AUTH_DISABLED=true is set inside Lambda.
get_auth_settings()


def _app_version() -> str:
    """Installed package version; the Lambda image copies the source without installing it."""
    try:
        return version("lawata")
    except PackageNotFoundError:
        return "unknown"


app = FastAPI(
    title="Lawata API",
    version=_app_version(),
    description=(
        "Satellite triage for water pollution around Laguna de Bay. Sentinel-2 plume "
        "detections are checked against rainfall; dry-weather plumes are flagged as "
        "'Suspicious, verify' and may lead to field sampling, which a human must approve."
    ),
    openapi_tags=OPENAPI_TAGS,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_methods=CORS_ALLOWED_METHODS,
    allow_headers=CORS_ALLOWED_HEADERS,
)
app.include_router(auth_router)
app.include_router(sightings_router)
app.include_router(sampling_router)
app.include_router(stats_router)
app.include_router(analysis_router)


def box_imagery_from_env() -> BoxImagery | None:
    """Real adapters for the analysis box image; None when `LAWATA_BUCKET` is not set."""
    bucket = os.environ.get("LAWATA_BUCKET")
    if not bucket:
        return None
    return BoxImagery(StacCogReader(), S3CropStore(boto3.client("s3"), bucket))


# Wiring, not a test override: features may not build `lawata.imagery.adapters` themselves.
app.dependency_overrides[get_scene_catalog] = StacCogReader
app.dependency_overrides[get_box_imagery] = box_imagery_from_env


class HealthOut(BaseModel):
    """Liveness status."""

    status: str


@app.get("/api/health", response_model=HealthOut, tags=["health"])
def health() -> HealthOut:
    """Liveness check used after deploys."""
    return HealthOut(status="ok")


handler = Mangum(app)

"""AgentCore Runtime entrypoint and composition root: one invocation = one candidate.

The only place outside `lawata.api` that builds adapters (import-linter keeps feature
packages away from `lawata.imagery.adapters`). Deployed as an ARM64 container
(Dockerfile.agent). Locally: python -m lawata.entrypoints.agent_runtime
"""

import os
from typing import Any

import boto3
from bedrock_agentcore.runtime import BedrockAgentCoreApp

from lawata.agent.adapters import BedrockConverseModel, LocalToolBox
from lawata.agent.domain import Candidate
from lawata.agent.service import run_candidate
from lawata.agent.tool_specs import TOOL_SPECS, ToolPorts, build_handlers
from lawata.detection.adapters import MemoryCropStore, S3CropStore
from lawata.detection.domain import CropStore
from lawata.imagery.adapters import StacCogReader
from lawata.sightings.adapters import NeonPlumeRepository
from lawata.weather.adapters import OpenMeteoRainfall

app = BedrockAgentCoreApp()


def _crop_store() -> CropStore:
    bucket = os.environ.get("LAWATA_BUCKET")
    return S3CropStore(boto3.client("s3"), bucket) if bucket else MemoryCropStore()


def tool_ports() -> ToolPorts:
    """Production adapters for the agent's tools."""
    return ToolPorts(
        scenes=StacCogReader(),
        crops=_crop_store(),
        rainfall=OpenMeteoRainfall(),
        history=NeonPlumeRepository(),
    )


@app.entrypoint
def invoke(payload: dict[str, Any]) -> dict[str, Any]:
    """Investigate one candidate and return the decision."""
    candidate = Candidate(**payload["candidate"])
    images: dict[str, bytes] = {}
    model_id = os.environ["BEDROCK_MODEL_ID"]
    model = BedrockConverseModel(boto3.client("bedrock-runtime"), model_id, TOOL_SPECS, images)
    tools = LocalToolBox(build_handlers(candidate, tool_ports(), images))
    decision = run_candidate(candidate, model, tools)
    return {
        "action": decision.action.value,
        "status": decision.status,
        "reason": decision.reason,
        "trace": decision.trace,
        "model": model_id,
    }


if __name__ == "__main__":
    app.run()

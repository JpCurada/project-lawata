"""Scan Lambda entry point: detect candidates, then hand each to the agent runtime."""

import os
from typing import Any

MAX_CANDIDATES_PER_RUN = int(os.environ.get("MAX_CANDIDATES_PER_RUN", "10"))


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Run one scan.

    TODO: find a new clear scene, run detection, rank candidates (dry weather first),
    keep the top MAX_CANDIDATES_PER_RUN, then for each one call
    bedrock-agentcore `invoke_agent_runtime` and `stop_runtime_session` right after.
    """
    return {"scanned": False, "reason": "not implemented yet", "max": MAX_CANDIDATES_PER_RUN}

"""Analysis adapters: the agent on AgentCore Runtime (passes come from `StacCogReader`)."""

import json
import uuid
from dataclasses import asdict
from typing import Any

from lawata.agent.domain import Candidate
from lawata.shared.logging import get_logger

logger = get_logger(__name__)


class AgentCoreRuntime:
    """`AgentRuntime` that invokes the deployed runtime and stops the session right after."""

    def __init__(self, client: Any, runtime_arn: str) -> None:
        self._client = client
        self._runtime_arn = runtime_arn

    def investigate(self, candidate: Candidate) -> dict[str, Any]:
        """One invocation = one candidate (see lawata.entrypoints.agent_runtime)."""
        # Session ids must be at least 33 characters.
        session_id = f"lawata-{candidate.candidate_id}-{uuid.uuid4().hex}"
        try:
            response = self._client.invoke_agent_runtime(
                agentRuntimeArn=self._runtime_arn,
                runtimeSessionId=session_id,
                contentType="application/json",
                accept="application/json",
                payload=json.dumps({"candidate": asdict(candidate)}).encode(),
            )
            return json.loads(response["response"].read())
        finally:
            self._stop(session_id)

    def _stop(self, session_id: str) -> None:
        try:
            self._client.stop_runtime_session(
                agentRuntimeArn=self._runtime_arn, runtimeSessionId=session_id
            )
        except Exception as error:  # noqa: BLE001 - the session idles out anyway
            logger.warning("could not stop runtime session: %s", type(error).__name__)

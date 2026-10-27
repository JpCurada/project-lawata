import contextlib
import io
import json
from typing import Any

from lawata.agent.domain import Candidate
from lawata.analysis.adapters import AgentCoreRuntime

CANDIDATE = Candidate("area-abc12345", "Selected area", 14.5, 121.145, "2026-10-20", 123.4)


class FakeAgentCore:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def invoke_agent_runtime(self, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(("invoke", kwargs))
        if self.fail:
            raise RuntimeError("throttled")
        return {"response": io.BytesIO(b'{"action": "schedule_recheck"}')}

    def stop_runtime_session(self, **kwargs: Any) -> None:
        self.calls.append(("stop", kwargs))


def test_invokes_with_candidate_then_stops_the_same_session() -> None:
    client = FakeAgentCore()
    decision = AgentCoreRuntime(client, "arn:runtime").investigate(CANDIDATE)

    assert decision == {"action": "schedule_recheck"}
    (_, invoke), (_, stop) = client.calls
    assert json.loads(invoke["payload"])["candidate"]["candidate_id"] == "area-abc12345"
    assert len(invoke["runtimeSessionId"]) >= 33
    assert stop["runtimeSessionId"] == invoke["runtimeSessionId"]


def test_session_is_stopped_even_when_invoke_fails() -> None:
    client = FakeAgentCore(fail=True)
    with contextlib.suppress(RuntimeError):
        AgentCoreRuntime(client, "arn:runtime").investigate(CANDIDATE)
    assert [name for name, _ in client.calls] == ["invoke", "stop"]

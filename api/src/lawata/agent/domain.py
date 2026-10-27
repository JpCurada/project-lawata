"""Agent domain: decisions, guard limits and ports."""

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Protocol


class Action(StrEnum):
    """Terminal actions the agent may end with."""

    MARK_ARTIFACT = "mark_artifact"
    LOG_EXPECTED = "log_expected"
    SCHEDULE_RECHECK = "schedule_recheck"
    CREATE_SAMPLING_TASK = "create_sampling_task"


TERMINAL_TOOLS = frozenset(a.value for a in Action)

# Tools that must have returned a result (not an error) before a terminal action is accepted.
# A recheck needs no evidence, so the agent can always fall back to it.
REQUIRED_EVIDENCE: dict[Action, tuple[str, ...]] = {
    Action.MARK_ARTIFACT: ("inspect_plume",),
    Action.LOG_EXPECTED: ("inspect_plume", "get_rainfall"),
    Action.SCHEDULE_RECHECK: (),
    Action.CREATE_SAMPLING_TASK: ("inspect_plume", "get_rainfall", "get_history"),
}

# Below this share of clear water in the 10 m window, clouds hide the lake: there is nothing
# to judge, so the only accepted ending is `schedule_recheck` (clouds are not an artifact).
MIN_CLEAR_WATER_FRAC = 0.1
NO_CLEAR_VIEW_REASON = "no clear view, check next pass"


def has_no_clear_view(trace: list[dict[str, Any]]) -> bool:
    """True when the latest successful `inspect_plume` saw too little clear water."""
    for step in reversed(trace):
        result = step.get("result")
        if step.get("tool") != "inspect_plume" or not isinstance(result, dict):
            continue
        if "error" in result:
            continue
        frac = result.get("clear_water_frac")
        return isinstance(frac, int | float) and frac < MIN_CLEAR_WATER_FRAC
    return False


@dataclass(frozen=True)
class Limits:
    """Hard limits for one candidate. Hitting any of them ends in a recheck."""

    max_turns: int = 6
    max_tool_calls: int = 8
    max_tokens_total: int = 20_000


@dataclass(frozen=True)
class Candidate:
    """A plume candidate handed over by the scan."""

    candidate_id: str
    place: str
    lat: float
    lon: float
    acquired_date: str
    area_ha: float


@dataclass(frozen=True)
class StoredPlume:
    """A stored plume event the agent has not decided on yet, as a candidate."""

    event_id: int
    candidate: Candidate
    centroid_lat: float
    centroid_lon: float


@dataclass(frozen=True)
class ToolCall:
    """A tool the model asked to run."""

    name: str
    args: dict[str, Any]
    call_id: str = ""


@dataclass(frozen=True)
class ModelReply:
    """One model turn: either tool calls or nothing (model stopped talking)."""

    tool_calls: list[ToolCall]
    tokens_used: int = 0


@dataclass(frozen=True)
class Decision:
    """The final decision for a candidate, with its evidence trail."""

    action: Action
    reason: str
    status: str
    trace: list[dict[str, Any]] = field(default_factory=list)


class ReasoningModel(Protocol):
    """Port for the LLM (Bedrock Converse in production, scripted in tests)."""

    def next_turn(self, candidate: Candidate, history: list[dict[str, Any]]) -> ModelReply:
        """Return the model's next tool calls given the history so far."""
        ...


class ToolBox(Protocol):
    """Port for non-terminal tools (inspect_plume, get_rainfall, ...)."""

    def run(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        """Run one tool and return compact JSON."""
        ...

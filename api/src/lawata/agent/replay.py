"""Replay the three demo cases offline with a scripted model.

Usage: python -m lawata.agent.replay --case all --mock-llm
"""

import argparse
from typing import Any

from lawata.agent.domain import (
    NO_CLEAR_VIEW_REASON,
    Candidate,
    ModelReply,
    ToolCall,
    has_no_clear_view,
)
from lawata.agent.service import run_candidate

CASES: dict[str, dict[str, Any]] = {
    "artifact": {
        "candidate": Candidate("artifact", "Pililla", 14.42, 121.335, "2026-04-21", 40.0),
        "evidence": {
            "inspect_plume": {"cloud_edge": True, "glint_frac": 0.1},
            "get_rainfall": {"rain_3d_mm": 0.0, "rain_7d_mm": 2.0},
        },
    },
    "rain": {
        "candidate": Candidate("rain", "Calamba", 14.2116, 121.1706, "2026-09-25", 806.0),
        "evidence": {
            "inspect_plume": {"cloud_edge": False, "shore_attached": True},
            "get_rainfall": {"rain_3d_mm": 40.0, "rain_7d_mm": 150.0},
        },
    },
    "dry": {
        "candidate": Candidate("dry", "Binangonan", 14.5016, 121.145, "2026-05-06", 92.0),
        "evidence": {
            "inspect_plume": {"cloud_edge": False, "shore_attached": True},
            "get_rainfall": {"rain_3d_mm": 0.0, "rain_7d_mm": 1.0},
            "get_history": {"dry_events": 4},
        },
    },
}


class CaseToolBox:
    """Fake tools that return the recorded evidence for one case."""

    def __init__(self, evidence: dict[str, dict[str, Any]]) -> None:
        self._evidence = evidence

    def run(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        """Return the recorded evidence for this tool."""
        return self._evidence.get(name, {})


class ScriptedModel:
    """Rule-following stand-in for Claude: decides only from tool results."""

    def next_turn(self, candidate: Candidate, history: list[dict[str, Any]]) -> ModelReply:
        """Pick the next tool or a terminal action from results so far."""
        done = {step["tool"]: step.get("result", {}) for step in history}
        if "inspect_plume" not in done:
            return ModelReply([ToolCall("inspect_plume", {"id": candidate.candidate_id})])
        if has_no_clear_view(history):
            return _terminal("schedule_recheck", NO_CLEAR_VIEW_REASON)
        if done["inspect_plume"].get("cloud_edge"):
            return _terminal("mark_artifact", "cloud edge visible at 10 m")
        if "get_rainfall" not in done:
            args = {"lat": candidate.lat, "lon": candidate.lon, "date": candidate.acquired_date}
            return ModelReply([ToolCall("get_rainfall", args)])
        if done["get_rainfall"].get("rain_7d_mm", 0) >= 15:
            return _terminal("log_expected", "heavy rain in the past week explains the plume")
        if "get_history" not in done:
            return ModelReply(
                [ToolCall("get_history", {"lat": candidate.lat, "lon": candidate.lon})]
            )
        past = done["get_history"]
        if past.get("dry_events", 0) + past.get("zone_unusual_passes", 0) > 0:
            return _terminal("create_sampling_task", "dry weather, shore-attached, seen before")
        return _terminal("schedule_recheck", "evidence not conclusive")


def _terminal(name: str, reason: str) -> ModelReply:
    return ModelReply([ToolCall(name, {"reason": reason})])


def replay(case: str) -> str:
    """Run one case and return its terminal action."""
    spec = CASES[case]
    decision = run_candidate(spec["candidate"], ScriptedModel(), CaseToolBox(spec["evidence"]))
    return decision.action.value


def main() -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--case", default="all")
    parser.add_argument("--mock-llm", action="store_true", help="scripted model, no Bedrock")
    args = parser.parse_args()
    for name in CASES if args.case == "all" else [args.case]:
        print(f"{name}: {replay(name)}")  # noqa: T201 - CLI output


if __name__ == "__main__":
    main()

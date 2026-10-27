from typing import Any

from lawata.agent.domain import Action, Candidate, ModelReply, ToolCall
from lawata.agent.replay import CASES, replay
from lawata.agent.service import run_candidate

CANDIDATE = Candidate("c1", "Calamba", 14.2, 121.1, "2026-09-25", 50.0)


class NoTools:
    def run(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        return {}


class EndlessModel:
    """Never decides; asks a new tool every turn."""

    def __init__(self) -> None:
        self.turn = 0

    def next_turn(self, candidate: Candidate, history: list[dict[str, Any]]) -> ModelReply:
        self.turn += 1
        return ModelReply([ToolCall("get_history", {"n": self.turn})])


class RepeatingModel:
    def next_turn(self, candidate: Candidate, history: list[dict[str, Any]]) -> ModelReply:
        return ModelReply([ToolCall("get_rainfall", {"lat": 1})])


def test_run_candidate_stops_endless_model_with_recheck() -> None:
    decision = run_candidate(CANDIDATE, EndlessModel(), NoTools())
    assert decision.action is Action.SCHEDULE_RECHECK
    assert decision.reason.startswith("guard:")


def test_run_candidate_stops_repeated_calls() -> None:
    decision = run_candidate(CANDIDATE, RepeatingModel(), NoTools())
    assert decision.action is Action.SCHEDULE_RECHECK
    assert "repeated" in decision.reason


def test_sampling_is_always_pending_approval() -> None:
    model = ScriptedReplies([INSPECT, RAIN, HISTORY], [SAMPLE])
    assert run_candidate(CANDIDATE, model, NoTools()).status == "pending_approval"


def test_replay_cases_end_in_three_different_actions() -> None:
    actions = {case: replay(case) for case in CASES}
    assert actions == {
        "artifact": "mark_artifact",
        "rain": "log_expected",
        "dry": "create_sampling_task",
    }


class ScriptedReplies:
    """Returns the given replies in order, then keeps repeating the last one."""

    def __init__(self, *turns: list[ToolCall]) -> None:
        self.turns = list(turns)
        self.histories: list[list[dict[str, Any]]] = []

    def next_turn(self, candidate: Candidate, history: list[dict[str, Any]]) -> ModelReply:
        self.histories.append(list(history))
        return ModelReply(self.turns.pop(0) if len(self.turns) > 1 else self.turns[0])


class Evidence:
    def run(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        return {"ok": name}


SAMPLE = ToolCall("create_sampling_task", {"reason": "dry"})
INSPECT = ToolCall("inspect_plume", {"id": "c1"})
RAIN = ToolCall("get_rainfall", {"lat": 14.2, "lon": 121.1, "date": "2026-09-25"})
HISTORY = ToolCall("get_history", {"lat": 14.2, "lon": 121.1})


def test_sampling_without_evidence_is_rejected_and_ends_in_recheck() -> None:
    decision = run_candidate(CANDIDATE, ScriptedReplies([SAMPLE]), Evidence())
    assert decision.action is Action.SCHEDULE_RECHECK
    assert decision.reason.startswith("guard:")
    assert "missing evidence" in decision.trace[0]["result"]["error"]


def test_model_is_told_what_is_missing_and_can_recover() -> None:
    model = ScriptedReplies([SAMPLE], [INSPECT, RAIN, HISTORY], [SAMPLE])
    decision = run_candidate(CANDIDATE, model, Evidence())
    assert decision.action is Action.CREATE_SAMPLING_TASK
    assert decision.status == "pending_approval"
    rejection = model.histories[1][0]["result"]["error"]
    assert "inspect_plume" in rejection and "get_history" in rejection


def test_each_tool_run_records_its_time_in_ms() -> None:
    ticks = iter([0.0, 1.2, 5.0, 5.9])
    model = ScriptedReplies([SAMPLE], [INSPECT, RAIN], [SAMPLE])
    decision = run_candidate(CANDIDATE, model, Evidence(), clock=lambda: next(ticks, 9.0))
    rejected, inspect, rain = decision.trace[:3]
    assert "ms" not in rejected
    assert (inspect["ms"], rain["ms"]) == (1200, 900)


def test_failed_tool_does_not_count_as_evidence() -> None:
    class Broken:
        def run(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
            return {"error": "tool not wired yet"}

    model = ScriptedReplies([INSPECT], [ToolCall("mark_artifact", {"reason": "cloud"})])
    decision = run_candidate(CANDIDATE, model, Broken())
    assert decision.action is Action.SCHEDULE_RECHECK


def test_decision_in_same_turn_as_inspection_is_deferred() -> None:
    model = ScriptedReplies(
        [INSPECT, ToolCall("mark_artifact", {"reason": "cloud"})],
        [ToolCall("mark_artifact", {"reason": "cloud edge at 10 m"})],
    )
    decision = run_candidate(CANDIDATE, model, Evidence())
    assert decision.action is Action.MARK_ARTIFACT
    assert "later turn" in model.histories[1][1]["result"]["error"]


def test_recheck_needs_no_evidence() -> None:
    model = ScriptedReplies([ToolCall("schedule_recheck", {"reason": "near cloud"})])
    decision = run_candidate(CANDIDATE, model, Evidence())
    assert decision.action is Action.SCHEDULE_RECHECK
    assert decision.reason == "near cloud"


class CloudedView:
    """inspect_plume sees almost no clear water: clouds cover the 10 m window."""

    def __init__(self, clear_water_frac: float = 0.0) -> None:
        self.clear_water_frac = clear_water_frac

    def run(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        if name == "inspect_plume":
            return {"plume_found": False, "clear_water_frac": self.clear_water_frac}
        return {"ok": name}


ARTIFACT = ToolCall("mark_artifact", {"reason": "Cloud cover dominates the 10 m crop."})
RECHECK = ToolCall("schedule_recheck", {"reason": "no clear view, check next pass"})


def test_no_clear_view_rejects_artifact_and_the_model_rechecks() -> None:
    model = ScriptedReplies([INSPECT], [ARTIFACT], [RECHECK])
    decision = run_candidate(CANDIDATE, model, CloudedView())
    assert decision.action is Action.SCHEDULE_RECHECK
    assert decision.reason == "no clear view, check next pass"
    rejection = model.histories[2][1]["result"]["error"]
    assert "no clear view" in rejection and "schedule_recheck" in rejection


def test_no_clear_view_never_ends_in_artifact_even_if_the_model_insists() -> None:
    decision = run_candidate(CANDIDATE, ScriptedReplies([INSPECT], [ARTIFACT]), CloudedView())
    assert decision.action is Action.SCHEDULE_RECHECK
    assert decision.reason.startswith("guard:")


def test_no_clear_view_also_blocks_sampling() -> None:
    model = ScriptedReplies([INSPECT, RAIN, HISTORY], [SAMPLE])
    decision = run_candidate(CANDIDATE, model, CloudedView(0.05))
    assert decision.action is Action.SCHEDULE_RECHECK


def test_artifact_is_allowed_when_enough_water_is_visible() -> None:
    decision = run_candidate(CANDIDATE, ScriptedReplies([INSPECT], [ARTIFACT]), CloudedView(0.6))
    assert decision.action is Action.MARK_ARTIFACT


def test_scripted_model_rechecks_when_clouds_hide_the_water() -> None:
    from lawata.agent.replay import ScriptedModel

    decision = run_candidate(CANDIDATE, ScriptedModel(), CloudedView())
    assert decision.action is Action.SCHEDULE_RECHECK
    assert "no clear view" in decision.reason

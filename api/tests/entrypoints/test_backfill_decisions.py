from typing import Any

from lawata.agent.domain import Candidate, Decision, StoredPlume
from lawata.entrypoints.backfill_decisions import triage
from lawata.sampling.domain import NewSamplingTask

PLUME = StoredPlume(
    event_id=7,
    candidate=Candidate("plume-7", "Binangonan", 14.50, 121.14, "2026-05-06", 92.0),
    centroid_lat=14.49,
    centroid_lon=121.15,
)


class FakeRuntime:
    def __init__(self, action: str) -> None:
        self.action = action
        self.sent: list[Candidate] = []

    def investigate(self, candidate: Candidate) -> dict[str, Any]:
        self.sent.append(candidate)
        return {
            "action": self.action,
            "status": "pending_approval" if self.action == "create_sampling_task" else "closed",
            "reason": "dry weather, shore-attached; suspicious, verify",
            "trace": [{"tool": "inspect_plume", "args": {}, "result": {}}],
        }


class FakeLog:
    def __init__(self, has_task: bool = False) -> None:
        self.has_task = has_task
        self.recorded: list[tuple[int, Decision]] = []

    def record(self, event_id: int, decision: Decision, model_id: str | None) -> int:
        self.recorded.append((event_id, decision))
        return 41

    def has_sampling_task(self, event_id: int) -> bool:
        return self.has_task


class FakeTasks:
    def __init__(self) -> None:
        self.created: list[NewSamplingTask] = []

    def create_task(self, new: NewSamplingTask) -> None:
        self.created.append(new)


def test_records_decision_with_trace() -> None:
    log, tasks = FakeLog(), FakeTasks()
    decision = triage(PLUME, FakeRuntime("mark_artifact"), log, tasks)
    assert decision.action == "mark_artifact"
    assert log.recorded[0][0] == 7
    assert log.recorded[0][1].trace[0]["tool"] == "inspect_plume"
    assert tasks.created == []


def test_sampling_decision_opens_pending_task_linked_to_decision() -> None:
    tasks = FakeTasks()
    triage(PLUME, FakeRuntime("create_sampling_task"), FakeLog(), tasks)
    [task] = tasks.created
    assert task.event_id == 7
    assert task.decision_id == 41
    assert [s.label for s in task.sites] == ["entry_point", "plume_centroid"]
    assert (task.sites[0].lat, task.sites[0].lon) == (14.50, 121.14)


def test_existing_task_is_not_duplicated() -> None:
    tasks = FakeTasks()
    triage(PLUME, FakeRuntime("create_sampling_task"), FakeLog(has_task=True), tasks)
    assert tasks.created == []

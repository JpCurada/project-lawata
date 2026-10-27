"""Let the deployed agent triage stored plumes that have no decision yet.

Each plume goes to the AgentCore runtime as one candidate (Bedrock calls, so this costs a
little per plume). The decision and its trace are stored in `agent_decision`. A
`create_sampling_task` decision also opens a sampling task, always `pending_approval`:
only a human approves. Safe to re-run: only plumes without a decision are sent.

    uv run python -m lawata.entrypoints.backfill_decisions --dry-run
    uv run python -m lawata.entrypoints.backfill_decisions --limit 5
"""

import argparse
import os
import sys
from typing import Any, Protocol

import boto3

from lawata.agent.adapters import NeonDecisionLog
from lawata.agent.domain import Action, Candidate, Decision, StoredPlume
from lawata.analysis.adapters import AgentCoreRuntime
from lawata.sampling.adapters import NeonSamplingTaskRepository
from lawata.sampling.domain import NewSamplingTask, SamplingSite
from lawata.shared.logging import get_logger

logger = get_logger(__name__)


class Runtime(Protocol):
    """The deployed agent."""

    def investigate(self, candidate: Candidate) -> dict[str, Any]:
        """Return the agent's decision for one candidate."""
        ...


class DecisionLog(Protocol):
    """Where decisions are stored."""

    def record(self, event_id: int, decision: Decision, model_id: str | None) -> int:
        """Store a decision; return its id."""
        ...

    def has_sampling_task(self, event_id: int) -> bool:
        """True if the plume already has a sampling task."""
        ...


class TaskStore(Protocol):
    """Where sampling tasks are stored (always `pending_approval`)."""

    def create_task(self, new: NewSamplingTask) -> Any:
        """Store a new task."""
        ...


def triage(
    plume: StoredPlume,
    runtime: Runtime,
    log: DecisionLog,
    tasks: TaskStore,
    model_id: str | None = None,
) -> Decision:
    """Investigate one stored plume, store the decision and, if asked, a pending task."""
    body = runtime.investigate(plume.candidate)
    decision = Decision(
        Action(body["action"]), str(body.get("reason", "")), body["status"], body.get("trace", [])
    )
    decision_id = log.record(plume.event_id, decision, model_id)
    if decision.action is Action.CREATE_SAMPLING_TASK and not log.has_sampling_task(plume.event_id):
        sites = (
            SamplingSite("entry_point", plume.candidate.lon, plume.candidate.lat),
            SamplingSite("plume_centroid", plume.centroid_lon, plume.centroid_lat),
        )
        tasks.create_task(NewSamplingTask(plume.event_id, decision_id, sites, decision.reason))
    return decision


def main(argv: list[str] | None = None) -> int:
    """Backfill decisions; return a process exit code."""
    parser = argparse.ArgumentParser(description="Triage stored plumes with the deployed agent.")
    parser.add_argument("--limit", type=int, default=50, help="most plumes to send")
    parser.add_argument("--dry-run", action="store_true", help="only list plumes to send")
    args = parser.parse_args(argv)

    log = NeonDecisionLog()
    plumes = log.undecided(args.limit)
    logger.info("%d plumes without a decision", len(plumes))
    if args.dry_run:
        for plume in plumes:
            c = plume.candidate
            logger.info("plume %d: %s %s", plume.event_id, c.place, c.acquired_date)
        return 0

    runtime_arn = os.environ.get("AGENT_RUNTIME_ARN")
    if not runtime_arn:
        logger.error("AGENT_RUNTIME_ARN is not set")
        return 1
    region = os.environ.get("AWS_REGION", "us-west-2")
    runtime = AgentCoreRuntime(boto3.client("bedrock-agentcore", region_name=region), runtime_arn)
    tasks = NeonSamplingTaskRepository()
    model_id = os.environ.get("BEDROCK_MODEL_ID")

    decided = 0
    for plume in plumes:
        try:
            decision = triage(plume, runtime, log, tasks, model_id)
        except Exception as error:  # noqa: BLE001 - one failed plume must not stop the rest
            logger.warning("plume %d skipped: %s: %s", plume.event_id, type(error).__name__, error)
            continue
        decided += 1
        logger.info("plume %d: %s (%s)", plume.event_id, decision.action.value, decision.reason)
    logger.info("done: %d of %d plumes decided", decided, len(plumes))
    return 0


if __name__ == "__main__":
    sys.exit(main())

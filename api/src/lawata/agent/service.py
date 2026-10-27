"""Agent use case: run the tool loop for one candidate with hard guards."""

import json
import time
from collections.abc import Callable
from typing import Any

from lawata.agent.domain import (
    MIN_CLEAR_WATER_FRAC,
    NO_CLEAR_VIEW_REASON,
    REQUIRED_EVIDENCE,
    TERMINAL_TOOLS,
    Action,
    Candidate,
    Decision,
    Limits,
    ReasoningModel,
    ToolBox,
    ToolCall,
    has_no_clear_view,
)

DEFAULT_LIMITS = Limits()
NO_CLEAR_VIEW_ERROR = (
    f"{NO_CLEAR_VIEW_REASON}: clear_water_frac < {MIN_CLEAR_WATER_FRAC:g}, clouds hide the "
    "water and are not an artifact. End with schedule_recheck."
)


def _status_for(action: Action) -> str:
    return {
        Action.MARK_ARTIFACT: "artifact",
        Action.LOG_EXPECTED: "expected",
        Action.SCHEDULE_RECHECK: "recheck",
        Action.CREATE_SAMPLING_TASK: "pending_approval",  # never auto-approved
    }[action]


def _guard_stop(reason: str, trace: list[dict[str, Any]]) -> Decision:
    action = Action.SCHEDULE_RECHECK
    return Decision(action, f"guard: {reason}", _status_for(action), trace)


def _missing_evidence(action: Action, trace: list[dict[str, Any]]) -> list[str]:
    """Required tools that have not yet returned a result without an error."""
    done = {step["tool"] for step in trace if "result" in step and "error" not in step["result"]}
    return [tool for tool in REQUIRED_EVIDENCE[action] if tool not in done]


def run_candidate(
    candidate: Candidate,
    model: ReasoningModel,
    tools: ToolBox,
    limits: Limits = DEFAULT_LIMITS,
    clock: Callable[[], float] = time.perf_counter,
) -> Decision:
    """Let the model investigate one candidate until it picks a terminal action.

    A terminal action is accepted only alone in its turn and after its required evidence
    (see `REQUIRED_EVIDENCE`); otherwise the model is told what is missing and goes on.
    Any limit, repeated call or error ends in `schedule_recheck`, never in sampling.
    When the latest inspection shows no clear view (`has_no_clear_view`), only
    `schedule_recheck` is accepted.
    Each tool that runs records its wall time in `ms` (`clock` is in seconds), for the web's
    step list.
    """
    trace: list[dict[str, Any]] = []
    seen_calls: set[str] = set()
    tool_calls = 0
    tokens = 0

    for _turn in range(limits.max_turns):
        try:
            reply = model.next_turn(candidate, trace)
        except Exception as error:  # noqa: BLE001 - any model failure must end safely
            return _guard_stop(f"model error {type(error).__name__}", trace)

        tokens += reply.tokens_used
        if tokens > limits.max_tokens_total:
            return _guard_stop("token budget", trace)
        if not reply.tool_calls:
            return _guard_stop("model stopped without a decision", trace)

        # Decide only on results the model has already seen, never in the same turn.
        investigating = any(call.name not in TERMINAL_TOOLS for call in reply.tool_calls)

        for call in reply.tool_calls:
            if call.name in TERMINAL_TOOLS and not investigating:
                action = Action(call.name)
                missing = _missing_evidence(action, trace)
                if action is not Action.SCHEDULE_RECHECK and has_no_clear_view(trace):
                    rejection = {"error": NO_CLEAR_VIEW_ERROR}
                elif not missing:
                    reason = str(call.args.get("reason", ""))
                    trace.append({"tool": call.name, "args": call.args})
                    return Decision(action, reason, _status_for(action), trace)
                else:
                    rejection = {"error": f"missing evidence: call {', '.join(missing)} first"}
            elif call.name in TERMINAL_TOOLS:
                rejection = {"error": "decide in a later turn, after reading these results"}
            else:
                rejection = None

            tool_calls += 1
            if tool_calls > limits.max_tool_calls:
                return _guard_stop("tool call budget", trace)
            if rejection is not None:
                trace.append({"tool": call.name, "args": call.args, "result": rejection})
                continue
            key = f"{call.name}:{json.dumps(call.args, sort_keys=True)}"
            if key in seen_calls:
                return _guard_stop(f"repeated call {call.name}", trace)
            seen_calls.add(key)
            started = clock()
            result = _safe_run(tools, call)
            ms = round((clock() - started) * 1000)
            trace.append({"tool": call.name, "args": call.args, "result": result, "ms": ms})

    return _guard_stop("turn budget", trace)


def _safe_run(tools: ToolBox, call: ToolCall) -> dict[str, Any]:
    try:
        return tools.run(call.name, call.args)
    except Exception as error:  # noqa: BLE001 - report tool failure back to the model
        return {"error": type(error).__name__}

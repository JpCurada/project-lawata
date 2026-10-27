"""Agent adapters: Bedrock Converse model, in-process tool box and the decision log."""

import json
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from typing import Any

from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from lawata.agent.domain import Candidate, Decision, ModelReply, StoredPlume, ToolCall
from lawata.shared.db import get_conn

SYSTEM_PROMPT = """You triage satellite-detected water plumes for Laguna de Bay.
Investigate with tools, then end with exactly one terminal tool, alone in its turn.
Always call inspect_plume first. log_expected also needs get_rainfall;
create_sampling_task needs inspect_plume, get_rainfall and get_history.
- clear_water_frac < 0.1 (clouds hide the water) -> schedule_recheck "no clear view, check
  next pass". Clouds are not an artifact.
- Cloud edge or glint at 10 m -> mark_artifact.
- Rain 7 d >= 15 mm or a known source explains it -> log_expected.
- Ambiguous or near cloud -> schedule_recheck.
- Dry, shore-attached, clean at 10 m, seen before -> create_sampling_task.
After inspect_plume you see its 10 m crop: red outline = plume, yellow = cloud buffer,
white cross = reported entry point. Check the picture against the numbers; if they disagree,
schedule_recheck.
Always cite the visual evidence in `reason`. Never say "illegal"; say "suspicious, verify"."""

CROP_CAPTION = "10 m crop from inspect_plume (red = plume, yellow = cloud buffer, + = entry):"


class BedrockConverseModel:
    """`ReasoningModel` backed by Amazon Bedrock Converse with tool use."""

    def __init__(
        self,
        client: Any,
        model_id: str,
        tool_specs: list[dict[str, Any]],
        images: Mapping[str, bytes] | None = None,
    ) -> None:
        self._client = client
        self._model_id = model_id
        self._tool_specs = tool_specs
        self._images = images if images is not None else {}

    def next_turn(self, candidate: Candidate, history: list[dict[str, Any]]) -> ModelReply:
        """Send the candidate, the trace so far and the latest crop; return tool calls."""
        prompt = {"candidate": candidate.__dict__, "trace": history}
        response = self._client.converse(
            modelId=self._model_id,
            system=[{"text": SYSTEM_PROMPT}],
            messages=[{"role": "user", "content": self._content(json.dumps(prompt), history)}],
            toolConfig={"tools": self._tool_specs, "toolChoice": {"any": {}}},
            inferenceConfig={"maxTokens": 512, "temperature": 0},
        )
        content = response["output"]["message"]["content"]
        calls = [
            ToolCall(c["toolUse"]["name"], c["toolUse"]["input"], c["toolUse"]["toolUseId"])
            for c in content
            if "toolUse" in c
        ]
        usage = response.get("usage", {})
        return ModelReply(
            calls, int(usage.get("inputTokens", 0)) + int(usage.get("outputTokens", 0))
        )

    def _content(self, text: str, history: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Text block, plus the most recent crop as an image (one image per candidate)."""
        content: list[dict[str, Any]] = [{"text": text}]
        crops = [step["result"].get("crop") for step in history if "result" in step]
        jpeg = next((self._images[c] for c in reversed(crops) if c in self._images), None)
        if jpeg is not None:
            content += [
                {"text": CROP_CAPTION},
                {"image": {"format": "jpeg", "source": {"bytes": jpeg}}},
            ]
        return content


class LocalToolBox:
    """`ToolBox` that runs tools in-process by calling feature services."""

    def __init__(self, handlers: dict[str, Callable[..., dict[str, Any]]]) -> None:
        self._handlers = handlers

    def run(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        """Run a registered tool; unknown tools return an error the model can see."""
        handler = self._handlers.get(name)
        if handler is None:
            return {"error": f"unknown tool {name}"}
        return handler(**args)


# A plume without a place keeps the lake name, so the model still gets a location.
_UNDECIDED_SQL = """
SELECT c.event_id,
       COALESCE(c.place, 'Laguna de Bay') AS place,
       c.acquired_date,
       c.area_ha::float8 AS area_ha,
       c.entry_lat,
       c.entry_lon,
       ST_Y(e.centroid_geom) AS centroid_lat,
       ST_X(e.centroid_geom) AS centroid_lon
FROM v_plume_event_context c
JOIN plume_event e ON e.event_id = c.event_id
WHERE NOT EXISTS (SELECT 1 FROM agent_decision d WHERE d.event_id = c.event_id)
ORDER BY c.acquired_date DESC, c.event_id DESC
LIMIT %(limit)s
"""

_RECORD_SQL = """
INSERT INTO agent_decision (event_id, action, reason, trace, model_id)
VALUES (%(event_id)s, %(action)s::agent_action, %(reason)s, %(trace)s, %(model_id)s)
RETURNING decision_id
"""

_HAS_TASK_SQL = "SELECT EXISTS (SELECT 1 FROM sampling_task WHERE event_id = %(event_id)s)"


class NeonDecisionLog:
    """Agent decisions on stored plume events, in Neon (`agent_decision`)."""

    def __init__(self, connection: Connection | None = None) -> None:
        self._connection = connection

    @contextmanager
    def _conn(self) -> Iterator[Connection]:
        if self._connection is not None:
            yield self._connection
            return
        with get_conn() as conn:
            yield conn

    def undecided(self, limit: int) -> list[StoredPlume]:
        """Plume events with no agent decision yet, newest first."""
        with self._conn() as conn, conn.cursor(row_factory=dict_row) as cursor:
            rows = cursor.execute(_UNDECIDED_SQL, {"limit": limit}).fetchall()
        return [
            StoredPlume(
                event_id=row["event_id"],
                candidate=Candidate(
                    candidate_id=f"plume-{row['event_id']}",
                    place=row["place"],
                    lat=row["entry_lat"],
                    lon=row["entry_lon"],
                    acquired_date=row["acquired_date"].isoformat(),
                    area_ha=row["area_ha"],
                ),
                centroid_lat=row["centroid_lat"],
                centroid_lon=row["centroid_lon"],
            )
            for row in rows
        ]

    def record(self, event_id: int, decision: Decision, model_id: str | None) -> int:
        """Store a decision with its trace; return its id."""
        params = {
            "event_id": event_id,
            "action": decision.action.value,
            "reason": decision.reason,
            "trace": Jsonb(decision.trace),
            "model_id": model_id,
        }
        with self._conn() as conn:
            row = conn.execute(_RECORD_SQL, params).fetchone()
        assert row is not None  # INSERT ... RETURNING always returns the row
        return int(row[0])

    def has_sampling_task(self, event_id: int) -> bool:
        """True if the plume already has a sampling task in any status."""
        with self._conn() as conn:
            row = conn.execute(_HAS_TASK_SQL, {"event_id": event_id}).fetchone()
        return bool(row and row[0])

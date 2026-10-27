from datetime import date
from typing import Any

from detection.windows import make_window

from lawata.agent.adapters import CROP_CAPTION, BedrockConverseModel, LocalToolBox
from lawata.agent.domain import Action, Candidate, ModelReply, ToolCall
from lawata.agent.service import run_candidate
from lawata.agent.tool_specs import TOOL_SPECS, ToolPorts, build_handlers
from lawata.detection.adapters import MemoryCropStore
from lawata.imagery.domain import BandWindow
from lawata.sightings.domain import NearbyHistory
from lawata.weather.domain import RainfallUnavailableError

CANDIDATE = Candidate("dry", "Binangonan", 14.5044, 121.1546, "2026-05-06", 92.0)


class Scenes:
    def read_window(
        self, lat: float, lon: float, on: date, half_km: float, res_m: float
    ) -> BandWindow:
        return make_window()


class DryRain:
    def daily_mm(self, lat: float, lon: float, start: date, end: date) -> list[float]:
        return [0.0, 0.2, 0.0, 0.0, 0.5, 0.0, 0.1]


class NoRain:
    def daily_mm(self, lat: float, lon: float, start: date, end: date) -> list[float]:
        raise RainfallUnavailableError("archive down")


class History:
    def __init__(self) -> None:
        self.before: list[date] = []

    def nearby_history(
        self, lat: float, lon: float, radius_km: float, before: date
    ) -> NearbyHistory:
        self.before.append(before)
        return NearbyHistory(events=5, dry_events=4, last_seen=date(2026, 4, 2))


def _tools(rainfall: Any = None, history: History | None = None) -> tuple[LocalToolBox, dict]:
    images: dict[str, bytes] = {}
    ports = ToolPorts(Scenes(), MemoryCropStore(), rainfall or DryRain(), history or History())
    return LocalToolBox(build_handlers(CANDIDATE, ports, images)), images


def test_inspect_plume_returns_opencv_evidence_and_keeps_the_crop() -> None:
    tools, images = _tools()
    result = tools.run("inspect_plume", {"id": "dry"})
    assert result["plume_found"] is True and result["shore_attached"] is True
    assert result["crop"] == "memory://crops/dry.jpg"
    assert images[result["crop"]].startswith(b"\xff\xd8")  # JPEG


def test_get_rainfall_and_history_use_the_feature_services() -> None:
    history = History()
    tools, _ = _tools(history=history)
    rain = tools.run("get_rainfall", {"lat": 14.5, "lon": 121.15, "date": "2026-05-06"})
    assert rain == {"rain_3d_mm": 0.6, "rain_7d_mm": 0.8, "is_dry": True}
    past = tools.run("get_history", {"lat": 14.5, "lon": 121.15})
    assert past["dry_events"] == 4 and past["last_seen"] == "2026-04-02"
    assert past["zone_unusual_passes"] == 0
    assert history.before == [date(2026, 5, 6)]  # only plumes before this pass


class FakeBedrock:
    """Answers like Converse and records every request."""

    def __init__(self, *turns: list[dict[str, Any]]) -> None:
        self.turns = list(turns)
        self.requests: list[dict[str, Any]] = []

    def converse(self, **request: Any) -> dict[str, Any]:
        self.requests.append(request)
        calls = self.turns.pop(0)
        content = [
            {"toolUse": {"toolUseId": f"t{i}", "name": c["name"], "input": c["input"]}}
            for i, c in enumerate(calls)
        ]
        return {"output": {"message": {"content": content}}, "usage": {"inputTokens": 900}}


def _use(name: str, **args: Any) -> dict[str, Any]:
    return {"name": name, "input": args}


def test_crop_is_shown_to_the_model_after_inspection() -> None:
    tools, images = _tools()
    bedrock = FakeBedrock(
        [_use("inspect_plume", id="dry")],
        [_use("mark_artifact", reason="cloud edge visible in the 10 m crop")],
    )
    model = BedrockConverseModel(bedrock, "model", TOOL_SPECS, images)
    decision = run_candidate(CANDIDATE, model, tools)

    assert decision.action is Action.MARK_ARTIFACT
    first, second = (r["messages"][0]["content"] for r in bedrock.requests)
    assert len(first) == 1  # nothing to see before inspecting
    assert second[1] == {"text": CROP_CAPTION}
    assert second[2]["image"]["source"]["bytes"] == images["memory://crops/dry.jpg"]
    assert bedrock.requests[0]["toolConfig"]["toolChoice"] == {"any": {}}


def test_failed_rainfall_blocks_sampling() -> None:
    tools, images = _tools(rainfall=NoRain())

    class Eager:
        def next_turn(self, candidate: Candidate, history: list[dict[str, Any]]) -> ModelReply:
            if not history:
                return ModelReply(
                    [
                        ToolCall("inspect_plume", {"id": "dry"}),
                        ToolCall("get_rainfall", {"lat": 14.5, "lon": 121.1, "date": "2026-05-06"}),
                        ToolCall("get_history", {"lat": 14.5, "lon": 121.1}),
                    ]
                )
            return ModelReply([ToolCall("create_sampling_task", {"reason": "dry, seen before"})])

    decision = run_candidate(CANDIDATE, Eager(), tools)
    assert decision.trace[1]["result"] == {"error": "RainfallUnavailableError"}
    assert decision.action is Action.SCHEDULE_RECHECK

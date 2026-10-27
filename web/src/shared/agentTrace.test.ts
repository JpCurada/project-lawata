import { describe, expect, it } from "vitest";
import { modelLabel, readTrace } from "./agentTrace";

const dryRun = [
  { tool: "create_sampling_task", args: { reason: "dry" }, result: { error: "missing evidence: call inspect_plume, get_rainfall first" } },
  {
    tool: "inspect_plume",
    args: {},
    result: { plume_found: true, clear_water_frac: 0.84, area_ha: 92.4, kind: "brown+dark", shore_attached: true, glint_frac: 0 },
    ms: 1234,
  },
  { tool: "get_rainfall", args: {}, result: { rain_3d_mm: 1.2, rain_7d_mm: 1.4, is_dry: true }, ms: 900 },
  { tool: "get_history", args: {}, result: { error: "OperationalError" }, ms: 40 },
  { tool: "create_sampling_task", args: { reason: "Suspicious, verify." } },
];

describe("readTrace", () => {
  it("makes one row per call in plain words, with timings and the decision last", () => {
    const { steps, decision, stopped } = readTrace(dryRun, "create_sampling_task", "Suspicious, verify.");
    expect(steps.map((step) => [step.label, step.state, step.ms])).toEqual([
      ["Tried to request field sampling", "blocked", undefined],
      ["Looked at the 10 m image", "done", 1234],
      ["Checked recent rainfall", "done", 900],
      ["Checked earlier plumes nearby", "error", 40],
    ]);
    expect(steps[0].details).toEqual(["Blocked: needs looked at the 10 m image, checked recent rainfall first"]);
    expect(steps[1].details).toEqual(["Plume found at 10 m: 92 ha, brown and dark water", "Clear water: 84%", "Attached to the shore"]);
    expect(steps[2].details).toEqual(["Rain, 3 days: 1.2 mm", "Rain, 7 days: 1.4 mm", "Dry weather"]);
    expect(steps[3].details).toEqual(["The tool failed (OperationalError)"]);
    expect(decision).toEqual({ label: "Field sampling requested, pending approval", reason: "Suspicious, verify." });
    expect(stopped).toBe(false);
  });

  it("says when a safety limit ended the run", () => {
    const { decision, stopped } = readTrace([], "schedule_recheck", "guard: turn budget");
    expect(stopped).toBe(true);
    expect(decision?.reason).toBe("Stopped by a safety limit (turn budget).");
  });
});

describe("modelLabel", () => {
  it("names Claude models and leaves other ids alone", () => {
    expect(modelLabel("us.anthropic.claude-haiku-4-5-20251001-v1:0")).toBe("Claude Haiku 4.5");
    expect(modelLabel("anthropic.claude-sonnet-5-20260101-v1:0")).toBe("Claude Sonnet 5");
    expect(modelLabel("some-other-model")).toBe("some-other-model");
  });
});

// Turns an agent trace (api/src/lawata/agent/service.py run_candidate) into the rows the
// AgentRun component shows: one row per tool call, in plain words, plus the final decision.

import { decisionLabel, toolLabel } from "./labels";

type TraceStep = Record<string, unknown>;

export type StepState = "done" | "error" | "blocked";

export interface AgentStep {
  tool: string;
  label: string;
  state: StepState;
  /** Wall time of the tool call; absent for blocked calls and older traces. */
  ms?: number;
  /** Plain-language lines shown when the row is opened. */
  details: string[];
}

export interface AgentOutcome {
  steps: AgentStep[];
  decision: { label: string; reason: string } | null;
  /** True when a hard limit (turns, tool calls, tokens, repeats) ended the run. */
  stopped: boolean;
}

// Terminal tools end the run and carry no result (TERMINAL_TOOLS in agent/domain.py).
const TERMINAL = new Set(["mark_artifact", "log_expected", "schedule_recheck", "create_sampling_task"]);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const num = (value: unknown) => (typeof value === "number" ? value : null);
const pct = (frac: number) => `${Math.round(frac * 100)}%`;
const mm = (value: number | null) => (value === null ? "no data" : `${value.toFixed(1)} mm`);

function inspectDetails(result: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const area = num(result.area_ha);
  if (result.plume_found === true) {
    const kind = typeof result.kind === "string" ? `, ${result.kind.replace("+", " and ")} water` : "";
    lines.push(`Plume found at 10 m${area !== null ? `: ${Math.round(area)} ha` : ""}${kind}`);
  } else if (result.plume_found === false) {
    lines.push("No plume found at 10 m");
  }
  const clear = num(result.clear_water_frac);
  if (clear !== null) lines.push(`Clear water: ${pct(clear)}`);
  if (result.cloud_edge === true) lines.push("Touches a cloud edge");
  const glint = num(result.glint_frac);
  if (glint !== null && glint > 0) lines.push(`Sun glint: ${pct(glint)}`);
  if (result.haze === true) lines.push("Haze over the water");
  if (result.shore_attached === true) lines.push("Attached to the shore");
  return lines;
}

function rainDetails(result: Record<string, unknown>): string[] {
  const lines = [`Rain, 3 days: ${mm(num(result.rain_3d_mm))}`, `Rain, 7 days: ${mm(num(result.rain_7d_mm))}`];
  if (typeof result.is_dry === "boolean") lines.push(result.is_dry ? "Dry weather" : "After rain");
  return lines;
}

function historyDetails(result: Record<string, unknown>): string[] {
  const events = num(result.events) ?? 0;
  const dry = num(result.dry_events) ?? 0;
  const lines = [
    events === 0
      ? "No earlier plumes within 1 km"
      : `${events} earlier ${events === 1 ? "plume" : "plumes"} within 1 km (${dry} in dry weather)`,
  ];
  if (typeof result.last_seen === "string") lines.push(`Last seen ${result.last_seen}`);
  const passes = num(result.zone_passes);
  const unusual = num(result.zone_unusual_passes);
  if (passes !== null && passes > 0 && unusual !== null) {
    lines.push(`Unusual water on ${unusual} of ${passes} clear passes nearby`);
  }
  return lines;
}

const detailsByTool: Record<string, (result: Record<string, unknown>) => string[]> = {
  inspect_plume: inspectDetails,
  get_rainfall: rainDetails,
  get_history: historyDetails,
};

/** Guard refusals (agent/service.py), reworded. Anything else is a tool failure. */
function blockedReason(error: string): string | null {
  const missing = error.match(/^missing evidence: call (.+) first/);
  if (missing) return `Blocked: needs ${missing[1].split(", ").map((tool) => toolLabel(tool).toLowerCase()).join(", ")} first`;
  if (error.startsWith("decide in a later turn")) return "Blocked: decide only after reading these results";
  if (error.startsWith("no clear view")) return "Blocked: clouds hide the water, so only a re-check is allowed";
  return null;
}

// A refused decision is an attempt, not something that happened.
const attemptLabels: Record<string, string> = {
  mark_artifact: "Tried to mark it as an image artifact",
  log_expected: "Tried to log it as expected",
  schedule_recheck: "Tried to schedule a re-check",
  create_sampling_task: "Tried to request field sampling",
};

function toStep(step: TraceStep, tool: string): AgentStep {
  const result = isRecord(step.result) ? step.result : {};
  const ms = num(step.ms) ?? undefined;
  if (typeof result.error === "string") {
    const blocked = blockedReason(result.error);
    const label = attemptLabels[tool] ?? toolLabel(tool);
    if (blocked !== null) return { tool, label, state: "blocked", ms, details: [blocked] };
    return { tool, label, state: "error", ms, details: [`The tool failed (${result.error})`] };
  }
  return { tool, label: toolLabel(tool), state: "done", ms, details: detailsByTool[tool]?.(result) ?? [] };
}

export function readTrace(
  trace: ReadonlyArray<TraceStep>,
  action: string | null | undefined,
  reason: string | null | undefined,
): AgentOutcome {
  const steps: AgentStep[] = [];
  for (const step of trace) {
    if (typeof step.tool !== "string") continue;
    // The accepted terminal call has no result; it is shown as the decision instead.
    if (TERMINAL.has(step.tool) && !("result" in step)) continue;
    steps.push(toStep(step, step.tool));
  }
  const stopped = typeof reason === "string" && reason.startsWith("guard:");
  const decision =
    action == null
      ? null
      : {
          label: decisionLabel(action, trace),
          reason: stopped ? `Stopped by a safety limit (${reason.slice("guard:".length).trim()}).` : (reason ?? ""),
        };
  return { steps, decision, stopped };
}

/** "us.anthropic.claude-haiku-4-5-20251001-v1:0" -> "Claude Haiku 4.5"; other ids unchanged. */
export function modelLabel(modelId: string): string {
  // The minor version is one digit; an 8-digit date after the major is not a minor version.
  const match = modelId.match(/claude-([a-z]+)-(\d+)(?:-(\d)(?!\d))?/);
  if (match === null) return modelId;
  const [, family, major, minor] = match;
  return `Claude ${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ""}`;
}

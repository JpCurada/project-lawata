// Agent actions from the agent_action enum (db/migrations/001_decisions_sampling.sql).
const actionLabels: Record<string, string> = {
  mark_artifact: "Marked as an image artifact",
  log_expected: "Logged as expected (rain or known source)",
  schedule_recheck: "Re-check scheduled",
  create_sampling_task: "Field sampling requested, pending approval",
};

function humanize(name: string): string {
  const words = name.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function actionLabel(action: string): string {
  return actionLabels[action] ?? humanize(action);
}

// schedule_recheck forced by too little clear water (has_no_clear_view, api/src/lawata/agent/domain.py).
export const CLOUD_RECHECK_LABEL = "Clouds hide the water, re-check on the next pass";
const MIN_CLEAR_WATER_FRAC = 0.1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** True when the latest successful inspect_plume step saw too little clear water. */
export function hasNoClearView(trace: ReadonlyArray<Record<string, unknown>>): boolean {
  for (let index = trace.length - 1; index >= 0; index -= 1) {
    const step = trace[index];
    const result = step.result;
    if (step.tool !== "inspect_plume" || !isRecord(result) || "error" in result) continue;
    const frac = result.clear_water_frac;
    return typeof frac === "number" && frac < MIN_CLEAR_WATER_FRAC;
  }
  return false;
}

/** Label for the agent's ending, naming clouds when they forced the re-check. */
export function decisionLabel(action: string, trace: ReadonlyArray<Record<string, unknown>>): string {
  if (action === "schedule_recheck" && hasNoClearView(trace)) return CLOUD_RECHECK_LABEL;
  return actionLabel(action);
}

// Agent tools from TOOL_SPECS (api/src/lawata/agent/tool_specs.py), as trace steps.
const toolLabels: Record<string, string> = {
  inspect_plume: "Looked at the 10 m image",
  get_rainfall: "Checked recent rainfall",
  get_history: "Checked earlier plumes nearby",
  mark_artifact: "Marked as an image artifact",
  log_expected: "Logged as expected (rain or known source)",
  schedule_recheck: "Scheduled a re-check on the next pass",
  create_sampling_task: "Requested field sampling, pending approval",
};

export function toolLabel(tool: string): string {
  return toolLabels[tool] ?? humanize(tool);
}

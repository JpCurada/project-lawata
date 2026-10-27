// Real recorded agent runs, copied from docs/blueprint/traces-live.json (see docs/blueprint/README.md).
// Recorded 2026-10-25 against live data: real OpenCV 10 m inspection on Sentinel-2, real Open-Meteo
// rain and the production history SQL. Values are exact; `ms` is tool_seconds x 1000. The only field
// left out is inspect_plume's `crop`, a local file path on the recording machine.
// Public viewers don't get the live `latest_decision`, so Home and the story pages show these runs instead.

/** One trace step, shaped like the agent's trace (api/src/lawata/agent/service.py). */
export type RecordedStep = {
  tool: string;
  args: Record<string, unknown>;
  /** Absent on the accepted terminal call. */
  result?: Record<string, unknown>;
  /** Wall time of the tool call. */
  ms?: number;
};

export type RecordedRun = {
  eventId: number;
  place: string;
  date: string;
  action: string;
  status: string;
  reason: string;
  recordedOn: string;
  trace: RecordedStep[];
};

const recordedOn = "2026-10-25";

const pililla: RecordedRun = {
  eventId: 26,
  place: "Pililla",
  date: "2026-04-21",
  action: "mark_artifact",
  status: "artifact",
  reason: "cloud edge visible at 10 m",
  recordedOn,
  trace: [
    {
      tool: "inspect_plume",
      args: { id: "plume-26" },
      result: {
        plume_found: true,
        clear_water_frac: 0.17,
        area_ha: 728,
        kind: "dark",
        cloud_edge: true,
        near_cloud_frac: 0.77,
        glint_frac: 0.15,
        haze: false,
        texture: 0.88,
        compactness: 0.12,
        shore_attached: true,
      },
      ms: 135620,
    },
    { tool: "mark_artifact", args: { reason: "cloud edge visible at 10 m" } },
  ],
};

const calamba: RecordedRun = {
  eventId: 34,
  place: "Calamba",
  date: "2026-09-25",
  action: "log_expected",
  status: "expected",
  reason: "heavy rain in the past week explains the plume",
  recordedOn,
  trace: [
    {
      tool: "inspect_plume",
      args: { id: "plume-34" },
      result: {
        plume_found: true,
        clear_water_frac: 0.96,
        area_ha: 831,
        kind: "brown+dark",
        cloud_edge: false,
        near_cloud_frac: 0.0,
        glint_frac: 0.05,
        haze: false,
        texture: 1.0,
        compactness: 0.28,
        shore_attached: true,
      },
      ms: 42430,
    },
    {
      tool: "get_rainfall",
      args: { lat: 14.21163, lon: 121.17055, date: "2026-09-25" },
      result: { rain_3d_mm: 18.0, rain_7d_mm: 90.1, is_dry: false },
      ms: 930,
    },
    { tool: "log_expected", args: { reason: "heavy rain in the past week explains the plume" } },
  ],
};

const binangonan: RecordedRun = {
  eventId: 27,
  place: "Binangonan",
  date: "2026-05-06",
  action: "create_sampling_task",
  status: "pending_approval",
  reason: "dry weather, shore-attached, seen before",
  recordedOn,
  trace: [
    {
      tool: "inspect_plume",
      args: { id: "plume-27" },
      result: {
        plume_found: true,
        clear_water_frac: 0.85,
        area_ha: 585,
        kind: "brown",
        cloud_edge: false,
        near_cloud_frac: 0.13,
        glint_frac: 0.09,
        haze: false,
        texture: 1.07,
        compactness: 0.12,
        shore_attached: true,
      },
      ms: 27410,
    },
    {
      tool: "get_rainfall",
      args: { lat: 14.50436, lon: 121.15458, date: "2026-05-06" },
      result: { rain_3d_mm: 0.3, rain_7d_mm: 0.3, is_dry: true },
      ms: 870,
    },
    {
      tool: "get_history",
      args: { lat: 14.50436, lon: 121.15458 },
      result: { events: 0, dry_events: 0, last_seen: null, zone_passes: 23, zone_unusual_passes: 3 },
      ms: 50,
    },
    { tool: "create_sampling_task", args: { reason: "dry weather, shore-attached, seen before" } },
  ],
};

export const recordedRuns: readonly RecordedRun[] = [pililla, calamba, binangonan];

/** The recorded run for a story's place and date, if there is one. */
export const findRecordedRun = (place: string, date: string) =>
  recordedRuns.find((run) => run.place === place && run.date === date);

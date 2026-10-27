import { useQuery } from "@tanstack/react-query";
import { api } from "../../shared/api/client";

export const LATEST_COUNT = 4;
// Fetch more than we show: one pass often finds several plumes at the same place, and Home keeps one each.
const LATEST_FETCH = 20;
// The backend's MAX_TASK_LIMIT; pending tasks are few, so one page counts them all.
const MAX_TASKS = 200;

async function ok<T>(request: Promise<{ data?: T; response: Response }>): Promise<T> {
  const { data, response } = await request;
  if (!response.ok || data === undefined) throw new Error(`API returned ${response.status}`);
  return data;
}

export function useStatsQuery() {
  return useQuery({
    queryKey: ["stats"],
    queryFn: ({ signal }) => ok(api.GET("/api/stats", { signal })),
  });
}

/** Newest plumes, newest first. */
export function useLatestPlumesQuery() {
  return useQuery({
    queryKey: ["plumes", "latest", LATEST_FETCH],
    queryFn: ({ signal }) => ok(api.GET("/api/plumes", { params: { query: { limit: LATEST_FETCH } }, signal })),
  });
}

/** Newest dry-weather plumes: Home lists these first, since they are the ones worth a sample. */
export function useDryPlumesQuery() {
  return useQuery({
    queryKey: ["plumes", "latest", "dry", LATEST_FETCH],
    queryFn: ({ signal }) =>
      ok(api.GET("/api/plumes", { params: { query: { limit: LATEST_FETCH, dry_only: true } }, signal })),
  });
}

/** Every plume as a map point (lon, lat, dry or not, area), for the hero's dot cluster. */
export function usePlumePointsQuery() {
  return useQuery({
    queryKey: ["plumes", "points"],
    queryFn: async ({ signal }) => {
      const collection = await ok(api.GET("/api/plumes.geojson", { signal }));
      return collection.features.map((feature) => ({
        id: feature.properties.id,
        lon: feature.geometry.coordinates[0],
        lat: feature.geometry.coordinates[1],
        dry: feature.properties.is_dry,
        areaHa: feature.properties.area_ha,
      }));
    },
  });
}

/**
 * The evidence crop of the largest plume at a place on a date (ids differ between databases, so
 * stories are matched by place and date). Null when there is no plume or no stored crop.
 */
export function usePlumeCropQuery(place: string, date: string) {
  return useQuery({
    queryKey: ["home", "crop", place, date],
    queryFn: async ({ signal }) => {
      const matches = await ok(
        api.GET("/api/plumes", { params: { query: { place, from: date, to: date, limit: 5 } }, signal }),
      );
      const match = [...matches].sort((a, b) => b.area_ha - a.area_ha)[0];
      if (match === undefined) return null;
      const plume = await ok(api.GET("/api/plumes/{plume_id}", { params: { path: { plume_id: match.id } }, signal }));
      return plume.evidence_image_url;
    },
  });
}

/** Pending tasks, counted from the task list so this block doesn't depend on /api/stats. */
export function usePendingSamplingQuery() {
  return useQuery({
    queryKey: ["sampling-tasks", "pending"],
    queryFn: ({ signal }) =>
      ok(
        api.GET("/api/sampling-tasks", {
          params: { query: { status: "pending_approval", limit: MAX_TASKS } },
          signal,
        }),
      ),
  });
}

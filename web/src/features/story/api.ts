import { useQuery } from "@tanstack/react-query";
import { api } from "../../shared/api/client";

async function ok<T>(request: Promise<{ data?: T; response: Response }>): Promise<T> {
  const { data, response } = await request;
  if (!response.ok || data === undefined) throw new Error(`API returned ${response.status}`);
  return data;
}

/**
 * Live facts for one story, found by place and date (ids differ between databases): the largest
 * plume that day, with its area, rain, coordinates, evidence crop and latest agent decision.
 * Cached per story, so the gallery card and the detail page share one request.
 */
export function useStoryPlumeQuery(place: string, date: string) {
  return useQuery({
    queryKey: ["story", place, date],
    queryFn: async ({ signal }) => {
      const matches = await ok(
        api.GET("/api/plumes", { params: { query: { place, from: date, to: date, limit: 5 } }, signal }),
      );
      const match = [...matches].sort((a, b) => b.area_ha - a.area_ha)[0];
      if (match === undefined) return null;
      return ok(api.GET("/api/plumes/{plume_id}", { params: { path: { plume_id: match.id } }, signal }));
    },
  });
}

export type StoryPlume = NonNullable<ReturnType<typeof useStoryPlumeQuery>["data"]>;

/**
 * The sampling task proposed for a plume, if any. Kept apart so a failure here never hides the plume.
 * Sampling tasks are researcher data, so callers pass `enabled` only when it is needed and allowed.
 */
export function useStoryTaskQuery(plumeId: number | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["story", "sampling-tasks"],
    queryFn: ({ signal }) => ok(api.GET("/api/sampling-tasks", { params: { query: { limit: 200 } }, signal })),
    enabled: enabled && plumeId !== undefined,
    select: (tasks) => tasks.find((task) => task.event_id === plumeId) ?? null,
  });
}

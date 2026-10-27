// Small reads the map page needs besides the plume GeoJSON: rain for the preview card and data freshness.
import { useQuery } from "@tanstack/react-query";
import { api } from "../../shared/api/client";

async function ok<T>(request: Promise<{ data?: T; response: Response }>): Promise<T> {
  const { data, response } = await request;
  if (!response.ok || data === undefined) throw new Error(`API returned ${response.status}`);
  return data;
}

/** Full plume record (for rain_3d_mm). Same key as the plume page, so opening the plume reuses it. */
export function usePlumeRainQuery(id: number | null) {
  return useQuery({
    queryKey: ["plumes", "detail", id ?? -1] as const,
    enabled: id !== null,
    queryFn: ({ signal }) =>
      ok(api.GET("/api/plumes/{plume_id}", { params: { path: { plume_id: id ?? -1 } }, signal })),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

/** Date of the newest clear Sentinel-2 pass the scan analysed. */
export function useLastSceneDateQuery() {
  return useQuery({
    queryKey: ["stats"],
    queryFn: ({ signal }) => ok(api.GET("/api/stats", { signal })),
    select: (stats) => stats.last_scene_date,
    staleTime: 5 * 60 * 1000,
  });
}

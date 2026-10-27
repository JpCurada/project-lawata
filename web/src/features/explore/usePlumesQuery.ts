import { useQuery } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { MAX_PLUMES, type PlumeCollection } from "./plumes";

export const plumesQueryKey = ["plumes", "geojson"] as const;

export function usePlumesQuery() {
  return useQuery({
    queryKey: plumesQueryKey,
    queryFn: async ({ signal }): Promise<PlumeCollection> => {
      const { data, response } = await api.GET("/api/plumes.geojson", {
        params: { query: { limit: MAX_PLUMES } },
        signal,
      });
      if (!response.ok || data === undefined) throw new Error(`API returned ${response.status}`);
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

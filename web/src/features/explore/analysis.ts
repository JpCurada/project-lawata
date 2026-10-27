import { useMutation } from "@tanstack/react-query";
import { api, throwIfAuthError } from "../../shared/api/client";
import type { AreaAnalysis, AreaIn } from "../../shared/api/types";

export type { AreaAnalysis } from "../../shared/api/types";

/** A drawn rectangle in WGS84 degrees. */
export type AreaBox = Omit<AreaIn, "date">;

export const MAX_SIDE_KM = 5;
const KM_PER_DEGREE = 111.32;

/** Box from any two opposite corners ([lng, lat]). */
export function boxFromCorners(a: [number, number], b: [number, number]): AreaBox {
  return {
    west: Math.min(a[0], b[0]),
    south: Math.min(a[1], b[1]),
    east: Math.max(a[0], b[0]),
    north: Math.max(a[1], b[1]),
  };
}

/** [width, height] in km, measured at the box center latitude (same as the API). */
export function boxSidesKm(box: AreaBox): [number, number] {
  const midLat = ((box.south + box.north) / 2) * (Math.PI / 180);
  return [(box.east - box.west) * KM_PER_DEGREE * Math.cos(midLat), (box.north - box.south) * KM_PER_DEGREE];
}

export function isBoxTooBig(box: AreaBox): boolean {
  return Math.max(...boxSidesKm(box)) > MAX_SIDE_KM;
}

/** The API's plain message (422/502/503), when it sent one. */
export class AnalysisError extends Error {}

/** Researcher only. The agent runs synchronously, so this can take up to a minute. */
export function useAnalyzeAreaMutation() {
  return useMutation({
    mutationFn: async (box: AreaBox): Promise<AreaAnalysis> => {
      const { data, error, response } = await api.POST("/api/analyses", { body: box });
      throwIfAuthError(response);
      if (data !== undefined) return data;
      const detail = (error as { detail?: unknown } | undefined)?.detail;
      throw new AnalysisError(typeof detail === "string" ? detail : "The agent could not finish. Try again in a minute.");
    },
  });
}

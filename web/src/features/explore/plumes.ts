// Plume sightings for the map, typed from GET /api/plumes.geojson (shared/api/schema.ts).
import type { components } from "../../shared/api/schema";

type SchemaFeature = components["schemas"]["PlumeFeature"];

export type PlumeSummary = components["schemas"]["PlumeSummaryOut"];
// openapi-fetch widens the `[lon, lat]` tuple to number[], so accept either.
export type PlumeFeature = Omit<SchemaFeature, "geometry"> & {
  geometry: { type: "Point"; coordinates: number[] };
};
export interface PlumeCollection {
  type: "FeatureCollection";
  features: PlumeFeature[];
}

// The backend caps one page at 500; ask for all of them (Laguna de Bay has far fewer).
export const MAX_PLUMES = 500;

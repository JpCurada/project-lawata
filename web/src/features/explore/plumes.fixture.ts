// Test-only fixture shaped like GET /api/plumes.geojson.
import type { PlumeCollection, PlumeSummary } from "./plumes";

const feature = (properties: PlumeSummary) => ({
  type: "Feature" as const,
  geometry: { type: "Point" as const, coordinates: [properties.entry_lon, properties.entry_lat] as [number, number] },
  properties,
});

export const plumesFixture: PlumeCollection = {
  type: "FeatureCollection",
  features: [
    feature({ id: 27, date: "2026-05-06", place: "Binangonan", area_ha: 92, kind: "brown", is_dry: true, entry_lat: 14.5016, entry_lon: 121.145 }),
    feature({ id: 30, date: "2026-09-25", place: "Calamba", area_ha: 806, kind: "brown+dark", is_dry: false, entry_lat: 14.2116, entry_lon: 121.1706 }),
    feature({ id: 3, date: "2024-02-11", place: "Lumban", area_ha: 33, kind: "dark", is_dry: true, entry_lat: 14.27, entry_lon: 121.45 }),
  ],
};

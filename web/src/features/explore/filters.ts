import type { PlumeFeature } from "./plumes";

export interface PlumeFilters {
  /** Inclusive ISO dates (YYYY-MM-DD), or null for open-ended. */
  from: string | null;
  to: string | null;
  place: string | null;
  dryOnly: boolean;
}

export const emptyFilters: PlumeFilters = { from: null, to: null, place: null, dryOnly: false };

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string | null): string | null {
  if (value === null || !isoDatePattern.test(value)) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

/** Reads filters from URL search params; invalid values are ignored. */
export function parseFilters(params: URLSearchParams): PlumeFilters {
  const place = params.get("place");
  return {
    from: validDate(params.get("from")),
    to: validDate(params.get("to")),
    place: place !== null && place.trim() !== "" ? place : null,
    dryOnly: params.get("dry") === "1",
  };
}

/** Writes filters as URL search params, omitting defaults so URLs stay short. */
export function filtersToParams(filters: PlumeFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.from !== null) params.set("from", filters.from);
  if (filters.to !== null) params.set("to", filters.to);
  if (filters.place !== null) params.set("place", filters.place);
  if (filters.dryOnly) params.set("dry", "1");
  return params;
}

export function activeFilterCount(filters: PlumeFilters): number {
  const set = [filters.from !== null, filters.to !== null, filters.place !== null, filters.dryOnly];
  return set.filter(Boolean).length;
}

export function applyFilters(features: readonly PlumeFeature[], filters: PlumeFilters): PlumeFeature[] {
  return features.filter(({ properties: plume }) => {
    // ISO dates compare correctly as strings.
    if (filters.from !== null && plume.date < filters.from) return false;
    if (filters.to !== null && plume.date > filters.to) return false;
    if (filters.place !== null && plume.place !== filters.place) return false;
    if (filters.dryOnly && !plume.is_dry) return false;
    return true;
  });
}

export function placesOf(features: readonly PlumeFeature[]): string[] {
  const places = new Set<string>();
  for (const { properties } of features) {
    if (properties.place !== null) places.add(properties.place);
  }
  return [...places].sort((a, b) => a.localeCompare(b));
}

export function dateSpanOf(features: readonly PlumeFeature[]): { min: string; max: string } | null {
  if (features.length === 0) return null;
  let min = features[0].properties.date;
  let max = min;
  for (const { properties } of features) {
    if (properties.date < min) min = properties.date;
    if (properties.date > max) max = properties.date;
  }
  return { min, max };
}

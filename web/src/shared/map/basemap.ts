import type { Theme } from "../theme/ThemeProvider";

// Free, keyless OpenFreeMap styles; their sources carry the OpenStreetMap/OpenMapTiles attribution.
export const basemapStyle: Record<Theme, string> = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

// Laguna de Bay, [west, south], [east, north].
export const lagunaDeBayBounds: [[number, number], [number, number]] = [
  [121.0, 14.15],
  [121.5, 14.55],
];

/** Reads a design token (CSS variable) so map paint matches the current theme. */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

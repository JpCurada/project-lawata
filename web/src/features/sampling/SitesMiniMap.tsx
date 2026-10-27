import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { basemapStyle, cssVar, lagunaDeBayBounds } from "../../shared/map/basemap";
import { useTheme } from "../../shared/theme/ThemeProvider";
import { BlockError } from "../../shared/ui/BlockState";
import type { SamplingTask } from "./api";

type Site = SamplingTask["sites"][number];

function sitesGeoJson(sites: Site[]) {
  return {
    type: "FeatureCollection" as const,
    features: sites.map((site) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [site.lon, site.lat] },
      properties: { label: site.label },
    })),
  };
}

function boundsOf(sites: Site[]): maplibregl.LngLatBoundsLike {
  if (sites.length === 0) return lagunaDeBayBounds;
  const bounds = new maplibregl.LngLatBounds();
  for (const site of sites) bounds.extend([site.lon, site.lat]);
  return bounds;
}

function addSites(map: MapLibreMap, sites: Site[]) {
  if (map.getSource("sites") === undefined) map.addSource("sites", { type: "geojson", data: sitesGeoJson(sites) });
  if (map.getLayer("sites") === undefined) {
    map.addLayer({
      id: "sites",
      type: "circle",
      source: "sites",
      paint: {
        "circle-radius": 7,
        "circle-color": cssVar("--color-primary"),
        "circle-stroke-width": 2,
        "circle-stroke-color": cssVar("--color-surface"),
      },
    });
  }
}

/** Small, non-interactive map of proposed sampling sites. Default export so it can be lazy-loaded. */
export default function SitesMiniMap({ sites }: { sites: Site[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const { theme } = useTheme();
  const themeRef = useRef(theme);
  const sitesRef = useRef(sites);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  sitesRef.current = sites;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const map = new maplibregl.Map({
      container,
      style: basemapStyle[themeRef.current],
      bounds: boundsOf(sitesRef.current),
      fitBoundsOptions: { padding: 40, maxZoom: 14 },
      interactive: false,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.on("style.load", () => addSites(map, sitesRef.current));
    // Only a basemap style failure blanks the map; a missing tile now and then is fine.
    map.on("error", () => {
      if (!map.isStyleLoaded()) setFailed(true);
    });
    // Keep the attribution collapsed to its (i) button so it doesn't cover the small map.
    // MapLibre expands it once the attribution text arrives (after "load"), so collapse on first idle too.
    const collapse = () => container.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
    map.once("load", collapse);
    map.once("idle", collapse);
    // The card can change width after the map is made (fonts, grid, evidence row); keep the canvas filling it.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => map.resize());
    observer?.observe(container);
    return () => {
      observer?.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [attempt]);

  useEffect(() => {
    if (themeRef.current === theme) return;
    themeRef.current = theme;
    mapRef.current?.setStyle(basemapStyle[theme], { diff: false });
  }, [theme]);

  if (failed) {
    return (
      <BlockError
        className="mini-map mini-map--state"
        onRetry={() => {
          setFailed(false);
          setAttempt((value) => value + 1);
        }}
      >
        The map couldn't load. The sites are listed below.
      </BlockError>
    );
  }

  return <div ref={containerRef} className="mini-map" role="img" aria-label={`Map of ${sites.length} proposed sampling sites`} />;
}

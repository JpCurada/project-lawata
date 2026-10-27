import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState, type RefObject } from "react";
import { basemapStyle, cssVar, lagunaDeBayBounds } from "../../shared/map/basemap";
import type { Theme } from "../../shared/theme/ThemeProvider";
import { BlockError } from "../../shared/ui/BlockState";
import { boxFromCorners, type AreaBox } from "./analysis";
import type { PlumeCollection } from "./plumes";

const sourceId = "plumes";
const circleLayerId = "plumes-circle";
const hitLayerId = "plumes-hit";
const selectedLayerId = "plumes-selected";
const areaSourceId = "area";
const areaFillLayerId = "area-fill";
const areaLineLayerId = "area-line";
// A press that moves less than this is a tap (one corner), not a drag.
const dragThresholdPx = 6;

type LngLatPair = [number, number];

function boxFeature(box: AreaBox | null): GeoJSON.FeatureCollection {
  if (box === null) return { type: "FeatureCollection", features: [] };
  const { west, south, east, north } = box;
  const ring = [[west, south], [east, south], [east, north], [west, north], [west, south]];
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }],
  };
}

function addAreaLayers(map: MapLibreMap, box: AreaBox | null) {
  if (map.getSource(areaSourceId) === undefined) {
    map.addSource(areaSourceId, { type: "geojson", data: boxFeature(box) });
  }
  if (map.getLayer(areaFillLayerId) === undefined) {
    map.addLayer({
      id: areaFillLayerId,
      type: "fill",
      source: areaSourceId,
      paint: { "fill-color": cssVar("--color-primary"), "fill-opacity": 0.15 },
    });
  }
  if (map.getLayer(areaLineLayerId) === undefined) {
    map.addLayer({
      id: areaLineLayerId,
      type: "line",
      source: areaSourceId,
      paint: { "line-color": cssVar("--color-primary"), "line-width": 2, "line-dasharray": [2, 1] },
    });
  }
}

// Radius grows with area: sightings range from tens of hectares to ~2,000 ha.
const radiusByArea: maplibregl.ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["sqrt", ["get", "area_ha"]],
  Math.sqrt(25),
  6,
  Math.sqrt(2000),
  26,
];

// Only the selected plume passes this filter; -1 matches none.
const selectedFilter = (id: number | null): maplibregl.FilterSpecification => ["==", ["get", "id"], id ?? -1];

function addPlumeLayers(map: MapLibreMap, data: PlumeCollection, selectedId: number | null) {
  if (map.getSource(sourceId) === undefined) {
    map.addSource(sourceId, { type: "geojson", data });
  }
  if (map.getLayer(circleLayerId) === undefined) {
    map.addLayer({
      id: circleLayerId,
      type: "circle",
      source: sourceId,
      paint: {
        "circle-radius": radiusByArea,
        "circle-color": ["case", ["get", "is_dry"], cssVar("--color-plume-dry"), cssVar("--color-plume-rain")],
        "circle-opacity": 0.75,
        "circle-stroke-width": 1.5,
        "circle-stroke-color": cssVar("--color-plume-stroke"),
      },
    });
  }
  // Selection: the dot redrawn on top of its neighbours, opaque, with a ring in the text colour.
  if (map.getLayer(selectedLayerId) === undefined) {
    map.addLayer({
      id: selectedLayerId,
      type: "circle",
      source: sourceId,
      filter: selectedFilter(selectedId),
      paint: {
        "circle-radius": ["+", radiusByArea, 2],
        "circle-color": ["case", ["get", "is_dry"], cssVar("--color-plume-dry"), cssVar("--color-plume-rain")],
        "circle-stroke-width": 3.5,
        "circle-stroke-color": cssVar("--color-text"),
      },
    });
  }
  // Invisible, larger circles so plumes are easy to tap on phones.
  if (map.getLayer(hitLayerId) === undefined) {
    map.addLayer({
      id: hitLayerId,
      type: "circle",
      source: sourceId,
      paint: { "circle-radius": ["+", radiusByArea, 10], "circle-opacity": 0 },
    });
  }
}

interface PlumeMapProps {
  data: PlumeCollection;
  theme: Theme;
  onSelect: (plumeId: number) => void;
  /** Highlighted plume, if any. */
  selectedId?: number | null;
  /** A tap on empty map (not a plume) while a plume is selected. */
  onDeselect?: () => void;
  /** Overlay (the preview card) that the selected dot should not sit under. */
  coverRef?: RefObject<HTMLElement>;
  /** Draw mode: a drag or two taps draw a box instead of panning or opening plumes. */
  drawing?: boolean;
  area?: AreaBox | null;
  onAreaDrawn?: (box: AreaBox) => void;
}

export function PlumeMap({
  data,
  theme,
  onSelect,
  selectedId = null,
  onDeselect,
  coverRef,
  drawing = false,
  area = null,
  onAreaDrawn,
}: PlumeMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const dataRef = useRef(data);
  const onSelectRef = useRef(onSelect);
  const onDeselectRef = useRef(onDeselect);
  const selectedRef = useRef(selectedId);
  const themeRef = useRef(theme);
  const [failed, setFailed] = useState(false);
  const drawingRef = useRef(drawing);
  const cornerRef = useRef<LngLatPair | null>(null);
  const areaRef = useRef(area);
  const onAreaDrawnRef = useRef(onAreaDrawn);
  dataRef.current = data;
  onSelectRef.current = onSelect;
  onDeselectRef.current = onDeselect;
  selectedRef.current = selectedId;
  drawingRef.current = drawing;
  areaRef.current = area;
  onAreaDrawnRef.current = onAreaDrawn;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const map = new maplibregl.Map({
      container,
      style: basemapStyle[themeRef.current],
      bounds: lagunaDeBayBounds,
      fitBoundsOptions: { padding: 16 },
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    // A basemap style that fails to load leaves nothing to draw on; say so and offer a retry.
    map.on("error", () => {
      if (!map.isStyleLoaded()) setFailed(true);
    });
    map.on("style.load", () => setFailed(false));
    // Runs on first load and after every theme (style) switch, which drops custom layers.
    map.on("style.load", () => {
      addPlumeLayers(map, dataRef.current, selectedRef.current);
      addAreaLayers(map, areaRef.current);
    });

    // Drawing: mouse drag (press, move, release), or two taps/clicks on opposite corners.
    let dragStart: { lngLat: LngLatPair; x: number; y: number } | null = null;
    let skipClick = false;
    const preview = (a: LngLatPair, b: LngLatPair) =>
      map.getSource<GeoJSONSource>(areaSourceId)?.setData(boxFeature(boxFromCorners(a, b)));
    const finish = (a: LngLatPair, b: LngLatPair) => {
      cornerRef.current = null;
      onAreaDrawnRef.current?.(boxFromCorners(a, b));
    };
    map.on("mousedown", (event) => {
      if (!drawingRef.current) return;
      dragStart = { lngLat: event.lngLat.toArray(), x: event.point.x, y: event.point.y };
    });
    map.on("mousemove", (event) => {
      if (!drawingRef.current) return;
      const from = dragStart?.lngLat ?? cornerRef.current;
      if (from !== null) preview(from, event.lngLat.toArray());
    });
    map.on("mouseup", (event) => {
      if (!drawingRef.current || dragStart === null) return;
      const moved = Math.hypot(event.point.x - dragStart.x, event.point.y - dragStart.y);
      if (moved >= dragThresholdPx) {
        finish(dragStart.lngLat, event.lngLat.toArray());
        skipClick = true;
      }
      dragStart = null;
    });
    map.on("click", (event) => {
      if (!drawingRef.current) return;
      if (skipClick) {
        skipClick = false;
        return;
      }
      const here = event.lngLat.toArray();
      if (cornerRef.current === null) {
        cornerRef.current = here;
        preview(here, here);
      } else {
        finish(cornerRef.current, here);
      }
    });

    // A tap on a plume selects it; a tap on empty map clears the selection.
    map.on("click", (event) => {
      if (drawingRef.current || map.getLayer(hitLayerId) === undefined) return;
      const id = map.queryRenderedFeatures(event.point, { layers: [hitLayerId] })[0]?.properties?.id;
      if (typeof id === "number") onSelectRef.current(id);
      else onDeselectRef.current?.();
    });
    map.on("mouseenter", hitLayerId, () => {
      if (!drawingRef.current) map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", hitLayerId, () => {
      if (!drawingRef.current) map.getCanvas().style.cursor = "";
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const source = mapRef.current?.getSource<GeoJSONSource>(sourceId);
    source?.setData(data);
  }, [data]);

  // Highlight the selection, and pan if the dot would sit under the preview card.
  useEffect(() => {
    const map = mapRef.current;
    if (map === null) return;
    if (map.getLayer(selectedLayerId) !== undefined) map.setFilter(selectedLayerId, selectedFilter(selectedId));
    if (selectedId === null) return;
    const feature = dataRef.current.features.find((item) => item.properties.id === selectedId);
    if (feature === undefined) return;
    const frame = requestAnimationFrame(() => {
      const card = coverRef?.current?.getBoundingClientRect();
      const box = map.getContainer().getBoundingClientRect();
      if (card === undefined || card.width === 0) return;
      const [lon, lat] = feature.geometry.coordinates;
      const dot = map.project([lon, lat]);
      const margin = 36;
      const left = card.left - box.left - margin;
      const right = card.right - box.left + margin;
      const top = card.top - box.top - margin;
      const bottom = card.bottom - box.top + margin;
      if (dot.x < left || dot.x > right || dot.y < top || dot.y > bottom) return;
      // Move the dot just above the card if there is room, otherwise just left of it.
      const target = top > 80 ? { x: dot.x, y: top / 2 + margin } : { x: left / 2, y: dot.y };
      map.panBy([dot.x - target.x, dot.y - target.y], { duration: 300 });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedId, coverRef]);

  useEffect(() => {
    mapRef.current?.getSource<GeoJSONSource>(areaSourceId)?.setData(boxFeature(area));
  }, [area]);

  // Panning would fight the drag, so it is off while drawing.
  useEffect(() => {
    const map = mapRef.current;
    if (map === null) return;
    cornerRef.current = null;
    if (drawing) map.dragPan.disable();
    else map.dragPan.enable();
    map.getCanvas().style.cursor = drawing ? "crosshair" : "";
  }, [drawing]);

  useEffect(() => {
    if (themeRef.current === theme) return;
    themeRef.current = theme;
    // diff: false forces a full reload so "style.load" fires and the plume layers are re-added.
    mapRef.current?.setStyle(basemapStyle[theme], { diff: false });
  }, [theme]);

  return (
    <>
      <div ref={containerRef} className="plume-map" role="region" aria-label="Map of plume sightings on Laguna de Bay" />
      {failed && (
        <BlockError
          className="explore__state"
          onRetry={() => mapRef.current?.setStyle(basemapStyle[themeRef.current], { diff: false })}
        >
          The map background couldn't load. Check your connection.
        </BlockError>
      )}
    </>
  );
}

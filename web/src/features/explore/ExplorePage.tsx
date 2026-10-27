import { useCallback, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../shared/auth";
import { useTheme } from "../../shared/theme/ThemeProvider";
import { BlockEmpty, BlockError, BlockLoading } from "../../shared/ui/BlockState";
import { Skeleton } from "../../shared/ui/Skeleton";
import type { AreaBox } from "./analysis";
import { AreaAnalysisPanel } from "./AreaAnalysisPanel";
import { FilterPanel } from "./FilterPanel";
import { Legend } from "./Legend";
import { PlumeMap } from "./PlumeMap";
import { PlumePreview } from "./PlumePreview";
import { useLastSceneDateQuery } from "./exploreQueries";
import {
  activeFilterCount,
  applyFilters,
  dateSpanOf,
  emptyFilters,
  filtersToParams,
  parseFilters,
  placesOf,
  type PlumeFilters,
} from "./filters";
import type { PlumeCollection, PlumeFeature } from "./plumes";
import { usePlumesQuery } from "./usePlumesQuery";
import "./explore.css";

const noFeatures: PlumeFeature[] = [];
// ?plume=27 keeps the selected plume across reloads and shared links.
const plumeParam = "plume";

function parseSelected(params: URLSearchParams): number | null {
  const value = Number(params.get(plumeParam));
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function ExplorePage() {
  const plumes = usePlumesQuery();
  const { isResearcher } = useAuth();
  const [drawing, setDrawing] = useState(false);
  const [area, setArea] = useState<AreaBox | null>(null);
  const { theme } = useTheme();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const selectedParam = parseSelected(searchParams);
  const lastScene = useLastSceneDateQuery();
  const previewRef = useRef<HTMLElement>(null);

  const all = plumes.data?.features ?? noFeatures;
  const places = useMemo(() => placesOf(all), [all]);
  const dateSpan = useMemo(() => dateSpanOf(all), [all]);
  const visible = useMemo<PlumeCollection>(
    () => ({ type: "FeatureCollection", features: applyFilters(all, filters) }),
    [all, filters],
  );

  // Only a plume that is still on the map can be selected (filters may hide it).
  const selected = visible.features.find((feature) => feature.properties.id === selectedParam)?.properties ?? null;

  // Each filter change pushes a history entry, so back/forward steps through filter changes.
  // The selection rides along in the URL but replaces the entry, so it doesn't clutter history.
  const setFilters = useCallback(
    (next: PlumeFilters) =>
      setSearchParams((current) => {
        const params = filtersToParams(next);
        const plume = current.get(plumeParam);
        if (plume !== null) params.set(plumeParam, plume);
        return params;
      }),
    [setSearchParams],
  );
  const clearFilters = useCallback(() => setFilters(emptyFilters), [setFilters]);
  const select = useCallback(
    (id: number | null) =>
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          if (id === null) params.delete(plumeParam);
          else params.set(plumeParam, String(id));
          return params;
        },
        { replace: true },
      ),
    [setSearchParams],
  );
  const selectPlume = useCallback((id: number) => select(id), [select]);
  const closePreview = useCallback(() => select(null), [select]);
  const activeCount = activeFilterCount(filters);
  const startDrawing = useCallback(() => {
    closePreview();
    setDrawing(true);
  }, [closePreview]);
  const stopDrawing = useCallback(() => {
    setDrawing(false);
    setArea(null);
  }, []);

  return (
    <section className="explore">
      <h1 className="visually-hidden">Explore</h1>
      <PlumeMap
        data={visible}
        theme={theme}
        onSelect={selectPlume}
        selectedId={selected?.id ?? null}
        onDeselect={closePreview}
        coverRef={previewRef}
        drawing={drawing}
        area={area}
        onAreaDrawn={setArea}
      />

      <div className="explore__top">
        <FilterPanel
          filters={filters}
          places={places}
          dateSpan={dateSpan}
          activeCount={activeCount}
          onChange={setFilters}
          onClear={clearFilters}
        />
        {isResearcher && !drawing && (
          <AreaAnalysisPanel drawing={false} area={null} onStart={startDrawing} onCancel={stopDrawing} />
        )}
        {plumes.isPending && (
          <BlockLoading className="explore__count" skeleton={<Skeleton width="6.5rem" />}>
            Loading plume sightings...
          </BlockLoading>
        )}
        {plumes.isSuccess && (
          <p className="explore__count" role="status">
            {visible.features.length} of {all.length} plumes
          </p>
        )}
      </div>

      {plumes.isError && (
        <BlockError className="explore__state" onRetry={() => void plumes.refetch()}>
          Can't load plume sightings right now.
        </BlockError>
      )}
      {plumes.isSuccess && visible.features.length === 0 && (
        <BlockEmpty
          className="explore__state"
          action={
            activeCount > 0 ? (
              <button type="button" className="button" onClick={clearFilters}>
                Clear filters
              </button>
            ) : undefined
          }
        >
          {all.length === 0 ? "No plume sightings yet." : "No plumes match these filters."}
        </BlockEmpty>
      )}

      {drawing ? (
        <AreaAnalysisPanel drawing area={area} onStart={startDrawing} onCancel={stopDrawing} />
      ) : (
        <Legend lastSceneDate={lastScene.data ?? null} covered={selected !== null} />
      )}
      {selected !== null && !drawing && (
        <PlumePreview plume={selected} onClose={closePreview} cardRef={previewRef} />
      )}
    </section>
  );
}

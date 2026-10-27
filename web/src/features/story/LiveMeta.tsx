import { formatHa } from "../../shared/format";
import { BlockEmpty, BlockError, BlockLoading } from "../../shared/ui/BlockState";
import { Skeleton } from "../../shared/ui/Skeleton";
import type { StoryPlume, useStoryPlumeQuery } from "./api";

type Live = ReturnType<typeof useStoryPlumeQuery>;

const rainText = (mm: number | null) => (mm === null ? "no rain data for 3 days" : `${mm.toFixed(1)} mm of rain in 3 days`);

/** "92 ha · 1.2 mm of rain in 3 days", from the live record. */
export const liveFacts = (plume: StoryPlume) => `${formatHa(plume.area_ha)} · ${rainText(plume.rain_3d_mm)}`;

/**
 * One quiet line of live numbers, with small loading, error and empty states. `prefix` (e.g. the
 * date) is shown before the numbers once they load, and alone while loading or on error.
 */
export function LiveMeta({ live, prefix, className }: { live: Live; prefix?: string; className: string }) {
  const lead = prefix ? `${prefix} · ` : "";
  if (live.isPending) {
    return (
      <BlockLoading className={`${className} story-live--state`} skeleton={
          <>
            {lead}
            <Skeleton width="12rem" />
          </>
        }
      >
        Loading the live record...
      </BlockLoading>
    );
  }
  if (live.isError) {
    return (
      <BlockError className={`${className} story-live--state`} onRetry={() => void live.refetch()}>
        {lead}
        <span>Can't load the live record right now.</span>
      </BlockError>
    );
  }
  if (live.data === null) {
    return (
      <BlockEmpty className={`${className} story-live--state`}>{lead}Not in the live database, so no numbers yet.</BlockEmpty>
    );
  }
  return (
    <p className={className}>
      {lead}
      {liveFacts(live.data)}
    </p>
  );
}

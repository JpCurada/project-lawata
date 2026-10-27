import { formatDate } from "../../shared/format";

interface LegendProps {
  /** Newest clear Sentinel-2 pass the scan analysed (YYYY-MM-DD), or null if unknown. */
  lastSceneDate: string | null;
  /** On phones the preview card takes the legend's place. */
  covered?: boolean;
}

export function Legend({ lastSceneDate, covered = false }: LegendProps) {
  return (
    <div className={covered ? "legend legend--covered" : "legend"} role="group" aria-label="Map legend">
      <p className="legend__row">
        <span className="legend__dot legend__dot--dry" aria-hidden="true" />
        Dry weather: suspicious, verify
      </p>
      <p className="legend__row">
        <span className="legend__dot legend__dot--rain" aria-hidden="true" />
        After rain: expected runoff
      </p>
      <p className="legend__note">Larger circle, larger plume area</p>
      {lastSceneDate !== null && (
        <p className="legend__fresh">Latest clear Sentinel-2 pass analysed: {formatDate(lastSceneDate)}</p>
      )}
    </div>
  );
}

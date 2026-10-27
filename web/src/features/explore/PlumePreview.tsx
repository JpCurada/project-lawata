import { useEffect, useId, type RefObject } from "react";
import { Link } from "react-router-dom";
import { formatDate, formatHa, formatMm } from "../../shared/format";
import { plumeWeather } from "../../shared/plumeWeather";
import { Arrow } from "../../shared/ui/ArrowLink";
import { CrossIcon } from "../../shared/ui/Icon";
import { usePlumeRainQuery } from "./exploreQueries";
import type { PlumeSummary } from "./plumes";

interface PlumePreviewProps {
  plume: PlumeSummary;
  onClose: () => void;
  /** The map reads the card's box to keep the selected dot out from under it. */
  cardRef: RefObject<HTMLElement>;
}

/** One plain sentence: size first, then whether rain explains it (once the rain figure is in). */
function previewSentence(plume: PlumeSummary, rain: number | null | undefined, artifact: boolean): string {
  const size = `${formatHa(plume.area_ha)} of unusual water`;
  if (artifact) return `${size}. A reviewer marked it as an image artifact, not plume water.`;
  if (rain === undefined) return plume.is_dry ? `${size}, seen in dry weather.` : `${size}, seen after rain.`;
  if (rain === null) return `${size}. No rain data for those days, so we can't tell whether runoff explains it.`;
  if (plume.is_dry) {
    const fell = rain === 0 ? "No rain fell" : `Only ${formatMm(rain)} of rain fell`;
    return `${size}. ${fell} in the 3 days before, so runoff doesn't explain it.`;
  }
  return `${size}. ${formatMm(rain)} of rain in the 3 days before; rivers carry mud into the lake after storms.`;
}

/**
 * Small non-modal card for the selected plume. Focus moves in when it opens and goes back to
 * where it was when it closes; the map stays usable around it.
 */
export function PlumePreview({ plume, onClose, cardRef }: PlumePreviewProps) {
  const titleId = useId();
  const rain = usePlumeRainQuery(plume.id);

  // Remember what had focus before the card opened, and return there when it closes.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (previous !== null && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  // Each newly selected plume moves focus to the card, so screen readers announce it.
  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, [plume.id, cardRef]);

  // Escape closes, unless something inside (e.g. the filter sheet) already handled it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rainMm = rain.isSuccess ? rain.data.rain_3d_mm : undefined;
  const artifact = rain.isSuccess && plumeWeather(rain.data) === "artifact";
  const badge = artifact
    ? "Not a plume: image artifact"
    : plume.is_dry
      ? "Dry weather: suspicious, verify"
      : "After rain: expected runoff";
  const place = plume.place ?? "Unnamed shore";

  return (
    <section
      ref={cardRef}
      className={`plume-preview plume-preview--${plume.is_dry ? "dry" : "rain"}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      <div className="plume-preview__head">
        <h2 id={titleId} className="plume-preview__title">
          {place}
          <span className="plume-preview__date">{formatDate(plume.date)}</span>
        </h2>
        <button type="button" className="plume-preview__close" onClick={onClose} aria-label="Close preview">
          <CrossIcon />
        </button>
      </div>
      <p className="plume-preview__badge">
        <span className="plume-preview__dot" aria-hidden="true" />
        {badge}
      </p>
      <p className="plume-preview__text" aria-live="polite">
        {previewSentence(plume, rainMm, artifact)}
      </p>
      <Link to={`/plumes/${plume.id}`} className="button button--small plume-preview__open">
        Open plume
        <Arrow />
      </Link>
    </section>
  );
}

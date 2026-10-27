import { useState } from "react";
import { Link } from "react-router-dom";
import { plumeWeather } from "../../shared/plumeWeather";
import { BlockEmpty, BlockError, BlockLoading } from "../../shared/ui/BlockState";
import { Skeleton, SkeletonLines } from "../../shared/ui/Skeleton";
import { usePlaceHistoryQuery, type PlumeDetail } from "./api";
import { actionLabel, formatDate, formatDateTime, formatHa, formatMm, statusLabels } from "./labels";

/** Plumes with a sampling step say so publicly; other workflow states only matter to researchers. */
const publicStatuses: ReadonlySet<PlumeDetail["status"]> = new Set(["sampling_pending", "sampling_approved"]);

export function PlumeHeader({ plume }: { plume: PlumeDetail }) {
  const { status } = plume;
  const place = plume.place ?? "Unnamed place";
  const showStatus = plume.viewer === "researcher" || publicStatuses.has(status);
  return (
    <header className="plume-header">
      <p className="plume-header__back">
        <Link to="/explore">Back to the map</Link>
      </p>
      <h1 className="plume-header__title">
        {place}
        {plume.province !== null && <span className="plume-header__province">, {plume.province}</span>}
      </h1>
      <PlumeVerdict plume={plume} />
      <p className="plume-header__meta">
        <span>Seen {formatDate(plume.date)}</span>
        <span>{formatHa(plume.area_ha)}</span>
        {showStatus && (
          <span className="plume-header__status">
            {plume.viewer === "researcher" && <span>Workflow status:</span>}
            <span className={`pill pill--${status}`}>{statusLabels[status]}</span>
          </span>
        )}
      </p>
    </header>
  );
}

/** The first thing a reader sees: was it dry (suspicious) or after rain (expected runoff)? */
export function PlumeVerdict({ plume }: { plume: PlumeDetail }) {
  const rain = plume.rain_3d_mm;
  const weather = plumeWeather(plume);
  let tone: "dry" | "rain" | "unknown";
  let badge: string;
  let sentence: string;
  if (weather === "artifact") {
    tone = "unknown";
    badge = "Not a plume";
    sentence = "A reviewer marked this as an image artifact (cloud edge, haze or glint), not plume water.";
  } else if (rain === null) {
    tone = "unknown";
    badge = "No rain data";
    sentence = "No rain data for these days, so we can't tell whether runoff explains it.";
  } else if (weather === "dry") {
    tone = "dry";
    badge = "Dry weather";
    const fell = rain === 0 ? "No rain fell" : `Only ${formatMm(rain)} of rain fell`;
    sentence = `Suspicious, verify. ${fell} in the 3 days before, so runoff doesn't explain it.`;
  } else {
    tone = "rain";
    badge = "After rain";
    sentence = `Expected runoff. ${formatMm(rain)} of rain fell in the 3 days before; rivers carry mud into the lake after storms.`;
  }
  return (
    <p className={`plume-verdict plume-verdict--${tone}`}>
      <span className="plume-verdict__badge">
        {badge}
        <span className="visually-hidden">:</span>
      </span>{" "}
      <span className="plume-verdict__text">{sentence}</span>
    </p>
  );
}

export function EvidenceImage({ plume }: { plume: PlumeDetail }) {
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  const url = plume.evidence_image_url;
  const alt = `Sentinel-2 crop of the plume at ${plume.place ?? "this place"} on ${formatDate(plume.date)}`;

  return (
    <section className="card" aria-labelledby="evidence-heading">
      <h2 id="evidence-heading" className="card__title">
        Evidence
      </h2>
      {url === null ? (
        <p className="evidence__fallback">No evidence image yet for this plume.</p>
      ) : (
        <div className={`evidence evidence--${state}`}>
          {state !== "error" && (
            <img
              className="content-img evidence__img"
              src={url}
              alt={alt}
              loading="lazy"
              onLoad={() => setState("loaded")}
              onError={() => setState("error")}
            />
          )}
          {state === "loading" && (
            <p className="evidence__fallback" role="status">
              Loading image...
            </p>
          )}
          {state === "error" && <p className="evidence__fallback">The evidence image could not be loaded.</p>}
        </div>
      )}
      {url !== null && state !== "error" && <EvidenceLegend />}
    </section>
  );
}

/** Matches the marks drawn by detection `inspect_window`: red plume outline, yellow cloud buffer, white cross. */
function EvidenceLegend() {
  return (
    <ul className="evidence-legend" aria-label="What the marks on the image mean">
      <li>
        <span className="evidence-legend__mark evidence-legend__mark--plume" aria-hidden="true" />
        <span>
          <strong>Red outline:</strong> the plume.
        </span>
      </li>
      <li>
        <span className="evidence-legend__mark evidence-legend__mark--cloud" aria-hidden="true" />
        <span>
          <strong>Yellow outline:</strong> cloud and shadow zone, ignored.
        </span>
      </li>
      <li>
        <span className="evidence-legend__mark evidence-legend__mark--point" aria-hidden="true">
          +
        </span>
        <span>
          <strong>White cross:</strong> where the water enters the lake.
        </span>
      </li>
    </ul>
  );
}

export function RainCard({ plume }: { plume: PlumeDetail }) {
  return (
    <section className="card" aria-labelledby="rain-heading">
      <h2 id="rain-heading" className="card__title">
        Rain before this image
      </h2>
      <dl className="rain">
        <div className="rain__item">
          <dt>Last 3 days</dt>
          <dd>{formatMm(plume.rain_3d_mm)}</dd>
        </div>
        <div className="rain__item">
          <dt>Last 7 days</dt>
          <dd>{formatMm(plume.rain_7d_mm)}</dd>
        </div>
      </dl>
      <p className="card__note">Rain at this place in the days before the satellite pass.</p>
    </section>
  );
}

export function PlaceHistory({ plume }: { plume: PlumeDetail }) {
  const history = usePlaceHistoryQuery(plume.place);

  let body;
  if (plume.place === null) {
    body = <BlockEmpty>No place is recorded for this plume, so there is no history to compare.</BlockEmpty>;
  } else if (history.isPending) {
    body = (
      <BlockLoading
        skeleton={
          <div className="timeline">
            {[0, 1, 2].map((key) => (
              <div key={key} className="timeline__item">
                <Skeleton shape="circle" width="0.875rem" height="0.875rem" className="timeline__dot" />
                <span className="timeline__link">
                  <Skeleton width="7rem" />
                  <Skeleton width="10rem" height="0.7rem" />
                </span>
              </div>
            ))}
          </div>
        }
      >
        Loading history...
      </BlockLoading>
    );
  } else if (history.isError) {
    body = <BlockError onRetry={() => void history.refetch()}>Can't load the history right now.</BlockError>;
  } else if (history.data.length <= 1) {
    body = <BlockEmpty>No other plumes seen at {plume.place}.</BlockEmpty>;
  } else {
    body = (
      <ol className="timeline">
        {history.data.map((item) => {
          const current = item.id === plume.id;
          return (
            <li key={item.id} className={current ? "timeline__item timeline__item--current" : "timeline__item"}>
              <span
                className={item.is_dry ? "timeline__dot timeline__dot--dry" : "timeline__dot timeline__dot--rain"}
                aria-hidden="true"
              />
              <Link to={`/plumes/${item.id}`} className="timeline__link" aria-current={current ? "page" : undefined}>
                <span className="timeline__date">{formatDate(item.date)}</span>
                <span className="timeline__meta">
                  {formatHa(item.area_ha)} · {item.is_dry ? "Dry weather" : "After rain"}
                  {current && " · this plume"}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <section className="card" aria-labelledby="history-heading">
      <h2 id="history-heading" className="card__title">
        History at {plume.place ?? "this place"}
      </h2>
      {body}
    </section>
  );
}

export function AgentDecisionCard({ plume }: { plume: PlumeDetail }) {
  const decision = plume.latest_decision;
  return (
    <section className="card" aria-labelledby="decision-heading">
      <h2 id="decision-heading" className="card__title">
        Agent decision
      </h2>
      {decision === null ? (
        <BlockEmpty>Not yet triaged.</BlockEmpty>
      ) : (
        <>
          <p className="decision__action">{actionLabel(decision.action)}</p>
          <p className="decision__reason">{decision.reason}</p>
          <p className="card__note">{formatDateTime(decision.created_at)}</p>
        </>
      )}
    </section>
  );
}

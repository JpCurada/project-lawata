import { useEffect, useMemo, useState } from "react";
import { readTrace } from "../../shared/agentTrace";
import { ResearcherAccessError } from "../../shared/api/client";
import { AgentRun } from "../../shared/ui/AgentRun";
import { AnalysisError, MAX_SIDE_KM, boxSidesKm, isBoxTooBig, useAnalyzeAreaMutation, type AreaAnalysis, type AreaBox } from "./analysis";

interface AreaAnalysisPanelProps {
  drawing: boolean;
  area: AreaBox | null;
  onStart: () => void;
  onCancel: () => void;
}

// Legend matches the marks inspect_window draws in api/src/lawata/detection/service.py.
function CropLegend() {
  return (
    <ul className="area-panel__legend" aria-label="What the marks mean">
      <li>
        <span className="area-panel__swatch area-panel__swatch--plume" aria-hidden="true" />
        Plume
      </li>
      <li>
        <span className="area-panel__swatch area-panel__swatch--cloud" aria-hidden="true" />
        Cloud buffer
      </li>
      <li>
        <span className="area-panel__cross" aria-hidden="true">
          +
        </span>
        Box center
      </li>
    </ul>
  );
}

function SatelliteImage({ cropUrl, cropKind }: { cropUrl: string; cropKind: AreaAnalysis["crop_kind"] }) {
  const [failed, setFailed] = useState(false);

  // Presigned links expire; say so instead of showing a broken image.
  if (failed) {
    return <p className="area-panel__meta">Satellite picture not available.</p>;
  }
  const marked = cropKind === "inspection";

  return (
    <figure className="area-panel__figure">
      <div className={`area-panel__frame${marked ? " area-panel__frame--marked" : ""}`}>
        <img
          src={cropUrl}
          alt={marked ? "10 m crop with the marks the agent looked at" : "True-color Sentinel-2 picture of the box"}
          onError={() => setFailed(true)}
        />
        {marked && <CropLegend />}
      </div>
      <figcaption className="area-panel__caption">
        {marked ? "What the agent marked on the 10 m crop" : "Sentinel-2 picture of your box"}
      </figcaption>
    </figure>
  );
}

/** The picture and pass date; the steps and decision are in AgentRun. */
function Result({ result }: { result: AreaAnalysis }) {
  if (result.status === "no_clear_pass") {
    return <p role="status">No clear Sentinel-2 pass over this box in the last 30 days, so the agent did not run.</p>;
  }
  const inspected = result.trace.some((step) => step.tool === "inspect_plume");
  return (
    <div className="area-panel__result">
      {result.crop_url !== null ? (
        <SatelliteImage key={result.crop_url} cropUrl={result.crop_url} cropKind={result.crop_kind} />
      ) : (
        inspected && <p className="area-panel__meta">Satellite picture not available.</p>
      )}
      {result.acquired_date && <p className="area-panel__meta">Sentinel-2 pass of {result.acquired_date}</p>}
    </div>
  );
}

export function AreaAnalysisPanel({ drawing, area, onStart, onCancel }: AreaAnalysisPanelProps) {
  const mutation = useAnalyzeAreaMutation();
  const { reset } = mutation;
  const result = mutation.data;
  const outcome = useMemo(
    () => (result?.status === "investigated" ? readTrace(result.trace, result.action, result.reason) : null),
    [result],
  );

  // A new box means the shown result no longer applies.
  useEffect(() => reset(), [area, reset]);

  if (!drawing) {
    return (
      <button
        type="button"
        className="button area-panel__start"
        onClick={() => {
          mutation.reset();
          onStart();
        }}
      >
        Analyze an area
      </button>
    );
  }

  const [widthKm, heightKm] = area ? boxSidesKm(area) : [0, 0];
  const tooBig = area !== null && isBoxTooBig(area);
  const close = () => {
    mutation.reset();
    onCancel();
  };

  return (
    <section className="area-panel" aria-label="Analyze an area">
      <div className="area-panel__body">
        {mutation.isPending && <span className="skeleton area-panel__frame area-panel__frame--loading" aria-hidden="true" />}
        {area === null && <p>Drag a box on the lake, or tap two opposite corners.</p>}
        {area !== null && (
          <p className={tooBig ? "inline-error" : "area-panel__meta"} role={tooBig ? "alert" : undefined}>
            Box {widthKm.toFixed(1)} × {heightKm.toFixed(1)} km
            {tooBig && `. Keep each side under ${MAX_SIDE_KM} km; draw again.`}
          </p>
        )}

        {area !== null && (mutation.isPending || outcome !== null) && (
          <AgentRun
            title={`Box ${widthKm.toFixed(1)} × ${heightKm.toFixed(1)} km`}
            model={result?.model}
            running={mutation.isPending}
            outcome={outcome}
            workingLabel="Investigating (up to a minute)"
          />
        )}
        {mutation.isError && (
          <p className="inline-error" role="alert">
            {mutation.error instanceof AnalysisError
              ? mutation.error.message
              : mutation.error instanceof ResearcherAccessError
                ? "Researcher access required"
                : "Can't reach the agent right now. Try again."}
          </p>
        )}
        {mutation.isSuccess && <Result result={mutation.data} />}
      </div>

      <div className="area-panel__buttons">
        {area !== null && !tooBig && !mutation.isSuccess && (
          <button
            type="button"
            className="button button--small"
            disabled={mutation.isPending}
            aria-busy={mutation.isPending}
            onClick={() => mutation.mutate(area)}
          >
            {mutation.isError ? "Try again" : "Analyze"}
          </button>
        )}
        <button type="button" className="button button--ghost button--small" onClick={close} disabled={mutation.isPending}>
          {mutation.isSuccess ? "Done" : "Cancel"}
        </button>
      </div>
    </section>
  );
}

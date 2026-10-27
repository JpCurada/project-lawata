import { lazy, Suspense, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../shared/auth";
import { plumeWeather } from "../../shared/plumeWeather";
import { BlockError, BlockLoading } from "../../shared/ui/BlockState";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { ErrorBoundary } from "../../shared/ui/ErrorBoundary";
import { Skeleton } from "../../shared/ui/Skeleton";
import { useTaskPlumeQuery, type Decision, type DecideVariables, type PlumeDetail, type SamplingTask } from "./api";
import { statusLabels } from "./grouping";

// Lazy so MapLibre loads only when a card with sites is shown.
const SitesMiniMap = lazy(() => import("./SitesMiniMap"));

// Same limits as the API's decision body (docs/auth-contract.md): note 3-500 chars, trimmed.
const NOTE_MIN = 3;
const NOTE_MAX = 500;

const dateFormat = new Intl.DateTimeFormat("en-PH", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
const dateTimeFormat = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });
const areaFormat = new Intl.NumberFormat("en-PH", { maximumFractionDigits: 0 });
const formatDate = (isoDate: string) => dateFormat.format(new Date(`${isoDate}T00:00:00Z`));

const siteLabel = (label: string) => label.replace(/_/g, " ");
const sitesPhrase = (count: number) => `${count} site${count === 1 ? "" : "s"}`;

/** One sentence: what was seen, where and when, before any numbers or coordinates. */
export function taskStory(task: SamplingTask, plume: PlumeDetail | undefined): string {
  const place = task.place ?? "an unnamed place";
  const when = task.plume_date !== null ? ` on ${formatDate(task.plume_date)}` : "";
  if (plume === undefined) return `A plume was seen at ${place}${when}.`;
  const weather = {
    dry: " in dry weather",
    rain: " after rain",
    artifact: ", later reviewed as an image artifact",
    unknown: "",
  }[plumeWeather(plume)];
  return `A ${areaFormat.format(plume.area_ha)} ha plume was seen at ${place}${when}${weather}.`;
}

interface FieldErrors {
  note?: string;
}

function validate(note: string): FieldErrors {
  const errors: FieldErrors = {};
  if (note.trim().length < NOTE_MIN) errors.note = "Add a note explaining your decision.";
  else if (note.trim().length > NOTE_MAX) errors.note = `Keep the note under ${NOTE_MAX} characters.`;
  return errors;
}

function Evidence({ task, plume, loading }: { task: SamplingTask; plume: PlumeDetail | undefined; loading: boolean }) {
  const crop = plume?.evidence_image_url ?? null;
  return (
    <div className="task-card__evidence">
      {loading ? (
        <Skeleton shape="block" className="task-card__thumb" />
      ) : crop !== null ? (
        <img
          className="task-card__thumb"
          src={crop}
          alt={`Satellite crop of the plume at ${task.place ?? "this place"}`}
          width={96}
          height={96}
          loading="lazy"
        />
      ) : (
        <span className="task-card__thumb task-card__thumb--none">No crop yet</span>
      )}
      <div className="task-card__evidence-text">
        <span className="card__note">Sentinel-2 evidence, 10 m</span>
        <Link className="task-card__evidence-link" to={`/plumes/${task.event_id}`}>
          See the plume and its history
        </Link>
      </div>
    </div>
  );
}

interface TaskCardProps {
  task: SamplingTask;
  busy: boolean;
  onDecide: (variables: DecideVariables) => void;
}

export function TaskCard({ task, busy, onDecide }: TaskCardProps) {
  const [decision, setDecision] = useState<Decision | null>(null);
  const [confirming, setConfirming] = useState(false);
  const { user } = useAuth();
  const reviewer = user?.username ?? "your account";
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  // Set synchronously so a fast double tap can't send twice before the mutation state updates.
  const [submitted, setSubmitted] = useState(false);
  const noteId = useId();
  const hintId = useId();
  const errorId = useId();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const approveRef = useRef<HTMLButtonElement>(null);
  const rejectRef = useRef<HTMLButtonElement>(null);
  // Which button to return focus to after Cancel, so keyboard users don't land on <body>.
  const returnFocus = useRef<Decision | null>(null);
  const pending = task.status === "pending_approval";
  const plume = useTaskPlumeQuery(task.event_id, { enabled: pending });
  const place = task.place ?? "Unnamed place";
  const plumeLabel = task.plume_date !== null ? `${place}, ${formatDate(task.plume_date)}` : place;
  const sites = sitesPhrase(task.sites.length);

  useEffect(() => {
    if (decision !== null) {
      noteRef.current?.focus();
    } else if (returnFocus.current !== null) {
      (returnFocus.current === "approve" ? approveRef : rejectRef).current?.focus();
      returnFocus.current = null;
    }
  }, [decision]);

  const startDecision = (next: Decision) => {
    setDecision(next);
    setErrors({});
    setConfirming(false);
  };

  const cancel = () => {
    returnFocus.current = decision;
    setDecision(null);
    setConfirming(false);
    setErrors({});
  };

  const onReview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = validate(note);
    setErrors(found);
    if (Object.keys(found).length === 0) setConfirming(true);
    else noteRef.current?.focus();
  };

  const confirm = () => {
    if (decision === null || busy || submitted) return;
    setSubmitted(true);
    onDecide({ task, decision, review: { note: note.trim() }, reviewer });
  };

  return (
    <article className={`task-card task-card--${task.status}`} aria-labelledby={`task-${task.id}`}>
      <header className="task-card__header">
        <h3 id={`task-${task.id}`} className="task-card__title">
          <Link to={`/plumes/${task.event_id}`}>{plumeLabel}</Link>
        </h3>
        <span className={`pill pill--${task.status}`}>{statusLabels[task.status]}</span>
      </header>

      <p className="task-card__story">{taskStory(task, plume.data)}</p>
      {task.requested_reason !== null && (
        <p className="task-card__reason">
          <span className="task-card__reason-label">Why sample: </span>
          {task.requested_reason}
        </p>
      )}

      {pending && <Evidence task={task} plume={plume.data} loading={plume.isPending} />}

      {task.sites.length > 0 ? (
        <>
          <ErrorBoundary
            fallback={(reset) => (
              <BlockError className="mini-map mini-map--state" onRetry={reset}>
                The map couldn't load. The sites are listed below.
              </BlockError>
            )}
          >
            <Suspense fallback={<BlockLoading skeleton={<Skeleton shape="block" className="mini-map" />}>Loading map...</BlockLoading>}>
              <SitesMiniMap sites={task.sites} />
            </Suspense>
          </ErrorBoundary>
          <ul className="task-card__sites" aria-label="Proposed sampling sites">
            {task.sites.map((site) => (
              <li key={`${site.label}-${site.lon}-${site.lat}`}>
                <span className="task-card__site-label">{siteLabel(site.label)}</span>{" "}
                {site.lat.toFixed(4)} N, {site.lon.toFixed(4)} E
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="card__note">No sampling sites proposed.</p>
      )}

      {!pending && task.reviewed_by !== null && (
        <p className="task-card__review">
          {statusLabels[task.status]} by {task.reviewed_by}
          {task.reviewed_at !== null && ` · ${dateTimeFormat.format(new Date(task.reviewed_at))}`}
          {task.review_note !== null && <span className="task-card__note">“{task.review_note}”</span>}
        </p>
      )}

      {pending && (
        <p className="task-card__consequence">
          Approving asks a field team to take water samples at {sites} near {place}. Rejecting closes the task with no
          field visit.
        </p>
      )}

      {pending && decision === null && (
        <div className="task-card__actions">
          <button ref={approveRef} type="button" className="button" onClick={() => startDecision("approve")} disabled={busy}>
            Approve...
          </button>
          <button ref={rejectRef} type="button" className="button button--ghost" onClick={() => startDecision("reject")} disabled={busy}>
            Reject...
          </button>
        </div>
      )}

      {pending && decision !== null && (
        <form className="task-card__form" onSubmit={onReview} noValidate aria-label={`${decision === "approve" ? "Approve" : "Reject"} task`}>
          <div className="field">
            <label className="field__label" htmlFor={noteId}>
              Note
            </label>
            <span id={hintId} className="card__note">
              {decision === "approve"
                ? "What should the field team know? Kept with the task."
                : "Why no field visit? Kept with the task."}
            </span>
            <textarea
              ref={noteRef}
              id={noteId}
              className="field__input"
              rows={3}
              value={note}
              aria-invalid={errors.note !== undefined}
              aria-describedby={errors.note !== undefined ? `${hintId} ${errorId}` : hintId}
              onChange={(event) => setNote(event.target.value)}
            />
            {errors.note && (
              <span id={errorId} className="field__error">
                {errors.note}
              </span>
            )}
          </div>
          <p className="recorded-as">
            Recorded as <strong>{reviewer}</strong>
          </p>
          <div className="task-card__actions">
            <button type="button" className="button button--ghost" onClick={cancel}>
              Cancel
            </button>
            <button type="submit" className="button" disabled={busy}>
              Review {decision === "approve" ? "approval" : "rejection"}
            </button>
          </div>
        </form>
      )}

      {pending && decision !== null && confirming && (
        <ConfirmDialog
          title={decision === "approve" ? "Approve field sampling?" : "Reject field sampling?"}
          confirmLabel={decision === "approve" ? "Yes, approve" : "Yes, reject"}
          busy={busy || submitted}
          onConfirm={confirm}
          onCancel={() => setConfirming(false)}
        >
          {decision === "approve" ? (
            <p>
              A field team will be asked to take water samples at {sites} near <strong>{place}</strong>
              {task.plume_date !== null && `, where a plume was seen on ${formatDate(task.plume_date)}`}. The task moves to
              Approved, recorded as approved by <strong>{reviewer}</strong> with your note. This can't be undone here.
            </p>
          ) : (
            <p>
              No field sampling is planned at <strong>{place}</strong>
              {task.plume_date !== null && ` for the plume seen on ${formatDate(task.plume_date)}`}. The task moves to
              Rejected, recorded as rejected by <strong>{reviewer}</strong> with your note. This can't be undone here.
            </p>
          )}
          <p className="card__note">Your note: “{note.trim()}”</p>
        </ConfirmDialog>
      )}
    </article>
  );
}

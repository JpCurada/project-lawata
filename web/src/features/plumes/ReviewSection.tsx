import { useId, useState, type FormEvent } from "react";
import { ResearcherAccessRequired, useAuth } from "../../shared/auth";
import { ResearcherAccessError } from "../../shared/api/client";
import { BlockEmpty, BlockError, BlockLoading } from "../../shared/ui/BlockState";
import { Skeleton, SkeletonLines } from "../../shared/ui/Skeleton";
import { ApiValidationError, useCreateReviewMutation, useReviewsQuery, verdicts, type Verdict } from "./api";
import { formatDateTime, verdictLabel, verdictLabels } from "./labels";

const MIN_REASON = 3;
const MAX_REASON = 500;

interface FieldErrors {
  verdict?: string;
  reason?: string;
}

function validate(verdict: Verdict | null, reason: string): FieldErrors {
  const errors: FieldErrors = {};
  if (verdict === null) errors.verdict = "Choose a verdict.";
  const trimmed = reason.trim();
  if (trimmed.length < MIN_REASON) errors.reason = "Add a short note on what you saw.";
  else if (trimmed.length > MAX_REASON) errors.reason = `Keep the note under ${MAX_REASON} characters.`;
  return errors;
}

function ReviewForm({ plumeId }: { plumeId: number }) {
  const mutation = useCreateReviewMutation(plumeId);
  const { user } = useAuth();
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saved, setSaved] = useState(false);
  const reasonId = useId();

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutation.isPending) return;
    const found = validate(verdict, reason);
    setErrors(found);
    setSaved(false);
    if (verdict === null || Object.keys(found).length > 0) return;
    mutation.mutate(
      { verdict, reason: reason.trim() },
      {
        onSuccess: () => {
          setVerdict(null);
          setReason("");
          setSaved(true);
        },
      },
    );
  };

  const serverError = mutation.error;

  return (
    <form className="review-form" onSubmit={onSubmit} noValidate aria-label="Add a review">
      <fieldset className="review-form__verdicts" aria-describedby={errors.verdict ? "verdict-error" : undefined}>
        <legend className="field__label">Verdict</legend>
        {verdicts.map((value) => (
          <label key={value} className="check">
            <input
              type="radio"
              name="verdict"
              className="check__input"
              value={value}
              checked={verdict === value}
              onChange={() => setVerdict(value)}
            />
            <span>{verdictLabels[value]}</span>
          </label>
        ))}
        {errors.verdict && (
          <p id="verdict-error" className="field__error">
            {errors.verdict}
          </p>
        )}
      </fieldset>

      <label className="field" htmlFor={reasonId}>
        <span className="field__label">Note</span>
        <textarea
          id={reasonId}
          className="field__input review-form__note"
          value={reason}
          maxLength={MAX_REASON + 50}
          rows={3}
          aria-invalid={errors.reason !== undefined}
          onChange={(event) => setReason(event.target.value)}
        />
        {errors.reason && <span className="field__error">{errors.reason}</span>}
      </label>

      <p className="recorded-as">
        Recorded as <strong>{user?.username ?? "your account"}</strong>
      </p>

      {serverError !== null && (
        <p className="inline-error" role="alert">
          {serverError instanceof ApiValidationError
            ? serverError.message
            : serverError instanceof ResearcherAccessError
              ? "Researcher access required"
              : "Can't save the review right now. Try again."}
        </p>
      )}
      {saved && (
        <p className="field__ok" role="status">
          Review saved.
        </p>
      )}

      <button type="submit" className="button" disabled={mutation.isPending} aria-busy={mutation.isPending}>
        {mutation.isPending ? "Saving..." : "Save review"}
      </button>
    </form>
  );
}

export function ReviewSection({ plumeId }: { plumeId: number }) {
  const reviews = useReviewsQuery(plumeId);

  let list;
  if (reviews.isPending) {
    list = (
      <BlockLoading
        skeleton={
          <div className="reviews">
            {[0, 1].map((key) => (
              <div key={key} className="reviews__item">
                <Skeleton width="50%" height="1.1rem" />
                <SkeletonLines count={2} lastWidth="35%" />
              </div>
            ))}
          </div>
        }
      >
        Loading reviews...
      </BlockLoading>
    );
  } else if (reviews.isError && reviews.error instanceof ResearcherAccessError) {
    list = <ResearcherAccessRequired />;
  } else if (reviews.isError) {
    list = <BlockError onRetry={() => void reviews.refetch()}>Can't load reviews right now.</BlockError>;
  } else if (reviews.data.length === 0) {
    list = <BlockEmpty>No reviews yet. Be the first to check this plume.</BlockEmpty>;
  } else {
    list = (
      <ul className="reviews" aria-label="Reviews">
        {reviews.data.map((review) => (
          <li key={review.id} className="reviews__item">
            <p className="reviews__verdict">{verdictLabel(review.verdict)}</p>
            {review.reason !== null && <p className="reviews__reason">{review.reason}</p>}
            <p className="card__note">
              {review.reviewer} · {formatDateTime(review.reviewed_at)}
            </p>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="card" aria-labelledby="reviews-heading">
      <h2 id="reviews-heading" className="card__title">
        Reviews
      </h2>
      {list}
      <ReviewForm plumeId={plumeId} />
    </section>
  );
}

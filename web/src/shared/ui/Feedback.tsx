import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { CONTACT_EMAIL } from "../contact";
import "./Feedback.css";

export const FEEDBACK_TOPICS = ["Question", "Bug", "Data or a plume", "Other"] as const;
export type FeedbackTopic = (typeof FEEDBACK_TOPICS)[number];

type FeedbackDraft = {
  topic: FeedbackTopic;
  message: string;
  replyTo: string;
  pageUrl: string;
};

/** A mailto: link to the team with the topic in the subject and the message, page and reply address in the body. */
export function buildFeedbackMailto({ topic, message, replyTo, pageUrl }: FeedbackDraft): string {
  const lines = [message.trim(), "", `Page: ${pageUrl}`];
  if (replyTo.trim() !== "") lines.push(`Reply to: ${replyTo.trim()}`);
  const subject = encodeURIComponent(`[Lawata] ${topic}`);
  const body = encodeURIComponent(lines.join("\n"));
  return `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
}

type FeedbackPanelProps = {
  open: boolean;
  onClose: () => void;
  /** Opens the mailto: link. Replaceable in tests. */
  onSend?: (href: string) => void;
};

const openMailto = (href: string) => window.location.assign(href);

/**
 * A small non-modal panel that writes feedback as an email. Nothing is sent to Lawata's servers:
 * "Send" opens the visitor's email app with the message filled in. Focus moves to the panel on open
 * and back to whatever opened it on close (Escape or the close button).
 */
export function FeedbackPanel({ open, onClose, onSend = openMailto }: FeedbackPanelProps) {
  const titleId = useId();
  const topicId = useId();
  const messageId = useId();
  const errorId = useId();
  const emailId = useId();
  const emailHintId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [topic, setTopic] = useState<FeedbackTopic>("Question");
  const [message, setMessage] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [error, setError] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (open) {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      panelRef.current?.querySelector<HTMLElement>("select")?.focus();
      return;
    }
    if (openerRef.current?.isConnected) openerRef.current.focus();
    openerRef.current = null;
    setError(false);
    setSent(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (message.trim() === "") {
      setError(true);
      setSent(false);
      panelRef.current?.querySelector<HTMLElement>("textarea")?.focus();
      return;
    }
    onSend(buildFeedbackMailto({ topic, message, replyTo, pageUrl: window.location.href }));
    setSent(true);
  };

  return (
    <section ref={panelRef} className="feedback" role="dialog" aria-modal="false" aria-labelledby={titleId}>
      <div className="feedback__head">
        <h2 id={titleId} className="feedback__title">
          Send feedback
        </h2>
        <button type="button" className="feedback__close" onClick={onClose}>
          <X aria-hidden="true" className="icon" />
          <span className="visually-hidden">Close feedback form</span>
        </button>
      </div>
      <form className="feedback__form" noValidate onSubmit={submit}>
        <div className="field">
          <label className="field__label" htmlFor={topicId}>
            Topic
          </label>
          <select
            id={topicId}
            className="field__input"
            value={topic}
            onChange={(event) => setTopic(event.target.value as FeedbackTopic)}
          >
            {FEEDBACK_TOPICS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={messageId}>
            Message
          </label>
          <textarea
            id={messageId}
            className="field__input feedback__message"
            rows={5}
            required
            aria-invalid={error}
            aria-describedby={error ? errorId : undefined}
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
              if (error && event.target.value.trim() !== "") setError(false);
            }}
          />
          {error && (
            <p id={errorId} className="feedback__error" role="alert">
              Write a message before sending.
            </p>
          )}
        </div>
        <div className="field">
          <label className="field__label" htmlFor={emailId}>
            Your email (optional)
          </label>
          <input
            id={emailId}
            className="field__input"
            type="email"
            autoComplete="email"
            aria-describedby={emailHintId}
            value={replyTo}
            onChange={(event) => setReplyTo(event.target.value)}
          />
          <p id={emailHintId} className="feedback__hint">
            Only if you would like a reply.
          </p>
        </div>
        <p className="feedback__note">This opens your email app with the message ready to send.</p>
        <button type="submit" className="button feedback__send">
          Send
        </button>
        <p className="feedback__status" role="status">
          {sent && (
            <>
              If your email app didn't open, write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
            </>
          )}
        </p>
      </form>
    </section>
  );
}

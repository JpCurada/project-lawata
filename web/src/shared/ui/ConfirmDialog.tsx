import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const focusableSelector =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// In-app confirmation (never window.confirm). Focus starts on Cancel so nothing is approved by an
// accidental Enter, Tab stays inside the dialog, Escape cancels, and focus returns to whatever
// opened the dialog when it closes (or to <main> if that element is gone, e.g. a card that moved).
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = "Go back",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    return () => {
      if (opener !== null && opener.isConnected) opener.focus();
      else document.getElementById("main")?.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      if (!busy) onCancel();
      return;
    }
    if (event.key !== "Tab" || dialogRef.current === null) return;
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector)];
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="dialog-backdrop" onKeyDown={onKeyDown}>
      <div ref={dialogRef} className="dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className="dialog__title">
          {title}
        </h2>
        <div className="dialog__body">{children}</div>
        <div className="dialog__actions">
          <button ref={cancelRef} type="button" className="button button--ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="button" className="button" onClick={onConfirm} disabled={busy} aria-busy={busy}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

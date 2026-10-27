import type { ReactNode } from "react";
import { SkeletonLines } from "./Skeleton";

// Loading, empty and error states for one data block, so blocks fail independently and every
// page announces changes the same way: loading is a polite status (skeleton shapes shaped like the
// content, with a visually hidden label), errors are alerts with Retry.

const classes = (base: string, extra?: string) => (extra ? `${base} ${extra}` : base);

interface BlockLoadingProps {
  /** Announced to screen readers, e.g. "Loading plumes...". */
  children: string;
  /** Skeleton shaped like the content it stands in for; defaults to a few text lines. */
  skeleton?: ReactNode;
  className?: string;
}

export function BlockLoading({ children, skeleton, className }: BlockLoadingProps) {
  return (
    <div className={classes("block-loading", className)} role="status" aria-live="polite" aria-busy="true">
      <span className="visually-hidden">{children}</span>
      {skeleton ?? <SkeletonLines />}
    </div>
  );
}

export function BlockEmpty({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={classes("block-state block-state--empty", className)} role="status" aria-live="polite">
      <p>{children}</p>
      {action}
    </div>
  );
}

export function BlockError({
  children,
  onRetry,
  className,
}: {
  children: ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={classes("block-state block-state--error", className)} role="alert">
      <p>{children}</p>
      {onRetry !== undefined && (
        <button type="button" className="button button--small" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

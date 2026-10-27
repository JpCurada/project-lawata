import type { CSSProperties } from "react";

type Shape = "line" | "block" | "circle" | "pill";

interface SkeletonProps {
  shape?: Shape;
  width?: string;
  height?: string;
  /** e.g. "16 / 9" for an image box at its real proportions. */
  aspectRatio?: string;
  className?: string;
}

/** A placeholder shape shown while content loads. Always hidden from assistive tech. */
export function Skeleton({ shape = "line", width, height, aspectRatio, className }: SkeletonProps) {
  const style: CSSProperties = { width, height, aspectRatio };
  return (
    <span
      className={className ? `skeleton skeleton--${shape} ${className}` : `skeleton skeleton--${shape}`}
      style={style}
      aria-hidden="true"
    />
  );
}

/** A few text lines, the last one shorter, like a paragraph. */
export function SkeletonLines({ count = 3, lastWidth = "60%" }: { count?: number; lastWidth?: string }) {
  return (
    <span className="skeleton-lines" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} width={index === count - 1 ? lastWidth : "100%"} />
      ))}
    </span>
  );
}

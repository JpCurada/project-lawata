// Small inline icons drawn with currentColor, sized to the surrounding text, hidden from assistive tech.

interface IconProps {
  className?: string;
}

const base = {
  width: "1em",
  height: "1em",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
};

export function ChevronRight({ className }: IconProps) {
  return (
    <svg {...base} className={className ? `icon ${className}` : "icon"}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function ChevronLeft({ className }: IconProps) {
  return (
    <svg {...base} className={className ? `icon ${className}` : "icon"}>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

export function ChevronDown({ className }: IconProps) {
  return (
    <svg {...base} className={className ? `icon ${className}` : "icon"}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className ? `icon ${className}` : "icon"}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function CrossIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className ? `icon ${className}` : "icon"}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/** A circle with a bar: a step our guards refused. */
export function BlockedIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className ? `icon ${className}` : "icon"}>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 18.4L18.4 5.6" />
    </svg>
  );
}

/** Replay: a circular arrow. */
export function ReplayIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className ? `icon ${className}` : "icon"}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </svg>
  );
}

/** Spinner arc; the CSS rotates it. */
export function SpinnerIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className ? `icon ${className}` : "icon"}>
      <path d="M21 12a9 9 0 1 1-6.2-8.6" />
    </svg>
  );
}

/** inspect_plume: a framed picture. */
export function ImageIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className ? `icon ${className}` : "icon"}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="M21 16l-5-5-9 9" />
    </svg>
  );
}

/** get_rainfall: a cloud with rain. */
export function RainIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className ? `icon ${className}` : "icon"}>
      <path d="M7 15a4.5 4.5 0 1 1 1-8.9A5.5 5.5 0 0 1 18.5 9 3 3 0 0 1 18 15H7z" />
      <path d="M8 18l-1 2.5M12 18l-1 2.5M16 18l-1 2.5" />
    </svg>
  );
}

/** get_history: a clock. */
export function ClockIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className ? `icon ${className}` : "icon"}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/** The agent's decision: a flag. */
export function FlagIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className ? `icon ${className}` : "icon"}>
      <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
    </svg>
  );
}

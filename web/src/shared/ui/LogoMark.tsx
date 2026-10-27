import mark from "../../assets/brand/lawata-mark.webp";

interface LogoMarkProps {
  /** Intrinsic size in CSS pixels; the class can scale it (for example with em units). */
  size: number;
  className?: string;
}

/**
 * The Lawata eye (src/lawata/lawata-logo.png with its black background removed, so it sits on
 * light and dark themes). Decorative: "Lawata" is always written next to it, so alt is empty.
 */
export function LogoMark({ size, className }: LogoMarkProps) {
  const classes = className ? `logo-mark ${className}` : "logo-mark";
  return <img src={mark} alt="" width={size} height={size} className={classes} decoding="async" />;
}

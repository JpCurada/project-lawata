import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "./Icon";

type Variant = "primary" | "outline" | "text";

const variantClass: Record<Variant, string> = {
  primary: "button",
  outline: "button button--outline",
  text: "link-arrow",
};

interface ArrowLinkProps {
  to: string;
  variant?: Variant;
  className?: string;
  children: ReactNode;
}

/** A router link styled as a pill button or text link, with a trailing chevron hidden from screen readers. */
export function ArrowLink({ to, variant = "primary", className, children }: ArrowLinkProps) {
  const classes = className ? `${variantClass[variant]} ${className}` : variantClass[variant];
  return (
    <Link to={to} className={classes}>
      {children}
      <Arrow />
    </Link>
  );
}

/** Trailing chevron for links and buttons; nudges right on hover (see .arrow in global.css). */
export function Arrow() {
  return <ChevronRight className="arrow" />;
}

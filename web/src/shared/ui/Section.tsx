import { useId, type ReactNode } from "react";

interface SectionProps {
  title: string;
  intro?: ReactNode;
  /** Shown after the title row, e.g. a "See all" link. */
  action?: ReactNode;
  /** Full-width tinted band instead of the page background. */
  band?: boolean;
  children: ReactNode;
}

/** A page section: serif title, optional one-line intro, consistent vertical rhythm and gutters. */
export function Section({ title, intro, action, band = false, children }: SectionProps) {
  const headingId = useId();
  return (
    <section className={band ? "section section--band" : "section"} aria-labelledby={headingId}>
      <div className="container">
        <div className="section__head">
          <h2 id={headingId} className="section__title">
            {title}
          </h2>
          {(intro !== undefined || action !== undefined) && (
            <p className="section__intro">
              {intro} {action}
            </p>
          )}
        </div>
        {children}
      </div>
    </section>
  );
}

import type { ReactNode } from "react";
import "./legal.css";

type LegalPageProps = {
  title: string;
  updated: string;
  children: ReactNode;
};

/** Shared frame for the privacy notice and terms: a title, the last-updated date, then plain prose. */
export function LegalPage({ title, updated, children }: LegalPageProps) {
  return (
    <article className="page">
      <div className="legal">
        <h1 className="page__title">{title}</h1>
        <p className="legal__updated">Last updated {updated}</p>
        {children}
      </div>
    </article>
  );
}

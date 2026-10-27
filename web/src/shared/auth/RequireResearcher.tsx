import type { ReactNode } from "react";
import { ArrowLink } from "../ui/ArrowLink";
import { BlockLoading } from "../ui/BlockState";
import { useAuth } from "./AuthProvider";

interface GateProps {
  /** Page heading, kept so the page is still recognisable while signed out. */
  title: string;
  /** One or two sentences on what the page is for, so visitors learn something even signed out. */
  intro?: string;
  /** Where a visitor without an account can go instead (e.g. a public story that shows the same thing). */
  alternative?: { to: string; label: string; text: string };
  children: ReactNode;
}

/** Shown when a signed-in user is not in the researchers group (or the API answered 403). */
export function ResearcherAccessRequired({ className }: { className?: string }) {
  return (
    <div className={className ? `auth-card ${className}` : "auth-card"} role="status">
      <h2 className="auth-card__title">Researcher access required</h2>
      <p className="auth-card__text">
        Your account is signed in but is not part of the research team. Ask a Lawata admin for an invite to the
        researchers group.
      </p>
    </div>
  );
}

/** A calm sign-in card. `headingLevel` keeps the outline right wherever it is used. */
export function SignInCard({
  title,
  children,
  headingLevel = 2,
}: {
  title: string;
  children: ReactNode;
  headingLevel?: 2 | 3;
}) {
  const { signIn, error } = useAuth();
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="auth-card">
      <Heading className="auth-card__title">{title}</Heading>
      <p className="auth-card__text">{children}</p>
      <button type="button" className="button" onClick={signIn}>
        Sign in
      </button>
      {error !== null && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Protected page: signed-out visitors see a sign-in screen and the page (and its data queries)
 * is not rendered at all. Sign-in returns to this page.
 */
export function RequireResearcher({ title, intro, alternative, children }: GateProps) {
  const auth = useAuth();

  if (auth.status === "loading") {
    return (
      <section className="page">
        <h1 className="page__title">{title}</h1>
        <BlockLoading>Checking your sign-in...</BlockLoading>
      </section>
    );
  }
  if (auth.status === "signedOut") {
    return (
      <section className="page gate">
        <h1 className="page__title">{title}</h1>
        {intro !== undefined && <p className="page__lead gate__intro">{intro}</p>}
        <div className="gate__grid">
          <div className="gate__col">
            <h2 className="gate__title">Sign in to continue</h2>
            <p className="gate__text">
              This area is for invited researchers. Sign in to see the agent's proposals and approve or reject them.
            </p>
            <button type="button" className="button" onClick={auth.signIn}>
              Sign in
            </button>
            {auth.error !== null && (
              <p className="inline-error" role="alert">
                {auth.error}
              </p>
            )}
          </div>
          {alternative !== undefined && (
            <div className="gate__col">
              <h2 className="gate__title">No account?</h2>
              <p className="gate__text">{alternative.text}</p>
              <ArrowLink to={alternative.to} variant="outline">
                {alternative.label}
              </ArrowLink>
            </div>
          )}
        </div>
      </section>
    );
  }
  if (!auth.isResearcher) {
    return (
      <section className="page">
        <h1 className="page__title">{title}</h1>
        <ResearcherAccessRequired />
      </section>
    );
  }
  return <>{children}</>;
}

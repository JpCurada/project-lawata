import { Link, isRouteErrorResponse, useRouteError } from "react-router-dom";

// Shown inside the shell when a route throws while rendering or its lazy chunk fails to load
// (e.g. offline right after a deploy). Reloading fetches the new chunk.
export function RouteError() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? ` (${error.status})` : "";
  return (
    <section className="page">
      <h1 className="page__title">Something went wrong{status}</h1>
      <div className="block-state block-state--error" role="alert">
        <p>This page couldn't be shown. Check your connection and try again.</p>
        <button type="button" className="button button--small" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
      <p>
        <Link to="/">Go to Home</Link>
      </p>
    </section>
  );
}

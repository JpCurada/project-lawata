import { Link, useLocation } from "react-router-dom";
import { LogoMark } from "../shared/ui/LogoMark";

export function NotFoundPage() {
  const { pathname, search } = useLocation();
  return (
    <section className="page">
      <LogoMark size={96} className="page__mark" />
      <h1 className="page__title">Page not found</h1>
      <p className="page__lead">
        There is no page at <code className="not-found__path">{pathname + search}</code>. The link may be old or
        mistyped.
      </p>
      <ul className="not-found__links">
        <li>
          <Link to="/">Go to Home</Link>
        </li>
        <li>
          <Link to="/explore">Explore the map</Link>
        </li>
      </ul>
    </section>
  );
}

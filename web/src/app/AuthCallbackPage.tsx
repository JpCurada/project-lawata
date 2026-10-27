import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../shared/auth";
import { BlockLoading } from "../shared/ui/BlockState";
import { LogoMark } from "../shared/ui/LogoMark";

/** /auth/callback: Cognito sends the user back here with a code; exchange it and return. */
export function AuthCallbackPage() {
  const { completeSignIn, signIn } = useAuth();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    completeSignIn()
      .then((returnTo) => {
        if (active) navigate(returnTo, { replace: true });
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [completeSignIn, navigate]);

  if (failed) {
    return (
      <section className="page">
        <LogoMark size={96} className="page__mark" />
        <h1 className="page__title">Sign-in didn't finish</h1>
        <p className="page__lead">The sign-in link may have expired or been used already.</p>
        <p>
          <button type="button" className="button" onClick={signIn}>
            Try signing in again
          </button>
        </p>
        <Link to="/">Back to home</Link>
      </section>
    );
  }

  return (
    <section className="page">
      <LogoMark size={96} className="page__mark" />
      <h1 className="page__title">Signing you in</h1>
      <BlockLoading>Finishing sign-in...</BlockLoading>
    </section>
  );
}

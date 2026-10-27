import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { setAuthHooks } from "../api/client";
import { RESEARCHERS_GROUP, backendFromEnv, type AuthBackend, type AuthUser } from "./backend";

export type AuthStatus = "loading" | "signedIn" | "signedOut";

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** Signed in and in the `researchers` group. */
  isResearcher: boolean;
  /** The API rejected the token (401): the session was cleared and the user should sign in again. */
  sessionExpired: boolean;
  /** Last sign-in or sign-out failure, in plain words. */
  error: string | null;
  /** Signs in and comes back to the current page. */
  signIn: () => void;
  signOut: () => void;
  /** Finishes sign-in on /auth/callback; resolves with the path to return to. Safe to call twice. */
  completeSignIn: () => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const currentPath = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;

const errorText = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");

export function AuthProvider({ children, backend: injected }: { children: ReactNode; backend?: AuthBackend }) {
  const [backend] = useState(() => injected ?? backendFromEnv());
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Read by the API client on every request, so it must change before any refetch starts.
  const userRef = useRef<AuthUser | null>(null);
  const settled = useRef(false);
  const callback = useRef<Promise<string> | null>(null);

  const applyUser = useCallback(
    (next: AuthUser | null) => {
      const previous = userRef.current;
      userRef.current = next;
      settled.current = true;
      setUser(next);
      setStatus(next === null ? "signedOut" : "signedIn");
      // Who is asking changes what the API returns (viewer, decisions, tasks): drop cached data.
      if (previous?.username !== next?.username || previous?.accessToken !== next?.accessToken) {
        void queryClient.resetQueries();
      }
    },
    [queryClient],
  );

  useEffect(() => {
    let active = true;
    backend
      .load()
      .then((loaded) => {
        // A callback that finished first wins over the (older) stored session.
        if (active && !settled.current) applyUser(loaded);
      })
      .catch(() => {
        if (active && !settled.current) applyUser(null);
      });
    const unsubscribe = backend.subscribe((next) => applyUser(next));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [backend, applyUser]);

  useEffect(
    () =>
      setAuthHooks({
        getAccessToken: () => userRef.current?.accessToken ?? null,
        onUnauthorized: () => {
          if (userRef.current === null) return;
          void backend.clear();
          applyUser(null);
          setSessionExpired(true);
        },
      }),
    [backend, applyUser],
  );

  const signIn = useCallback(() => {
    setError(null);
    backend
      .signIn(currentPath())
      .then((signedIn) => {
        if (signedIn !== null) {
          setSessionExpired(false);
          applyUser(signedIn);
        }
      })
      .catch((reason: unknown) => setError(errorText(reason)));
  }, [backend, applyUser]);

  const signOut = useCallback(() => {
    setError(null);
    setSessionExpired(false);
    applyUser(null);
    backend.signOut().catch((reason: unknown) => setError(errorText(reason)));
  }, [backend, applyUser]);

  const completeSignIn = useCallback(() => {
    // React StrictMode runs effects twice; the code in the URL can only be exchanged once.
    callback.current ??= backend.completeSignIn(window.location.href).then(({ user: signedIn, returnTo }) => {
      setSessionExpired(false);
      applyUser(signedIn);
      return returnTo;
    });
    return callback.current;
  }, [backend, applyUser]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      isResearcher: user?.groups.includes(RESEARCHERS_GROUP) ?? false,
      sessionExpired,
      error,
      signIn,
      signOut,
      completeSignIn,
    }),
    [status, user, sessionExpired, error, signIn, signOut, completeSignIn],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

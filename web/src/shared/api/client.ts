import createClient from "openapi-fetch";
import type { ApiPaths } from "./types";

/**
 * How the client learns about the signed-in user. The auth provider registers these; the client
 * stays independent of how sign-in works (Cognito, dev mode, tests).
 */
export interface AuthHooks {
  /** Current access token, or null when signed out. */
  getAccessToken: () => string | null;
  /** Called when the API rejects the token (HTTP 401): the session is over. */
  onUnauthorized: () => void;
}

const signedOut: AuthHooks = { getAccessToken: () => null, onUnauthorized: () => undefined };
let hooks: AuthHooks = signedOut;

/** Registers the auth hooks; returns a function that removes them. */
export function setAuthHooks(next: AuthHooks): () => void {
  hooks = next;
  return () => {
    if (hooks === next) hooks = signedOut;
  };
}

// Same-origin: the Vite dev server proxies /api to :8000, CloudFront routes /api to the API Lambda.
// Paths in schema.ts already include the /api prefix, so the base is just the page origin.
export const api = createClient<ApiPaths>({
  baseUrl: window.location.origin,
  // Resolve fetch per call so it is never captured at import time (keeps it swappable in tests).
  fetch: (request) => globalThis.fetch(request),
});

api.use({
  onRequest({ request }) {
    const token = hooks.getAccessToken();
    if (token !== null) request.headers.set("Authorization", `Bearer ${token}`);
    return request;
  },
  onResponse({ request, response }) {
    // Only a rejected token ends the session; a 401 for an anonymous call changes nothing.
    if (response.status === 401 && request.headers.has("Authorization")) hooks.onUnauthorized();
    return response;
  },
});

/** HTTP 401: the visitor must sign in (again). */
export class SignInRequiredError extends Error {
  constructor() {
    super("Sign in required");
  }
}

/** HTTP 403: signed in, but not in the researchers group. */
export class ResearcherAccessError extends Error {
  constructor() {
    super("Researcher access required");
  }
}

/** Throws the auth error matching a 401/403 response; otherwise does nothing. */
export function throwIfAuthError(response: Response): void {
  if (response.status === 401) throw new SignInRequiredError();
  if (response.status === 403) throw new ResearcherAccessError();
}

/** Don't retry auth failures: the answer won't change until the user signs in. */
export function retryUnlessAuth(count: number, error: Error): boolean {
  return !(error instanceof SignInRequiredError || error instanceof ResearcherAccessError) && count < 1;
}

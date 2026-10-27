import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";

export const RESEARCHERS_GROUP = "researchers";

export interface AuthUser {
  username: string;
  email: string | null;
  groups: string[];
  /** Sent as `Authorization: Bearer ...`; null in dev mode (the API runs with AUTH_DISABLED). */
  accessToken: string | null;
}

/**
 * The sign-in mechanism behind AuthProvider. Cognito in production, a fake user in dev mode, and a
 * stub in tests. Methods that leave the page (redirects) simply never resolve in a useful way.
 */
export interface AuthBackend {
  /** The stored session, or null when signed out (or expired). */
  load(): Promise<AuthUser | null>;
  /** Starts sign-in. Cognito redirects away; dev mode resolves with the user at once. */
  signIn(returnTo: string): Promise<AuthUser | null>;
  /** Finishes sign-in on /auth/callback; returns the user and the path to go back to. */
  completeSignIn(url: string): Promise<{ user: AuthUser; returnTo: string }>;
  /** Clears the local session and, for Cognito, leaves through the hosted UI logout. */
  signOut(): Promise<void>;
  /** Clears the local session only (e.g. the API rejected the token). */
  clear(): Promise<void>;
  /** Session changes made outside the provider (token renewal, expiry). */
  subscribe(listener: (user: AuthUser | null) => void): () => void;
}

/** Only same-site paths are followed after sign-in; anything else goes home. */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.startsWith("/auth/callback")) return "/";
  return value;
}

// ---------------------------------------------------------------------------------------------
// Dev mode: a fake signed-in "dev" researcher, no network. Pair with the API's AUTH_DISABLED=true.
// Sign out / sign in toggle a flag so the signed-out views can be checked locally too.
// ---------------------------------------------------------------------------------------------

const DEV_SIGNED_OUT_KEY = "lawata.dev-signed-out";

export const devUser: AuthUser = { username: "dev", email: null, groups: [RESEARCHERS_GROUP], accessToken: null };

export function createDevBackend(storage: Storage = window.sessionStorage): AuthBackend {
  return {
    load: async () => (storage.getItem(DEV_SIGNED_OUT_KEY) === "1" ? null : devUser),
    signIn: async () => {
      storage.removeItem(DEV_SIGNED_OUT_KEY);
      return devUser;
    },
    completeSignIn: async () => {
      storage.removeItem(DEV_SIGNED_OUT_KEY);
      return { user: devUser, returnTo: "/" };
    },
    signOut: async () => storage.setItem(DEV_SIGNED_OUT_KEY, "1"),
    clear: async () => storage.setItem(DEV_SIGNED_OUT_KEY, "1"),
    subscribe: () => () => undefined,
  };
}

// ---------------------------------------------------------------------------------------------
// Cognito: authorization code + PKCE through the hosted UI (oidc-client-ts).
// ---------------------------------------------------------------------------------------------

export interface CognitoConfig {
  authority: string;
  clientId: string;
  /** Hosted UI base URL, e.g. https://lawata.auth.us-west-2.amazoncognito.com */
  domain: string;
  origin: string;
}

function stringClaim(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Maps the ID token claims to the user shown in the UI. Groups come from `cognito:groups`. */
export function toAuthUser(user: User): AuthUser {
  const profile: Record<string, unknown> = user.profile;
  const groups = profile["cognito:groups"];
  return {
    username:
      stringClaim(profile["cognito:username"]) ??
      stringClaim(profile.preferred_username) ??
      stringClaim(profile.email) ??
      user.profile.sub,
    email: stringClaim(profile.email),
    groups: Array.isArray(groups) ? groups.filter((group): group is string => typeof group === "string") : [],
    accessToken: user.access_token,
  };
}

/** Cognito has no standard end_session endpoint; its hosted UI logout takes client_id + logout_uri. */
export function cognitoLogoutUrl({ domain, clientId, origin }: CognitoConfig): string {
  const params = new URLSearchParams({ client_id: clientId, logout_uri: `${origin}/` });
  return `${domain.replace(/\/+$/, "")}/logout?${params.toString()}`;
}

export function createCognitoBackend(config: CognitoConfig): AuthBackend {
  const manager = new UserManager({
    authority: config.authority,
    client_id: config.clientId,
    redirect_uri: `${config.origin}/auth/callback`,
    post_logout_redirect_uri: `${config.origin}/`,
    response_type: "code",
    scope: "openid email profile",
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  });

  const usable = (user: User | null) => (user === null || user.expired === true ? null : toAuthUser(user));

  return {
    load: async () => {
      const user = await manager.getUser();
      if (user !== null && user.expired === true) await manager.removeUser();
      return usable(user);
    },
    signIn: async (returnTo) => {
      await manager.signinRedirect({ state: { returnTo: safeReturnTo(returnTo) } });
      return null;
    },
    completeSignIn: async (url) => {
      const user = await manager.signinRedirectCallback(url);
      const state: unknown = user.state;
      const returnTo = typeof state === "object" && state !== null && "returnTo" in state ? state.returnTo : "/";
      return { user: toAuthUser(user), returnTo: safeReturnTo(returnTo) };
    },
    signOut: async () => {
      await manager.removeUser();
      window.location.assign(cognitoLogoutUrl(config));
    },
    clear: () => manager.removeUser(),
    subscribe: (listener) => {
      const offLoaded = manager.events.addUserLoaded((user) => listener(usable(user)));
      const offUnloaded = manager.events.addUserUnloaded(() => listener(null));
      const offExpired = manager.events.addAccessTokenExpired(() => {
        void manager.removeUser();
      });
      return () => {
        offLoaded();
        offUnloaded();
        offExpired();
      };
    },
  };
}

/** A backend that can't sign anyone in, used when the Cognito env vars are missing. */
function createUnconfiguredBackend(): AuthBackend {
  const fail = () => Promise.reject(new Error("Sign-in is not configured for this site."));
  return {
    load: async () => null,
    signIn: fail,
    completeSignIn: fail,
    signOut: async () => undefined,
    clear: async () => undefined,
    subscribe: () => () => undefined,
  };
}

export function backendFromEnv(env: ImportMetaEnv = import.meta.env): AuthBackend {
  if (env.VITE_AUTH_MODE === "dev") return createDevBackend();
  const { VITE_COGNITO_AUTHORITY: authority, VITE_COGNITO_CLIENT_ID: clientId, VITE_COGNITO_DOMAIN: domain } = env;
  if (!authority || !clientId || !domain) return createUnconfiguredBackend();
  return createCognitoBackend({ authority, clientId, domain, origin: window.location.origin });
}

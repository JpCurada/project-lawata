// Test-only helpers: an in-memory auth backend with a fixed starting user.
import { vi } from "vitest";
import { RESEARCHERS_GROUP, type AuthBackend, type AuthUser } from "./backend";

export const researcher: AuthUser = {
  username: "ana",
  email: "ana@example.org",
  groups: [RESEARCHERS_GROUP],
  accessToken: "token-ana",
};

export function fakeBackend(initial: AuthUser | null) {
  const backend = {
    load: vi.fn(async () => initial),
    signIn: vi.fn(async (_returnTo: string): Promise<AuthUser | null> => null),
    completeSignIn: vi.fn(async (_url: string) => ({ user: researcher, returnTo: "/" })),
    signOut: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
    subscribe: vi.fn(() => () => undefined),
  } satisfies AuthBackend;
  return backend;
}

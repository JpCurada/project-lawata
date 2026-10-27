import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../shared/auth";
import { cognitoLogoutUrl, createDevBackend, safeReturnTo } from "../shared/auth/backend";
import { fakeBackend, researcher } from "../shared/auth/testing";
import { ThemeProvider } from "../shared/theme/ThemeProvider";
import { routes } from "./routes";

vi.mock("../features/explore/PlumeMap", () => ({ PlumeMap: () => <div>map</div> }));
vi.mock("../features/sampling/SitesMiniMap", () => ({ default: () => <div>mini map</div> }));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function stubFetch(handler: (request: Request) => Response) {
  const fetchMock = vi.fn(async (input: Request) => handler(input));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const requestedPaths = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls.map(([request]) => new URL(request.url).pathname);

function renderAt(path: string, backend: ReturnType<typeof fakeBackend>) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider backend={backend}>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return router;
}

/** The site header (pages may have their own <header> too). */
const header = () => {
  const element = document.querySelector<HTMLElement>("header.header");
  if (element === null) throw new Error("missing site header");
  return element;
};

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe("protected /sampling", () => {
  it("shows a sign-in screen to signed-out visitors and never requests the tasks", async () => {
    const fetchMock = stubFetch(() => json([]));
    const backend = fakeBackend(null);
    renderAt("/sampling", backend);

    expect(await screen.findByRole("heading", { level: 1, name: "Sampling" })).toBeDefined();
    const main = screen.getByRole("main");
    expect(within(main).getByRole("heading", { name: "Sign in to continue" })).toBeDefined();
    expect(within(main).queryByText(/Pending approval \(/)).toBeNull();
    expect(requestedPaths(fetchMock)).not.toContain("/api/sampling-tasks");

    // Sign-in starts from the protected page so the callback can return to it.
    fireEvent.click(within(main).getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(backend.signIn).toHaveBeenCalledTimes(1));
    expect(backend.signIn.mock.calls[0][0]).toMatch(/^\//);
  });

  it("says researcher access is required for signed-in users outside the group", async () => {
    const fetchMock = stubFetch(() => json([]));
    renderAt("/sampling", fakeBackend({ ...researcher, groups: [] }));
    expect(await screen.findByRole("heading", { name: "Researcher access required" })).toBeDefined();
    expect(requestedPaths(fetchMock)).not.toContain("/api/sampling-tasks");
  });

  it("shows the tasks to researchers, sending the bearer token", async () => {
    const fetchMock = stubFetch(() => json([]));
    renderAt("/sampling", fakeBackend(researcher));
    expect(await screen.findByText(/No sampling tasks yet/)).toBeDefined();
    const tasksRequest = fetchMock.mock.calls.map(([request]) => request).find((r) => r.url.endsWith("/api/sampling-tasks?limit=200"));
    expect(tasksRequest?.headers.get("Authorization")).toBe("Bearer token-ana");
  });

  it("shows 'Researcher access required' when the API answers 403", async () => {
    stubFetch(() => json({ detail: "Researcher access required" }, 403));
    renderAt("/sampling", fakeBackend(researcher));
    expect(await screen.findByRole("heading", { name: "Researcher access required" })).toBeDefined();
  });
});

describe("401 handling", () => {
  it("clears the session and prompts sign-in when the API rejects the token", async () => {
    stubFetch((request) =>
      request.headers.has("Authorization") ? json({ detail: "Sign in required" }, 401) : json([]),
    );
    const backend = fakeBackend(researcher);
    renderAt("/sampling", backend);

    expect(await screen.findByText("Your session has ended. Sign in again to see researcher data.")).toBeDefined();
    expect(backend.clear).toHaveBeenCalledTimes(1);
    // The protected page falls back to its sign-in screen and the header offers Sign in again.
    expect(await screen.findByRole("heading", { name: "Sign in to continue" })).toBeDefined();
    expect(within(header()).getByRole("button", { name: "Sign in" })).toBeDefined();
    expect(within(header()).queryByText("ana")).toBeNull();
  });
});

describe("header account", () => {
  it("offers Sign in when signed out", async () => {
    stubFetch(() => json([]));
    const backend = fakeBackend(null);
    renderAt("/story", backend);
    fireEvent.click(await within(header()).findByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(backend.signIn).toHaveBeenCalledTimes(1));
  });

  it("shows the username and Sign out when signed in", async () => {
    stubFetch(() => json([]));
    const backend = fakeBackend(researcher);
    renderAt("/story", backend);
    expect(await within(header()).findByText("ana")).toBeDefined();
    fireEvent.click(within(header()).getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(backend.signOut).toHaveBeenCalledTimes(1));
    expect(await within(header()).findByRole("button", { name: "Sign in" })).toBeDefined();
  });
});

describe("/auth/callback", () => {
  it("completes sign-in once and returns to the stored path", async () => {
    stubFetch(() => json([]));
    const backend = fakeBackend(null);
    backend.completeSignIn.mockResolvedValue({ user: researcher, returnTo: "/sampling" });
    const router = renderAt("/auth/callback", backend);
    await waitFor(() => expect(router.state.location.pathname).toBe("/sampling"));
    expect(backend.completeSignIn).toHaveBeenCalledTimes(1);
    expect(await within(header()).findByText("ana")).toBeDefined();
  });

  it("explains a failed sign-in and offers to try again", async () => {
    stubFetch(() => json([]));
    const backend = fakeBackend(null);
    backend.completeSignIn.mockRejectedValue(new Error("invalid_grant"));
    renderAt("/auth/callback", backend);
    expect(await screen.findByRole("heading", { level: 1, name: "Sign-in didn't finish" })).toBeDefined();
  });
});

describe("auth helpers", () => {
  it("only returns to same-site paths", () => {
    expect(safeReturnTo("/plumes/27?x=1")).toBe("/plumes/27?x=1");
    expect(safeReturnTo("//evil.example")).toBe("/");
    expect(safeReturnTo("https://evil.example")).toBe("/");
    expect(safeReturnTo("/auth/callback?code=1")).toBe("/");
    expect(safeReturnTo(undefined)).toBe("/");
  });

  it("builds the Cognito hosted UI logout URL", () => {
    const url = cognitoLogoutUrl({
      authority: "https://cognito-idp.us-west-2.amazonaws.com/pool",
      clientId: "abc123",
      domain: "https://lawata.auth.us-west-2.amazoncognito.com/",
      origin: "http://localhost:5173",
    });
    expect(url).toBe(
      "https://lawata.auth.us-west-2.amazoncognito.com/logout?client_id=abc123&logout_uri=http%3A%2F%2Flocalhost%3A5173%2F",
    );
  });

  it("dev mode is a signed-in researcher 'dev' with no token, and can toggle signed out", async () => {
    const dev = createDevBackend(window.sessionStorage);
    expect(await dev.load()).toEqual({ username: "dev", email: null, groups: ["researchers"], accessToken: null });
    await dev.signOut();
    expect(await dev.load()).toBeNull();
    await dev.signIn("/");
    expect((await dev.load())?.username).toBe("dev");
  });
});

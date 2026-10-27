import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { plumesFixture } from "../features/explore/plumes.fixture";
import { binangonanDetail } from "../features/plumes/plumes.fixture";
import type { PlumeCollection } from "../features/explore/plumes";
import { AuthProvider } from "../shared/auth";
import { fakeBackend } from "../shared/auth/testing";
import { ThemeProvider } from "../shared/theme/ThemeProvider";
import { routes } from "./routes";

// MapLibre needs WebGL, which jsdom lacks; render each visible plume as a button instead.
vi.mock("../features/explore/PlumeMap", () => ({
  PlumeMap: ({ data, onSelect }: { data: PlumeCollection; onSelect: (id: number) => void }) => (
    <ul aria-label="map">
      {data.features.map((f) => (
        <li key={f.properties.id}>
          <button type="button" onClick={() => onSelect(f.properties.id)}>
            plume {f.properties.id}
          </button>
        </li>
      ))}
    </ul>
  ),
}));

function renderAt(path: string, backend = fakeBackend(null)) {
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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function stubApi(responses: Record<string, () => Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, "http://localhost").pathname;
    const respond = responses[path];
    return respond === undefined ? json({ detail: "Not Found" }, 404) : respond();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.each([
  ["/", /A satellite can.t tell what.s in the water/],
  ["/story", "Stories"],
  ["/story/binangonan-may-2026", "Binangonan, May 2026: a plume with no rain"],
  ["/story/no-such-story", "Story not found"],
  ["/sampling", "Sampling"],
  ["/privacy", "Privacy notice"],
  ["/terms", "Terms of use"],
])("route %s", (path, heading) => {
  it("renders inside the shell with its heading", async () => {
    stubApi({});
    renderAt(path);
    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeDefined();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeDefined();
  });
});

describe("explore", () => {
  it("shows all plumes and their count", async () => {
    stubApi({ "/api/plumes.geojson": () => json(plumesFixture) });
    renderAt("/explore");
    expect(await screen.findByRole("heading", { level: 1, name: "Explore" })).toBeDefined();
    expect(screen.getByText("Loading plume sightings...")).toBeDefined();
    expect(await screen.findByText("3 of 3 plumes")).toBeDefined();
  });

  it("applies filters from the URL and updates the URL when they change", async () => {
    stubApi({ "/api/plumes.geojson": () => json(plumesFixture) });
    const router = renderAt("/explore?dry=1");
    expect(await screen.findByText("2 of 3 plumes")).toBeDefined();
    expect(screen.queryByRole("button", { name: "plume 30" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Place"), { target: { value: "Lumban" } });
    expect(await screen.findByText("1 of 3 plumes")).toBeDefined();
    expect(router.state.location.search).toBe("?place=Lumban&dry=1");

    await router.navigate(-1);
    expect(await screen.findByText("2 of 3 plumes")).toBeDefined();
  });

  it("shows an empty state with a way out when nothing matches", async () => {
    stubApi({ "/api/plumes.geojson": () => json(plumesFixture) });
    renderAt("/explore?place=Calamba&dry=1");
    expect(await screen.findByText("No plumes match these filters.")).toBeDefined();
    fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[1]);
    expect(await screen.findByText("3 of 3 plumes")).toBeDefined();
  });

  it("shows an error with retry when plumes fail to load", async () => {
    stubApi({});
    renderAt("/explore");
    expect(await screen.findByText("Can't load plume sightings right now.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Retry" })).toBeDefined();
  });

  it("previews a clicked plume, then opens its page", async () => {
    stubApi({
      "/api/plumes.geojson": () => json(plumesFixture),
      "/api/plumes/30": () => json({ ...binangonanDetail, id: 30, place: "Calamba" }),
    });
    const router = renderAt("/explore");
    fireEvent.click(await screen.findByRole("button", { name: "plume 30" }));
    const preview = await screen.findByRole("dialog", { name: /Calamba/ });
    expect(preview.textContent).toContain("After rain: expected runoff");
    expect(router.state.location.pathname).toBe("/explore");
    fireEvent.click(screen.getByRole("link", { name: "Open plume" }));
    expect(await screen.findByRole("heading", { level: 1, name: /Calamba/ })).toBeDefined();
    expect(router.state.location.pathname).toBe("/plumes/30");
  });
});

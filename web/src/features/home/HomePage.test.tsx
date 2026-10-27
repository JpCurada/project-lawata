import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../../shared/auth";
import { fakeBackend, researcher } from "../../shared/auth/testing";
import type { AuthUser } from "../../shared/auth";
import { HomePage } from "./HomePage";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const stats = { total_plumes: 34, dry_weather_plumes: 6, pending_sampling_tasks: 1, last_scene_date: "2026-10-03" };
const plume = (id: number, place: string, date: string, is_dry: boolean) => ({
  id,
  place,
  date,
  is_dry,
  area_ha: 92,
  kind: "brown",
  entry_lat: 14.5,
  entry_lon: 121.1,
});
const latest = [plume(34, "Calamba", "2026-09-25", false), plume(27, "Binangonan", "2026-05-06", true)];
const pendingTask = { id: 1, event_id: 27, status: "pending_approval" };

type Routes = Record<string, () => Response>;

function stubApi(routes: Routes) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Request) => {
      const respond = routes[new URL(input.url).pathname];
      return respond === undefined ? json({ detail: "Not Found" }, 404) : respond();
    }),
  );
}

const allOk = (pending: unknown[] = [pendingTask]): Routes => ({
  "/api/stats": () => json(stats),
  "/api/plumes": () => json(latest),
  "/api/sampling-tasks": () => json(pending),
});

function renderHome(user: AuthUser | null = researcher) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider backend={fakeBackend(user)}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("home", () => {
  it("tells the story first: how it works, one headline number, the agent's decisions", async () => {
    stubApi(allOk());
    renderHome();
    expect(screen.getByRole("heading", { level: 1, name: /A satellite can.t tell/ })).toBeDefined();
    expect(screen.getByRole("link", { name: "Watch the agent decide" }).getAttribute("href")).toBe("/story");
    expect(screen.getByRole("link", { name: "Explore the map" }).getAttribute("href")).toBe("/explore");
    expect(screen.getByRole("heading", { name: "How it works" })).toBeDefined();
    expect(screen.getByText("Person approves")).toBeDefined();

    const headline = await screen.findByText(/plumes appeared in dry weather/);
    expect(headline.textContent).toContain("6 of 34 plumes appeared in dry weather");
    expect(screen.getByText(/Latest clear Sentinel-2 pass analysed: Oct 3, 2026/)).toBeDefined();
    // A real recorded run is on Home itself, so the agent's decision is visible without signing in.
    const run = screen.getByRole("region", { name: "Agent run" });
    expect(await within(run).findByText("Marked as an image artifact", undefined, { timeout: 2000 })).toBeDefined();
    expect(screen.getByRole("img", { name: /Calamba shore/ })).toBeDefined();
    // The hero image is a clean Sentinel-2 crop (no baked-in labels), captioned in plain words.
    expect(screen.getByText(/seen by Sentinel-2: after a week of rain/)).toBeDefined();
    expect(screen.queryByText("Plumes detected")).toBeNull();
    expect(screen.queryByText("Lawata resources")).toBeNull();

    const hrefs = ["/story/pililla-apr-2026", "/story/calamba-sep-2026", "/story/binangonan-may-2026"];
    for (const href of hrefs) expect(document.querySelector(`a[href="${href}"]`)).not.toBeNull();
    expect(screen.queryByText(/illegal/i)).toBeNull();
  });

  it("lists dry-weather plumes first as suspicious, verify", async () => {
    stubApi(allOk());
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = new URL((input as Request).url);
      if (url.pathname === "/api/plumes") {
        return json(url.searchParams.get("dry_only") === "true" ? [latest[1]] : latest);
      }
      return url.pathname === "/api/stats" ? json(stats) : json([pendingTask]);
    });
    renderHome();
    const binangonan = await screen.findByRole("link", { name: /Binangonan.*unusual water/ });
    expect(binangonan.getAttribute("href")).toBe("/plumes/27");
    expect(binangonan.textContent).toContain("Suspicious, verify");
    const cards = screen.getAllByRole("link", { name: /unusual water/ });
    expect(cards.map((link) => link.getAttribute("href"))).toEqual(["/plumes/27", "/plumes/34"]);
    expect(screen.getByRole("link", { name: "See all on the map" }).getAttribute("href")).toBe("/explore");
  });

  it("shows the pending call to action to researchers", async () => {
    stubApi(allOk());
    renderHome();
    expect(await screen.findByText(/sampling task is pending/)).toBeDefined();
    expect(screen.getByRole("link", { name: "Review sampling" }).getAttribute("href")).toBe("/sampling");
  });

  it("shows a calm state when nothing is pending", async () => {
    stubApi(allOk([]));
    renderHome();
    expect(await screen.findByText("No sampling tasks are waiting for approval.")).toBeDefined();
    expect(screen.queryByRole("link", { name: "Review sampling" })).toBeNull();
  });

  it("hides the pending-sampling block from signed-out visitors and never asks for tasks", async () => {
    stubApi(allOk());
    renderHome(null);
    expect(await screen.findByText(/plumes appeared in dry weather/)).toBeDefined();
    expect(await screen.findByRole("link", { name: /After rain.*Calamba/ })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Sampling" })).toBeNull();
    expect(screen.queryByText(/sampling tasks? (is|are) pending/i)).toBeNull();
    const paths = vi.mocked(fetch).mock.calls.map(([input]) => new URL((input as Request).url).pathname);
    expect(paths).not.toContain("/api/sampling-tasks");
  });

  it("keeps blocks independent: a failing block shows retry while the others render", async () => {
    let statsUp = false;
    stubApi({ ...allOk(), "/api/stats": () => (statsUp ? json(stats) : json({ detail: "down" }, 503)) });
    renderHome();
    const error = await screen.findByText("Can't load the numbers right now.");
    expect(await screen.findByRole("link", { name: /After rain.*Calamba/ })).toBeDefined();
    statsUp = true;
    const block = error.parentElement;
    if (block === null) throw new Error("missing error block");
    fireEvent.click(within(block).getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/plumes appeared in dry weather/)).toBeDefined();
  });

  it("shows empty states when there is no data yet", async () => {
    stubApi({
      "/api/stats": () =>
        json({ total_plumes: 0, dry_weather_plumes: 0, pending_sampling_tasks: 0, last_scene_date: null }),
      "/api/plumes": () => json([]),
      "/api/sampling-tasks": () => json([]),
    });
    renderHome();
    expect(await screen.findByText(/No satellite scenes processed yet/)).toBeDefined();
    expect(await screen.findByText("No plumes detected yet.")).toBeDefined();
  });
});

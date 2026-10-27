import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../../shared/auth";
import type { AuthUser } from "../../shared/auth";
import { fakeBackend, researcher } from "../../shared/auth/testing";
import { StoryDetailPage } from "./StoryDetailPage";
import { StoryGalleryPage } from "./StoryGalleryPage";
import { stories } from "./stories";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const shared = { kind: "brown+dark", entry_lat: 14.5, entry_lon: 121.1 };
const plumes = [
  { place: "Calamba", id: 34, date: "2026-09-25", area_ha: 806, is_dry: false, rain_3d_mm: 37.5, rain_7d_mm: 80.6 },
  { place: "Binangonan", id: 27, date: "2026-05-06", area_ha: 92, is_dry: true, rain_3d_mm: 1.2, rain_7d_mm: 1.4 },
  // is_dry is false only because a person reviewed it as an artifact (v_dry_weather_plumes).
  { place: "Pililla", id: 26, date: "2026-04-21", area_ha: 100, is_dry: false, rain_3d_mm: 0.4, rain_7d_mm: 0.4 },
  { place: "Lumban", id: 20, date: "2026-03-07", area_ha: 50, is_dry: true, rain_3d_mm: 0, rain_7d_mm: 2 },
];

function stubApi({ tasksStatus = 200 } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Request) => {
      const url = new URL(input.url);
      if (url.pathname === "/api/plumes") {
        const place = url.searchParams.get("place");
        const date = url.searchParams.get("from");
        return json(plumes.filter((p) => p.place === place && p.date === date).map(({ rain_3d_mm: _r3, rain_7d_mm: _r7, ...p }) => ({ ...shared, ...p })));
      }
      const one = url.pathname.match(/^\/api\/plumes\/(\d+)$/);
      if (one) {
        const p = plumes.find((item) => item.id === Number(one[1]));
        if (p === undefined) return json({ detail: "Plume not found" }, 404);
        return json({
          ...shared,
          ...p,
          province: null,
          latest_review: null,
          evidence_image_url: null,
          latest_decision:
            p.place === "Binangonan"
              ? {
                  action: "create_sampling_task",
                  reason: "Dry-weather plume at the river mouth. Suspicious, verify.",
                  created_at: "2026-05-07T00:00:00Z",
                }
              : null,
        });
      }
      if (url.pathname === "/api/sampling-tasks") {
        if (tasksStatus !== 200) return json({ detail: "Sign in required" }, tasksStatus);
        return json([{ id: 1, event_id: 27, status: "pending_approval", reviewed_by: null }]);
      }
      return json({ detail: "Not Found" }, 404);
    }),
  );
}

const requestedPaths = () =>
  vi.mocked(fetch).mock.calls.map(([input]) => new URL((input as Request).url).pathname);

function renderAt(path: string, user: AuthUser | null = null) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider backend={fakeBackend(user)}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/story" element={<StoryGalleryPage />} />
            <Route path="/story/:storyId" element={<StoryDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("story gallery", () => {
  it("shows a card per story, linking to its page, with one line of live numbers", async () => {
    stubApi();
    renderAt("/story");

    expect(screen.getByText(`${stories.length} stories`)).toBeDefined();
    const calamba = screen.getByRole("article", { name: /Calamba, September 2026/ });
    expect(within(calamba).getByRole("link").getAttribute("href")).toBe("/story/calamba-sep-2026");
    expect(within(calamba).getByText("After rain: expected runoff")).toBeDefined();
    expect(await within(calamba).findByText("806 ha · 37.5 mm of rain in 3 days")).toBeDefined();
    expect(within(calamba).getByText("Agent: Logged as expected (rain or known source)")).toBeDefined();

    const binangonan = screen.getByRole("article", { name: /Binangonan, May 2026/ });
    expect(within(binangonan).getByText("Dry weather: suspicious, verify")).toBeDefined();
    expect(within(binangonan).getByText("Agent: Field sampling requested, pending approval")).toBeDefined();

    const pililla = screen.getByRole("article", { name: /Pililla, April 2026/ });
    expect(within(pililla).getByText("Image artifact: not a plume")).toBeDefined();
    expect(within(pililla).getByText("Agent: Marked as an image artifact")).toBeDefined();

    // Only stories with a recorded run get the agent line.
    const lumban = screen.getByRole("article", { name: /Lumban, March 2026/ });
    expect(await within(lumban).findByText("50 ha · 0.0 mm of rain in 3 days")).toBeDefined();
    expect(within(lumban).queryByText(/^Agent:/)).toBeNull();

    // One line points to the three recorded runs.
    expect(screen.getByRole("link", { name: "Pililla (artifact)" }).getAttribute("href")).toBe("/story/pililla-apr-2026");
    expect(screen.getByRole("link", { name: "Calamba (expected)" }).getAttribute("href")).toBe("/story/calamba-sep-2026");
    expect(screen.getByRole("link", { name: "Binangonan (sampling)" }).getAttribute("href")).toBe("/story/binangonan-may-2026");

    // A story with no plume in this database says so instead of showing numbers.
    const paete = screen.getByRole("article", { name: /Paete/ });
    expect(await within(paete).findByText(/Not in the live database/)).toBeDefined();
    expect(screen.queryByText(/illegal/i)).toBeNull();
  });

  it("filters by weather, searches and sorts, and can clear back to all", async () => {
    stubApi();
    renderAt("/story");

    const filters = within(screen.getByRole("group", { name: "Filter stories" }));
    expect(filters.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
    const dry = filters.getByRole("button", { name: "Dry weather (suspicious)" });
    fireEvent.click(dry);
    expect(dry.getAttribute("aria-pressed")).toBe("true");
    const dryCount = stories.filter((story) => story.weather === "dry_weather").length;
    expect(screen.getByText(`${dryCount} stories`)).toBeDefined();
    expect(screen.queryByRole("article", { name: /Calamba/ })).toBeNull();

    fireEvent.change(screen.getByLabelText("Search stories"), { target: { value: "lumban" } });
    expect(screen.getByText("1 story")).toBeDefined();
    expect(screen.getByRole("article", { name: /Lumban, March 2026/ })).toBeDefined();

    fireEvent.change(screen.getByLabelText("Search stories"), { target: { value: "nowhere" } });
    expect(screen.getByText("No stories match these filters.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText(`${stories.length} stories`)).toBeDefined();
    expect(filters.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByLabelText("Search stories") as HTMLInputElement).value).toBe("");

    fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "oldest" } });
    const titles = within(screen.getByRole("list")).getAllByRole("article").map((card) => card.getAttribute("aria-labelledby"));
    expect(titles[0]).toBe("story-card-paete-aug-2025");
  });
});

describe("story detail", () => {
  it("tells one story with live numbers, the live decision (researchers) and the next step", async () => {
    stubApi();
    renderAt("/story/binangonan-may-2026", researcher);

    expect(screen.getByRole("heading", { level: 1, name: "Binangonan, May 2026: a plume with no rain" })).toBeDefined();
    expect(screen.getByRole("link", { name: /Back to stories/ }).getAttribute("href")).toBe("/story");
    expect(await screen.findByText("May 6, 2026 · 92 ha · 1.2 mm of rain in 3 days")).toBeDefined();
    expect(screen.getByText("Dry weather")).toBeDefined();
    expect(screen.getByText("Field sampling requested, pending approval")).toBeDefined();
    expect(screen.getByText("Dry-weather plume at the river mouth. Suspicious, verify.")).toBeDefined();
    // The live decision wins over the recorded run.
    expect(screen.queryByText(/Recorded agent run/)).toBeNull();
    expect(screen.queryByText(/Plume entry point/)).toBeNull();
    expect(screen.queryByText(/Bakas/)).toBeNull();
    expect(await screen.findByText("pending approval")).toBeDefined();
    expect(screen.getByRole("link", { name: "Review on Sampling page" }).getAttribute("href")).toBe("/sampling");
    expect(screen.getByRole("link", { name: "Open the plume record" }).getAttribute("href")).toBe("/plumes/27");

    for (const figure of screen.getAllByRole("figure")) {
      for (const image of within(figure).getAllByRole("img")) expect(image.getAttribute("alt")?.length).toBeGreaterThan(20);
      expect(figure.querySelector("figcaption")?.textContent?.length).toBeGreaterThan(20);
    }
    // Both Binangonan figures are white-background charts, so both get the paper frame.
    expect(document.querySelectorAll(".story-figure__single--chart")).toHaveLength(2);
  });

  it("doesn't ask for sampling tasks for signed-out visitors on a dry-weather story", async () => {
    stubApi({ tasksStatus: 401 });
    renderAt("/story/lumban-mar-2026");

    expect(
      await screen.findByText("Sign in as a researcher to see whether a sampling task was proposed."),
    ).toBeDefined();
    expect(screen.getByRole("link", { name: "Open in Explore map" }).getAttribute("href")).toBe(
      "/explore?place=Lumban&from=2026-03-07&to=2026-03-07",
    );
    expect(requestedPaths()).not.toContain("/api/sampling-tasks");
  });

  it("shows the recorded run to public viewers, offers the map, and still shows the plume if tasks need sign-in", async () => {
    stubApi({ tasksStatus: 401 });
    renderAt("/story/calamba-sep-2026");

    expect(await screen.findByText("Sep 25, 2026 · 806 ha · 37.5 mm of rain in 3 days")).toBeDefined();
    expect(screen.getByText("Recorded agent run · Oct 25, 2026")).toBeDefined();
    expect(await screen.findByText("Logged as expected (rain or known source)")).toBeDefined();
    expect(screen.getByText("heavy rain in the past week explains the plume")).toBeDefined();
    expect(screen.getByText("Looked at the 10 m image")).toBeDefined();
    expect(screen.getByText("Checked recent rainfall")).toBeDefined();
    expect(screen.getByText(/A wet week explained it/)).toBeDefined();
    expect(screen.queryByText(/Not yet triaged/)).toBeNull();
    // An after-rain story has nothing to sample, so it doesn't ask about a sampling task.
    expect(screen.queryByText(/Sign in as a researcher/)).toBeNull();
    expect(screen.getByRole("link", { name: "Open in Explore map" }).getAttribute("href")).toBe(
      "/explore?place=Calamba&from=2026-09-25&to=2026-09-25",
    );
    expect(requestedPaths()).not.toContain("/api/sampling-tasks");
    // The after image's labels are in Filipino; the caption gives their English meaning.
    expect(screen.getByText(/brown head = sediment/)).toBeDefined();
  });

  it("tells the Pililla story: a cloud edge at 10 m, so an image artifact, not samples", async () => {
    stubApi({ tasksStatus: 401 });
    renderAt("/story/pililla-apr-2026");

    expect(screen.getByRole("heading", { level: 1, name: "Pililla, April 2026: a cloud, not a plume" })).toBeDefined();
    expect(screen.getByText("Image artifact: not a plume")).toBeDefined();
    expect(await screen.findByText("Apr 21, 2026 · 100 ha · 0.4 mm of rain in 3 days")).toBeDefined();
    expect(await screen.findByText("Marked as an image artifact")).toBeDefined();
    expect(screen.getByText("cloud edge visible at 10 m")).toBeDefined();
    expect(screen.getByText(/saw a cloud edge, and stopped there/)).toBeDefined();
    // The artifact review, not rain, keeps it off the dry-weather list, so no "After rain" badge.
    expect(screen.queryByText("After rain")).toBeNull();
    expect(screen.queryByText("Checked recent rainfall")).toBeNull();
    expect(screen.queryByText(/illegal/i)).toBeNull();
  });

  it("says the decision is for researchers when there is no recorded run", async () => {
    stubApi({ tasksStatus: 401 });
    renderAt("/story/lumban-mar-2026");

    expect(await screen.findByText("The agent's decision is shown to signed-in researchers.")).toBeDefined();
    expect(screen.queryByText(/Recorded agent run/)).toBeNull();
  });

  it("compares the before/after pair with a slider and opens it full size", async () => {
    stubApi();
    renderAt("/story/calamba-sep-2026");

    expect(screen.getByText("Sep 18: normal, before the heaviest rain")).toBeDefined();
    expect(screen.getByText("Sep 25: after a week of rain")).toBeDefined();
    const slider = screen.getByRole("slider", { name: /Before and after/ });
    expect(slider.getAttribute("aria-valuenow")).toBe("50");
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(slider.getAttribute("aria-valuenow")).toBe("51");

    fireEvent.click(screen.getByRole("button", { name: "View full size" }));
    const dialog = screen.getByRole("dialog", { name: "Full-size image" });
    const close = within(dialog).getByRole("button", { name: "Close" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says when a story doesn't exist", () => {
    stubApi();
    renderAt("/story/nowhere");
    expect(screen.getByRole("heading", { level: 1, name: "Story not found" })).toBeDefined();
    expect(screen.getByRole("link", { name: "See all stories" }).getAttribute("href")).toBe("/story");
  });
});

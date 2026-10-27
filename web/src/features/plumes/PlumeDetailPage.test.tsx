import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, type AuthUser } from "../../shared/auth";
import { fakeBackend, researcher } from "../../shared/auth/testing";
import type { PlumeDetail, Review } from "./api";
import { PlumeDetailPage } from "./PlumeDetailPage";
import { binangonanDetail, binangonanHistory, binangonanPublic, existingReview } from "./plumes.fixture";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

interface StubOptions {
  detail?: PlumeDetail;
  reviews?: Review[];
  postStatus?: number;
}

/** In-memory stand-in for the plume endpoints; POST adds to the reviews list. */
function stubApi({ detail = binangonanDetail, reviews = [], postStatus = 201 }: StubOptions = {}) {
  const store = [...reviews];
  const posts: unknown[] = [];
  const calls: { method: string; path: string; authorization: string | null }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url ?? String(input), "http://localhost");
    const method = request?.method ?? init?.method ?? "GET";
    calls.push({ method, path: url.pathname, authorization: request?.headers.get("Authorization") ?? null });
    if (url.pathname === `/api/plumes/${detail.id}`) return json(detail);
    if (url.pathname === "/api/plumes") return json(binangonanHistory);
    if (url.pathname === `/api/plumes/${detail.id}/reviews`) {
      if (method === "GET") return json(store);
      const body: unknown = request !== null ? await request.json() : JSON.parse(String(init?.body));
      posts.push(body);
      if (postStatus !== 201) return json({ detail: "Reason is too short" }, postStatus);
      // The API takes the reviewer from the token, never from the body.
      const created = { ...(body as object), id: 100 + store.length, reviewer: researcher.username, reviewed_at: "2026-10-18T03:00:00Z" };
      store.unshift(created as Review);
      return json(created, 201);
    }
    return json({ detail: "Not Found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { posts, calls };
}

function renderPlume(id: number, user: AuthUser | null = researcher) {
  const router = createMemoryRouter(
    [
      { path: "/plumes/:plumeId", element: <PlumeDetailPage /> },
      { path: "/explore", element: <p>map</p> },
    ],
    { initialEntries: [`/plumes/${id}`] },
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider backend={fakeBackend(user)}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("plume detail", () => {
  it("shows header, evidence, rain, history and the agent decision", async () => {
    stubApi();
    renderPlume(27);

    expect(await screen.findByRole("heading", { level: 1, name: /Binangonan/ })).toBeDefined();
    expect(screen.getByText("Sampling: pending approval")).toBeDefined();
    expect(screen.getByRole("img", { name: /Sentinel-2 crop of the plume at Binangonan/ })).toBeDefined();
    expect(screen.getByText("1.2 mm")).toBeDefined();
    expect(screen.getByText("1.4 mm")).toBeDefined();
    const verdict = screen.getByText(/runoff doesn't explain it/).closest("p");
    expect(verdict?.textContent).toBe(
      "Dry weather: Suspicious, verify. Only 1.2 mm of rain fell in the 3 days before, so runoff doesn't explain it.",
    );
    const legend = screen.getByRole("list", { name: "What the marks on the image mean" });
    expect(within(legend).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Red outline: the plume.",
      "Yellow outline: cloud and shadow zone, ignored.",
      "+White cross: where the water enters the lake.",
    ]);
    expect(screen.getByText("Workflow status:")).toBeDefined();
    expect(screen.getByText("Field sampling requested, pending approval")).toBeDefined();
    expect(screen.queryByText(/illegal/i)).toBeNull();

    const timeline = await screen.findByRole("list", { name: "" });
    const links = within(timeline).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/plumes/27", "/plumes/19", "/plumes/8"]);
    expect(links[0].getAttribute("aria-current")).toBe("page");
  });

  it("says after rain is expected runoff", async () => {
    stubApi({ detail: { ...binangonanDetail, is_dry: false, rain_3d_mm: 37.5 } });
    renderPlume(27);
    const sentence = await screen.findByText(/rivers carry mud/);
    expect(sentence.closest("p")?.textContent).toBe(
      "After rain: Expected runoff. 37.5 mm of rain fell in the 3 days before; rivers carry mud into the lake after storms.",
    );
  });

  it("says when there is no rain data", async () => {
    stubApi({ detail: { ...binangonanDetail, is_dry: false, rain_3d_mm: null } });
    renderPlume(27);
    expect(await screen.findByText(/No rain data for these days/)).toBeDefined();
    expect(screen.queryByText(/Expected runoff|Suspicious, verify\. Only/)).toBeNull();
  });

  it("does not call a plume reviewed as an artifact after rain", async () => {
    const latest_review = { verdict: "artifact", reviewed_at: "2026-10-15T09:48:00Z" };
    stubApi({ detail: { ...binangonanDetail, is_dry: false, rain_3d_mm: 4.6, latest_review } });
    renderPlume(27);
    expect(await screen.findByText(/marked this as an image artifact/)).toBeDefined();
    expect(screen.queryByText(/Expected runoff/)).toBeNull();
  });

  it("hides the reviewed workflow status from public viewers", async () => {
    stubApi({ detail: { ...binangonanPublic, status: "reviewed" } });
    renderPlume(27, null);
    expect(await screen.findByText(/runoff doesn't explain it/)).toBeDefined();
    expect(screen.queryByText("Reviewed")).toBeNull();
    expect(screen.queryByText("Workflow status:")).toBeNull();
  });

  it("says Not yet triaged when there is no decision", async () => {
    stubApi({ detail: { ...binangonanDetail, status: "new", latest_decision: null, evidence_image_url: null } });
    renderPlume(27);
    expect(await screen.findByText("Not yet triaged.")).toBeDefined();
    expect(screen.getByText("New")).toBeDefined();
    expect(screen.getByText("No evidence image yet for this plume.")).toBeDefined();
    expect(screen.queryByRole("list", { name: "What the marks on the image mean" })).toBeNull();
  });

  it("shows a not-found state for unknown plumes", async () => {
    stubApi();
    renderPlume(999);
    expect(await screen.findByRole("heading", { level: 1, name: "Plume not found" })).toBeDefined();
  });

  it("sends the bearer token and shows researcher sections", async () => {
    const { calls } = stubApi();
    renderPlume(27);
    expect(await screen.findByRole("heading", { name: "Agent decision" })).toBeDefined();
    await screen.findByRole("form", { name: "Add a review" });
    const detail = calls.find((call) => call.path === "/api/plumes/27");
    expect(detail?.authorization).toBe("Bearer token-ana");
    const reviews = calls.find((call) => call.path === "/api/plumes/27/reviews");
    expect(reviews?.authorization).toBe("Bearer token-ana");
  });

  it("collapses decision and reviews into one sign-in card for public viewers", async () => {
    const { calls } = stubApi({ detail: binangonanPublic });
    renderPlume(27, null);
    expect(await screen.findByRole("heading", { name: "Sign in to see the agent's assessment and reviews" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Agent decision" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Reviews" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Add a review" })).toBeNull();
    // Status still comes from the API for everyone.
    expect(screen.getByText("Sampling: pending approval")).toBeDefined();
    expect(calls.some((call) => call.path === "/api/plumes/27/reviews")).toBe(false);
    expect(calls.every((call) => call.authorization === null)).toBe(true);
    expect(screen.queryByText(/illegal/i)).toBeNull();
  });

  it("validates the review form before sending, with no reviewer-name field", async () => {
    const { posts } = stubApi();
    renderPlume(27);
    const form = await screen.findByRole("form", { name: "Add a review" });
    expect(within(form).queryByLabelText(/name/i)).toBeNull();
    expect(within(form).getAllByRole("textbox")).toHaveLength(1);
    expect(within(form).getByText(/Recorded as/).textContent).toBe("Recorded as ana");
    fireEvent.click(within(form).getByRole("button", { name: "Save review" }));
    expect(screen.getByText("Choose a verdict.")).toBeDefined();
    expect(screen.getByText("Add a short note on what you saw.")).toBeDefined();
    expect(posts).toHaveLength(0);
  });

  it("adds a submitted review to the list right away, sending it once", async () => {
    const { posts } = stubApi({ reviews: [existingReview] });
    renderPlume(27);
    expect(await screen.findByText("Visually consistent with a water-color plume")).toBeDefined();

    fireEvent.click(screen.getByRole("radio", { name: "Uncertain" }));
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Shoreline looks hazy, re-check." } });
    const submit = screen.getByRole("button", { name: "Save review" });
    fireEvent.click(submit);
    expect(submit).toHaveProperty("disabled", true);
    expect(submit.textContent).toBe("Saving...");
    fireEvent.click(submit);

    const list = await screen.findByRole("list", { name: "Reviews" });
    await waitFor(() => expect(within(list).getByText("Shoreline looks hazy, re-check.")).toBeDefined());
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Review saved.")).toBeDefined();
    expect(posts).toEqual([{ verdict: "uncertain", reason: "Shoreline looks hazy, re-check." }]);
    expect(within(list).getAllByText(/^ana ·/)).toHaveLength(1);
  });

  it("shows the API's validation message when a review is rejected", async () => {
    stubApi({ postStatus: 422 });
    renderPlume(27);
    fireEvent.click(await screen.findByRole("radio", { name: /Plume confirmed/ }));
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "ok then" } });
    fireEvent.click(screen.getByRole("button", { name: "Save review" }));
    expect(await screen.findByText("Reason is too short")).toBeDefined();
  });
});

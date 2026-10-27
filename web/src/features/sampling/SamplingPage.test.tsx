import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../../shared/auth";
import { fakeBackend, researcher } from "../../shared/auth/testing";
import type { SamplingTask } from "./api";
import { groupTasks } from "./grouping";
import { SamplingPage } from "./SamplingPage";

// MapLibre needs WebGL, which jsdom lacks.
vi.mock("./SitesMiniMap", () => ({ default: () => <div>mini map</div> }));

const seedTask: SamplingTask = {
  id: 1,
  event_id: 27,
  decision_id: null,
  status: "pending_approval",
  sites: [
    { label: "entry_point", lon: 121.1546, lat: 14.5044 },
    { label: "plume_centroid", lon: 121.15, lat: 14.5 },
  ],
  requested_reason: "Suspicious, verify: dry-weather plume seen at the Binangonan shoreline.",
  reviewed_by: null,
  review_note: null,
  created_at: "2026-05-07T02:00:00Z",
  reviewed_at: null,
  place: "Binangonan",
  plume_date: "2026-05-06",
};

const seedPlume = {
  viewer: "researcher",
  status: "sampling_pending",
  id: 27,
  place: "Binangonan",
  province: "Rizal",
  date: "2026-05-06",
  area_ha: 92,
  kind: "turbid",
  rain_3d_mm: 0.2,
  rain_7d_mm: 1.4,
  is_dry: true,
  entry_lat: 14.5044,
  entry_lon: 121.1546,
  latest_review: null,
  latest_decision: null,
  evidence_image_url: "https://example.test/crop-27.png",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

interface Server {
  tasks: SamplingTask[];
  /** Resolve to let a held POST finish. */
  release: () => void;
  posts: number;
  bodies: unknown[];
  /** Authorization header of each approve/reject request. */
  authorization: (string | null)[];
}

/** In-memory stand-in for the sampling endpoints. `hold` keeps POSTs waiting until release(). */
function stubApi(options: { tasks?: SamplingTask[]; hold?: boolean; decidedBy?: string; failWith?: number } = {}) {
  let releaseHeld: () => void = () => undefined;
  const server: Server = {
    tasks: (options.tasks ?? [seedTask]).map((task) => ({ ...task })),
    release: () => releaseHeld(),
    posts: 0,
    bodies: [],
    authorization: [],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Request) => {
      const url = new URL(input.url);
      if (input.method === "GET" && url.pathname === "/api/sampling-tasks") return json(server.tasks);
      if (url.pathname === "/api/plumes/27") return json(seedPlume);
      const one = url.pathname.match(/^\/api\/sampling-tasks\/(\d+)$/);
      if (one) return json(server.tasks.find((task) => task.id === Number(one[1])));
      const decide = url.pathname.match(/^\/api\/sampling-tasks\/(\d+)\/(approve|reject)$/);
      if (decide && input.method === "POST") {
        server.posts += 1;
        server.authorization.push(input.headers.get("Authorization"));
        const body = (await input.json()) as { note: string };
        server.bodies.push(body);
        if (options.hold) await new Promise<void>((resolve) => (releaseHeld = resolve));
        if (options.failWith !== undefined) return json({ detail: "Database unavailable" }, options.failWith);
        const task = server.tasks.find((item) => item.id === Number(decide[1]));
        if (task === undefined) return json({ detail: "Sampling task not found" }, 404);
        if (options.decidedBy !== undefined) {
          Object.assign(task, { status: "approved", reviewed_by: options.decidedBy, reviewed_at: "2026-10-18T01:00:00Z" });
        }
        if (task.status !== "pending_approval") {
          return json(
            { detail: `task ${task.id} is ${task.status}; cannot ${decide[2]}`, status: task.status, reviewed_by: task.reviewed_by },
            409,
          );
        }
        Object.assign(task, {
          status: decide[2] === "approve" ? "approved" : "rejected",
          // The API takes the reviewer from the token, never from the body.
          reviewed_by: researcher.username,
          review_note: body.note,
          reviewed_at: "2026-10-18T02:00:00Z",
        });
        return json(task);
      }
      return json({ detail: "Not Found" }, 404);
    }),
  );
  return server;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider backend={fakeBackend(researcher)}>
        <MemoryRouter>
          <SamplingPage />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const group = (name: RegExp) => screen.getByRole("region", { name });

async function fillAndConfirmStep(action: "Approve..." | "Reject...") {
  fireEvent.click(await screen.findByRole("button", { name: action }));
  fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Upstream factory outfall, sample this week." } });
  fireEvent.click(screen.getByRole("button", { name: /Review (approval|rejection)/ }));
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("groupTasks", () => {
  it("orders groups pending first and keeps empty groups", () => {
    const tasks: SamplingTask[] = [
      { ...seedTask, id: 2, status: "rejected" },
      { ...seedTask, id: 3, status: "approved" },
      { ...seedTask, id: 4, status: "pending_approval", created_at: "2026-01-01T00:00:00Z" },
      seedTask,
    ];
    const groups = groupTasks(tasks);
    expect(groups.map((g) => g.status)).toEqual(["pending_approval", "approved", "done", "rejected"]);
    expect(groups.map((g) => g.tasks.map((t) => t.id))).toEqual([[1, 4], [3], [], [2]]);
  });
});

describe("sampling page", () => {
  it("lists tasks by status with per-group empty states and no auto-approval", async () => {
    stubApi();
    renderPage();
    const pending = await screen.findByRole("region", { name: /Pending approval/ });
    expect(within(pending).getByRole("link", { name: /Binangonan/ }).getAttribute("href")).toBe("/plumes/27");
    expect(within(pending).getByText(/Suspicious, verify/)).toBeDefined();
    expect(within(group(/Approved/)).getByText("No approved tasks yet.")).toBeDefined();
    expect(screen.queryByText(/illegal/i)).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("shows an overall empty state", async () => {
    stubApi({ tasks: [] });
    renderPage();
    expect(await screen.findByText(/No sampling tasks yet/)).toBeDefined();
  });

  it("requires a note before the confirm step and has no reviewer-name field", async () => {
    const server = stubApi();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Approve..." }));
    const form = screen.getByRole("form", { name: "Approve task" });
    expect(within(form).queryByLabelText(/name/i)).toBeNull();
    expect(within(form).getAllByRole("textbox")).toHaveLength(1);
    expect(within(form).getByText(/Recorded as/).textContent).toBe("Recorded as ana");
    fireEvent.click(screen.getByRole("button", { name: "Review approval" }));
    expect(screen.getByText("Add a note explaining your decision.")).toBeDefined();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(server.posts).toBe(0);
  });

  it("confirms in-page, stating what will happen, and Go back sends nothing", async () => {
    const server = stubApi();
    renderPage();
    await fillAndConfirmStep("Approve...");
    const dialog = screen.getByRole("alertdialog", { name: "Approve field sampling?" });
    expect(dialog.textContent).toContain("moves to Approved");
    expect(dialog.textContent).toContain("water samples at 2 sites near Binangonan");
    expect(dialog.textContent).toContain("approved by ana");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Go back" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Go back" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(server.posts).toBe(0);
  });

  it("moves the card to Approved at once and sends one request", async () => {
    const server = stubApi({ hold: true });
    renderPage();
    await fillAndConfirmStep("Approve...");
    const yes = screen.getByRole("button", { name: "Yes, approve" });
    fireEvent.click(yes);
    fireEvent.click(yes);

    // Optimistic: moved before the server answers.
    await waitFor(() => expect(within(group(/Approved/)).getByRole("link", { name: /Binangonan/ })).toBeDefined());
    expect(within(group(/Pending approval/)).getByText("Nothing is waiting for approval.")).toBeDefined();
    server.release();
    const notice = await screen.findByText(/Approved: a field team is asked to take water samples at Binangonan/);
    // Focus follows the outcome, since the card has left the Pending group.
    await waitFor(() => expect(document.activeElement).toBe(notice.closest("[role=status]")));
    expect(server.posts).toBe(1);
    expect(server.tasks[0].status).toBe("approved");
    expect(server.tasks[0].reviewed_by).toBe("ana");
    expect(server.bodies).toEqual([{ note: "Upstream factory outfall, sample this week." }]);
    expect(server.authorization).toEqual(["Bearer token-ana"]);
  });

  it("moves the card to Rejected optimistically while the request is in flight", async () => {
    stubApi({ decidedBy: "Ana", hold: true });
    renderPage();
    await fillAndConfirmStep("Reject...");
    fireEvent.click(screen.getByRole("button", { name: "Yes, reject" }));
    await waitFor(() => expect(within(group(/Rejected/)).getByRole("link", { name: /Binangonan/ })).toBeDefined());
  });

  it("shows the 409 message and ends with the server's status", async () => {
    const server = stubApi({ decidedBy: "Ana" });
    renderPage();
    await fillAndConfirmStep("Reject...");
    fireEvent.click(screen.getByRole("button", { name: "Yes, reject" }));
    expect(await screen.findByText("This task was already approved by Ana — refreshed.")).toBeDefined();
    await waitFor(() => expect(within(group(/Approved/)).getByRole("link", { name: /Binangonan/ })).toBeDefined());
    expect(within(group(/Rejected/)).getByText("No rejected tasks.")).toBeDefined();
    expect(server.tasks[0].reviewed_by).toBe("Ana");
  });

  it("rolls back with an error message on other failures", async () => {
    stubApi({ failWith: 503 });
    renderPage();
    await fillAndConfirmStep("Approve...");
    fireEvent.click(screen.getByRole("button", { name: "Yes, approve" }));
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByText(/Couldn't approve the task: Database unavailable/)).toBeDefined();
    await waitFor(() => expect(within(group(/Pending approval/)).getByRole("link", { name: /Binangonan/ })).toBeDefined());
  });

  it("tells the story and shows the evidence and consequence before the decision", async () => {
    stubApi();
    renderPage();
    const pending = await screen.findByRole("region", { name: /Pending approval/ });
    expect(await within(pending).findByText(/^A 92 ha plume was seen at Binangonan on .*2026 in dry weather.$/)).toBeDefined();
    const crop = await within(pending).findByRole("img", { name: /Satellite crop of the plume at Binangonan/ });
    expect(crop.getAttribute("src")).toBe(seedPlume.evidence_image_url);
    expect(within(pending).getByRole("link", { name: "See the plume and its history" }).getAttribute("href")).toBe("/plumes/27");
    expect(within(pending).getByText(/Approving asks a field team to take water samples at 2 sites near Binangonan/)).toBeDefined();
  });

  it("moves keyboard focus into the note and back to the button on Cancel", async () => {
    stubApi();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Reject..." }));
    expect(document.activeElement).toBe(screen.getByLabelText("Note"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Reject..." })));
  });
});

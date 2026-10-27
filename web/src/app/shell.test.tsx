import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../shared/auth";
import { fakeBackend, researcher } from "../shared/auth/testing";
import { ThemeProvider } from "../shared/theme/ThemeProvider";
import { ConfirmDialog } from "../shared/ui/ConfirmDialog";
import { routes } from "./routes";

// MapLibre needs WebGL, which jsdom lacks.
vi.mock("../features/explore/PlumeMap", () => ({ PlumeMap: () => <div>map</div> }));

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

const never = () => new Promise<Response>(() => undefined);
const failing = async () => new Response(JSON.stringify({ detail: "down" }), { status: 503 });

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("shell", () => {
  it("has a skip link that targets main", async () => {
    vi.stubGlobal("fetch", vi.fn(never));
    renderAt("/");
    const skip = await screen.findByRole("link", { name: "Skip to content" });
    expect(skip.getAttribute("href")).toBe("#main");
    const main = screen.getByRole("main");
    expect(main.id).toBe("main");
    expect(main.getAttribute("tabindex")).toBe("-1");
  });

  it("has an icon theme toggle labelled with the theme it switches to", async () => {
    vi.stubGlobal("fetch", vi.fn(never));
    renderAt("/");
    const toggle = await screen.findByRole("button", { name: "Switch to dark theme" });
    const icon = toggle.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon?.closest('[aria-hidden="true"]')).not.toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeDefined();
    document.documentElement.removeAttribute("data-theme");
    window.localStorage.clear();
  });

  it("keeps account and theme in one menu that opens, and closes on Escape", async () => {
    vi.stubGlobal("fetch", vi.fn(never));
    renderAt("/", fakeBackend(researcher));
    const trigger = await screen.findByRole("button", { name: "Account menu" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
    expect(within(panel as HTMLElement).getByText("ana")).toBeDefined();
    expect(within(panel as HTMLElement).getByRole("button", { name: "Sign out" })).toBeDefined();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("moves focus to main after navigating", async () => {
    vi.stubGlobal("fetch", vi.fn(never));
    const router = renderAt("/");
    await screen.findByRole("heading", { level: 1, name: /A satellite can.t tell/ });
    await router.navigate("/sampling");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("main")));
  });

  it("shows a 404 page for unknown paths, with the path and ways out", async () => {
    vi.stubGlobal("fetch", vi.fn(never));
    renderAt("/no/such/page?x=1");
    expect(await screen.findByRole("heading", { level: 1, name: "Page not found" })).toBeDefined();
    expect(screen.getByText("/no/such/page?x=1")).toBeDefined();
    expect(screen.getByRole("link", { name: "Go to Home" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "Explore the map" }).getAttribute("href")).toBe("/explore");
    expect(screen.getByRole("navigation", { name: "Main" })).toBeDefined();
  });

  it("shows plume not found for a non-numeric id without calling the API", async () => {
    const fetchMock = vi.fn(never);
    vi.stubGlobal("fetch", fetchMock);
    renderAt("/plumes/abc");
    expect(await screen.findByRole("heading", { level: 1, name: "Plume not found" })).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// Each page: a polite loading status while its queries are pending, and an alert with Retry when they fail.
describe.each([
  ["/", "Loading the numbers...", "Can't load the numbers right now."],
  ["/explore", "Loading plume sightings...", "Can't load plume sightings right now."],
  ["/story", "Loading the live record...", "Can't load the live record right now."],
  ["/story/calamba-sep-2026", "Loading the live record...", "Can't load the live record right now."],
  ["/sampling", "Loading sampling tasks...", "Can't load sampling tasks right now."],
  ["/plumes/27", "Loading plume...", "Can't load this plume right now."],
])("page %s", (path, loadingText, errorText) => {
  it("shows its loading state while pending", async () => {
    vi.stubGlobal("fetch", vi.fn(never));
    renderAt(path, fakeBackend(researcher));
    const loading = (await screen.findAllByText(loadingText))[0];
    const status = loading.closest('[role="status"]');
    expect(status).not.toBeNull();
    // Skeleton shapes stand in for the content and are hidden from assistive tech.
    const shapes = status?.querySelectorAll('.skeleton') ?? [];
    expect(shapes.length).toBeGreaterThan(0);
    for (const shape of shapes) expect(shape.getAttribute('aria-hidden')).toBe('true');
  });

  it("shows its error state with Retry when the query fails", async () => {
    vi.stubGlobal("fetch", vi.fn(failing));
    renderAt(path, fakeBackend(researcher));
    // The plume page retries once before showing the error, so allow for that delay.
    const error = (await screen.findAllByText(errorText, undefined, { timeout: 4000 }))[0];
    const alert = error.closest('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(within(alert as HTMLElement).getByRole("button", { name: "Retry" })).toBeDefined();
  });
});

describe("how it's built", () => {
  it("shows its sections and both diagrams with alt text and full-size links", async () => {
    vi.stubGlobal("fetch", vi.fn(never));
    renderAt("/how-its-built");
    expect(await screen.findByRole("heading", { level: 1, name: "How Lawata is built" })).toBeDefined();
    const main = within(screen.getByRole("main"));
    const sections = main.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(sections).toEqual([
      "The Agentic Vision requirement",
      "Runtime: what runs when you use Lawata",
      "Delivery: how code gets to production",
    ]);
    const runtime = screen.getByRole("img", { name: /^Runtime architecture\./ });
    const delivery = screen.getByRole("img", { name: /^Delivery pipeline\./ });
    // Light theme (matchMedia is stubbed to not-dark), so the light diagrams show.
    expect(runtime.getAttribute("src")).toMatch(/arch-runtime-light/);
    expect(delivery.getAttribute("src")).toMatch(/arch-delivery-light/);
    expect(screen.getAllByRole("link", { name: "Open full size" })).toHaveLength(2);
    expect(screen.queryByText(/illegal/i)).toBeNull();
  });
});

describe("ConfirmDialog", () => {
  function Harness({ onCancel }: { onCancel: () => void }) {
    return (
      <ConfirmDialog title="Approve?" confirmLabel="Yes, approve" onConfirm={() => undefined} onCancel={onCancel}>
        <p>Body</p>
      </ConfirmDialog>
    );
  }

  it("starts on Go back, traps Tab, cancels on Escape and returns focus to the opener", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const onCancel = vi.fn();
    const { unmount } = render(<Harness onCancel={onCancel} />);

    const back = screen.getByRole("button", { name: "Go back" });
    const yes = screen.getByRole("button", { name: "Yes, approve" });
    expect(document.activeElement).toBe(back);

    yes.focus();
    fireEvent.keyDown(yes, { key: "Tab" });
    expect(document.activeElement).toBe(back);
    fireEvent.keyDown(back, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(yes);

    fireEvent.keyDown(yes, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe("feedback", () => {
  it("shows the floating button off the map and opens the form from the footer link", async () => {
    vi.stubGlobal("fetch", never);
    renderAt("/privacy");
    expect(await screen.findByRole("heading", { level: 1, name: "Privacy notice" })).toBeDefined();
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "Privacy notice" }).getAttribute("href")).toBe("/privacy");
    expect(within(footer).getByRole("link", { name: "Terms of use" }).getAttribute("href")).toBe("/terms");
    expect(within(footer).getByRole("link", { name: "How it's built" }).getAttribute("href")).toBe("/how-its-built");
    expect(within(footer).getByRole("link", { name: "johncurada.dev@gmail.com" }).getAttribute("href")).toBe(
      "mailto:johncurada.dev@gmail.com",
    );
    expect(screen.getAllByRole("button", { name: "Send feedback" })).toHaveLength(2);

    fireEvent.click(within(footer).getByRole("button", { name: "Send feedback" }));
    expect(screen.getByRole("dialog", { name: "Send feedback" })).toBeDefined();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("has no floating button on the map", async () => {
    vi.stubGlobal("fetch", never);
    renderAt("/explore");
    expect(await screen.findByRole("heading", { level: 1, name: "Explore" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Send feedback" })).toBeNull();
  });
});

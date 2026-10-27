import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readTrace } from "../agentTrace";
import { AgentRun } from "./AgentRun";

const outcome = readTrace(
  [
    { tool: "inspect_plume", args: {}, result: { plume_found: true, clear_water_frac: 0.84 }, ms: 1234 },
    { tool: "get_rainfall", args: {}, result: { rain_3d_mm: 1.2, rain_7d_mm: 1.4, is_dry: true }, ms: 900 },
    { tool: "create_sampling_task", args: { reason: "Suspicious, verify." } },
  ],
  "create_sampling_task",
  "Suspicious, verify.",
);

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AgentRun", () => {
  it("ticks while working, then reveals the real steps one by one and the decision last", () => {
    const { rerender } = render(<AgentRun title="Box 2.1 × 1.4 km" model="us.anthropic.claude-haiku-4-5-20251001-v1:0" running outcome={null} />);
    expect(screen.getByText("Claude Haiku 4.5")).toBeDefined();
    expect(screen.getByText("Working")).toBeDefined();
    act(() => void vi.advanceTimersByTime(3100));
    expect(screen.getByText("0:03")).toBeDefined();

    rerender(<AgentRun title="Box 2.1 × 1.4 km" running={false} outcome={outcome} />);
    expect(screen.queryByText("Looked at the 10 m image")).toBeNull();
    act(() => void vi.advanceTimersByTime(150));
    expect(screen.getByText("Looked at the 10 m image")).toBeDefined();
    expect(screen.queryByText("Field sampling requested, pending approval")).toBeNull();
    act(() => void vi.advanceTimersByTime(300));
    expect(screen.getByText("1.2s")).toBeDefined();
    expect(screen.getByText("Field sampling requested, pending approval")).toBeDefined();
    expect(screen.getByText("Done")).toBeDefined();
    // The timer stops when the run ends.
    act(() => void vi.advanceTimersByTime(5000));
    expect(screen.getByText("0:03")).toBeDefined();
  });

  it("keeps the busy shimmer out of the live region so finished steps are announced once", () => {
    const { container, rerender } = render(<AgentRun title="Box" running outcome={null} />);
    const live = container.querySelector('[aria-live="polite"]');
    expect(live?.getAttribute("aria-relevant")).toBe("additions");
    const working = screen.getByText("Investigating").closest("[aria-busy]");
    expect(working?.getAttribute("aria-busy")).toBe("true");
    expect(live?.contains(working ?? null)).toBe(false);

    rerender(<AgentRun title="Box" running={false} outcome={outcome} />);
    act(() => void vi.advanceTimersByTime(1000));
    expect(container.querySelector("[aria-busy]")).toBeNull();
    expect(live?.textContent).toContain("Looked at the 10 m image");
    expect(live?.textContent).toContain("Field sampling requested, pending approval");
  });

  it("opens a step to show what the tool found, and replays the steps", () => {
    render(<AgentRun title="Box" running={false} outcome={outcome} />);
    act(() => void vi.advanceTimersByTime(1000));

    const rain = screen.getByRole("button", { name: /Checked recent rainfall/ });
    expect(rain.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(rain);
    expect(rain.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Rain, 3 days: 1.2 mm")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Replay the steps" }));
    expect(screen.queryByText("Checked recent rainfall")).toBeNull();
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.getByText("Checked recent rainfall")).toBeDefined();
  });
});

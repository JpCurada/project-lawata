import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageCompare } from "./image-compare/image-compare";
import { SearchField } from "./search-field/search-field";
import SegmentedControl from "./segmented-control/segmented-control";
import { TextShimmer } from "./text-shimmer/text-shimmer";
import { ThemeSwitch, type Theme } from "./theme-switch/theme-switch";

// Vendored Arc components render in jsdom with the stubs from src/test/setup.ts (matchMedia, IntersectionObserver).
describe("Arc components", () => {
  let errors: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errors = vi.spyOn(console, "error");
  });
  afterEach(() => {
    cleanup();
    errors.mockRestore();
  });

  it("renders TextShimmer as a busy status line", () => {
    render(<TextShimmer>Checking rainfall</TextShimmer>);
    expect(screen.getByText("Checking rainfall").closest("[aria-busy]")).not.toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });

  it("renders ImageCompare with a keyboard slider", () => {
    render(<ImageCompare before={<img src="a.jpg" alt="Before" />} after={<img src="b.jpg" alt="After" />} label="Compare dates" />);
    const slider = screen.getByRole("slider", { name: "Compare dates" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider.getAttribute("aria-valuenow")).toBe("49");
    expect(errors).not.toHaveBeenCalled();
  });

  it("switches SegmentedControl options", () => {
    function Harness() {
      const [value, setValue] = useState("dry");
      return <SegmentedControl label="Weather" value={value} onValueChange={setValue} options={[{ value: "dry", label: "Dry" }, { value: "rain", label: "After rain" }]} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "After rain" }));
    expect(screen.getByRole("button", { name: "After rain" }).getAttribute("aria-pressed")).toBe("true");
    expect(errors).not.toHaveBeenCalled();
  });

  it("clears SearchField", () => {
    function Harness() {
      const [value, setValue] = useState("Laguna");
      return <SearchField label="Search places" value={value} onValueChange={setValue} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect((screen.getByLabelText("Search places") as HTMLInputElement).value).toBe("");
    expect(errors).not.toHaveBeenCalled();
  });

  it("asks ThemeSwitch's owner to change the theme", async () => {
    const onThemeChange = vi.fn<(next: Theme) => void>();
    render(<ThemeSwitch theme="light" onThemeChange={onThemeChange} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Switch to dark mode" }));
    });
    expect(onThemeChange).toHaveBeenCalledWith("dark", "reveal", expect.any(HTMLElement));
    expect(errors).not.toHaveBeenCalled();
  });
});

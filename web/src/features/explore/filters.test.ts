import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  applyFilters,
  dateSpanOf,
  emptyFilters,
  filtersToParams,
  parseFilters,
  placesOf,
  type PlumeFilters,
} from "./filters";
import { plumesFixture } from "./plumes.fixture";

const features = plumesFixture.features;
const ids = (filters: PlumeFilters) => applyFilters(features, filters).map((f) => f.properties.id);

describe("parseFilters / filtersToParams", () => {
  it("reads all filters from the URL", () => {
    const params = new URLSearchParams("from=2025-01-01&to=2026-06-30&place=Binangonan&dry=1");
    expect(parseFilters(params)).toEqual({
      from: "2025-01-01",
      to: "2026-06-30",
      place: "Binangonan",
      dryOnly: true,
    });
  });

  it("defaults to no filters and ignores invalid values", () => {
    expect(parseFilters(new URLSearchParams())).toEqual(emptyFilters);
    const params = new URLSearchParams("from=yesterday&to=2026-13-45&place=%20&dry=yes");
    expect(parseFilters(params)).toEqual(emptyFilters);
  });

  it("round-trips and omits defaults", () => {
    const filters: PlumeFilters = { from: "2024-01-01", to: null, place: "Santa Cruz", dryOnly: true };
    const params = filtersToParams(filters);
    expect(params.toString()).toBe("from=2024-01-01&place=Santa+Cruz&dry=1");
    expect(parseFilters(params)).toEqual(filters);
    expect(filtersToParams(emptyFilters).toString()).toBe("");
  });

  it("counts active filters", () => {
    expect(activeFilterCount(emptyFilters)).toBe(0);
    expect(activeFilterCount({ from: "2024-01-01", to: null, place: "Bay", dryOnly: true })).toBe(3);
  });
});

describe("applyFilters", () => {
  it("returns everything with no filters", () => {
    expect(ids(emptyFilters)).toEqual([27, 30, 3]);
  });

  it("filters by inclusive date range", () => {
    expect(ids({ ...emptyFilters, from: "2026-05-06" })).toEqual([27, 30]);
    expect(ids({ ...emptyFilters, to: "2026-05-06" })).toEqual([27, 3]);
    expect(ids({ ...emptyFilters, from: "2026-05-07", to: "2026-09-24" })).toEqual([]);
  });

  it("filters by place and dry weather", () => {
    expect(ids({ ...emptyFilters, place: "Calamba" })).toEqual([30]);
    expect(ids({ ...emptyFilters, dryOnly: true })).toEqual([27, 3]);
    expect(ids({ ...emptyFilters, dryOnly: true, place: "Calamba" })).toEqual([]);
  });
});

describe("placesOf / dateSpanOf", () => {
  it("lists sorted unique places and the date span", () => {
    expect(placesOf(features)).toEqual(["Binangonan", "Calamba", "Lumban"]);
    expect(dateSpanOf(features)).toEqual({ min: "2024-02-11", max: "2026-09-25" });
    expect(dateSpanOf([])).toBeNull();
  });
});

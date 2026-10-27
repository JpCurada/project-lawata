import { describe, expect, it } from "vitest";
import { boxFromCorners, boxSidesKm, isBoxTooBig } from "./analysis";

describe("area box", () => {
  it("orders any two opposite corners", () => {
    expect(boxFromCorners([121.15, 14.49], [121.14, 14.5])).toEqual({ west: 121.14, south: 14.49, east: 121.15, north: 14.5 });
  });

  it("measures sides in km like the API", () => {
    const [width, height] = boxSidesKm({ west: 121.14, south: 14.495, east: 121.15, north: 14.505 });
    expect(width).toBeCloseTo(1.08, 2);
    expect(height).toBeCloseTo(1.11, 2);
  });

  it("flags boxes wider than 5 km", () => {
    expect(isBoxTooBig({ west: 121.14, south: 14.495, east: 121.2, north: 14.505 })).toBe(true);
    expect(isBoxTooBig({ west: 121.14, south: 14.495, east: 121.18, north: 14.505 })).toBe(false);
  });
});

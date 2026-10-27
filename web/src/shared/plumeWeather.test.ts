import { describe, expect, it } from "vitest";
import { plumeWeather } from "./plumeWeather";

const confirmed = { verdict: "confirmed" };
const artifact = { verdict: "artifact" };

describe("plumeWeather", () => {
  it("is dry when the plume is in the dry-weather view", () => {
    expect(plumeWeather({ is_dry: true, rain_3d_mm: 1.2, latest_review: confirmed })).toBe("dry");
  });

  it("is an artifact, not rain, when a reviewer marked it so in dry weather", () => {
    // Cardona, Apr 26, 2024: 4.6 mm in 3 and 7 days, left out of the view only by the review.
    expect(plumeWeather({ is_dry: false, rain_3d_mm: 4.6, latest_review: artifact })).toBe("artifact");
  });

  it("is rain when it is not dry and not an artifact", () => {
    expect(plumeWeather({ is_dry: false, rain_3d_mm: 37.5, latest_review: null })).toBe("rain");
  });

  it("is unknown without rain data", () => {
    expect(plumeWeather({ is_dry: false, rain_3d_mm: null, latest_review: confirmed })).toBe("unknown");
  });
});

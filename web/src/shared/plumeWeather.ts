// Why a plume is (or isn't) dry weather, for the sentences shown next to it.
// `is_dry` is membership in v_dry_weather_plumes, which also leaves out plumes reviewed as artifacts.
// So `is_dry === false` alone doesn't mean it rained: check the review before saying "after rain".

export type PlumeWeather = "dry" | "rain" | "artifact" | "unknown";

interface WeatherFacts {
  is_dry: boolean;
  rain_3d_mm: number | null;
  latest_review: { verdict: string } | null;
}

export function plumeWeather(plume: WeatherFacts): PlumeWeather {
  if (plume.is_dry) return "dry";
  if (plume.latest_review?.verdict === "artifact") return "artifact";
  if (plume.rain_3d_mm === null) return "unknown";
  return "rain";
}

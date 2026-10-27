import type { PlumeWeather } from "./stories";

const labels: Record<PlumeWeather, { full: string; short: string }> = {
  dry_weather: { full: "Dry weather: suspicious, verify", short: "Dry weather" },
  after_rain: { full: "After rain: expected runoff", short: "After rain" },
  artifact: { full: "Image artifact: not a plume", short: "Image artifact" },
};

const modifier: Record<PlumeWeather, string> = { dry_weather: "dry", after_rain: "rain", artifact: "artifact" };

interface StoryBadgeProps {
  weather: PlumeWeather;
  /** "short" drops the verdict, for places where it is already said in the text. */
  size?: "full" | "short";
  className?: string;
}

/** Red pill for dry-weather plumes, blue for after-rain plumes (the map's colours), grey for artifacts. */
export function StoryBadge({ weather, size = "full", className }: StoryBadgeProps) {
  const base = `story-badge story-badge--${modifier[weather]}`;
  return <span className={className ? `${base} ${className}` : base}>{labels[weather][size]}</span>;
}

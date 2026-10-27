import { Fragment, useId, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import SegmentedControl from "../../shared/ui/arc/segmented-control/segmented-control";
import { SearchField } from "../../shared/ui/arc/search-field/search-field";
import { ArrowLink } from "../../shared/ui/ArrowLink";
import { BlockEmpty } from "../../shared/ui/BlockState";
import { StoryCard } from "./StoryCard";
import { stories, type PlumeWeather } from "./stories";
import "./story.css";

// The stories with a real recorded agent run (recordedRuns.ts), one per kind of decision.
const agentPicks: { id: string; place: string; outcome: string }[] = [
  { id: "pililla-apr-2026", place: "Pililla", outcome: "artifact" },
  { id: "calamba-sep-2026", place: "Calamba", outcome: "expected" },
  { id: "binangonan-may-2026", place: "Binangonan", outcome: "sampling" },
];

function AgentPicks(): ReactNode {
  return (
    <p className="story-gallery__picks">
      Watch the agent decide:{" "}
      {agentPicks.map((pick, index) => (
        <Fragment key={pick.id}>
          {index > 0 && ", "}
          <Link to={`/story/${pick.id}`}>
            {pick.place} ({pick.outcome})
          </Link>
        </Fragment>
      ))}
    </p>
  );
}

// Filter, search and sort live in the URL (?type=dry&q=lumban&sort=oldest) so a view can be shared.

const filters: { value: string; label: string; weather?: PlumeWeather }[] = [
  { value: "", label: "All" },
  { value: "dry", label: "Dry weather (suspicious)", weather: "dry_weather" },
  { value: "rain", label: "After rain (expected)", weather: "after_rain" },
];

export function StoryGalleryPage() {
  const [params, setParams] = useSearchParams();
  const sortId = useId();
  const type = params.get("type") ?? "";
  const query = params.get("q") ?? "";
  const sort = params.get("sort") === "oldest" ? "oldest" : "newest";
  const active = filters.find((filter) => filter.value === type) ?? filters[0];
  const weather = active.weather;

  const setParam = (key: string, value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value === "") next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );

  const needle = query.trim().toLowerCase();
  const shown = stories
    .filter((story) => weather === undefined || story.weather === weather)
    .filter((story) => needle === "" || `${story.title} ${story.place} ${story.summary}`.toLowerCase().includes(needle))
    .sort((a, b) => (sort === "newest" ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)));

  return (
    <article className="page story-gallery">
      <header className="story-gallery__intro">
        <h1 className="page__title">Stories</h1>
        <p className="page__lead">
          Every few days Sentinel-2 photographs Laguna de Bay. It can't see chemicals like PFAS, but it can see a
          plume: water of an unusual colour flowing from the shore. Lawata uses that as a pointer, not a verdict. Each
          story follows one real plume and why the agent handled it the way it did.
        </p>
      </header>

      <div className="story-toolbar">
        <div className="story-toolbar__search">
          <SearchField
            label="Search stories"
            placeholder="Place or title"
            value={query}
            onValueChange={(value) => setParam("q", value)}
          />
        </div>
        <SegmentedControl
          className={`story-filters${active.weather ? ` story-filters--${active.value}` : ""}`}
          label="Filter stories"
          options={filters.map(({ value, label }) => ({ value, label }))}
          value={active.value}
          onValueChange={(value) => setParam("type", value)}
        />
        <div className="story-toolbar__sort">
          <label htmlFor={sortId}>Sort</label>
          <select id={sortId} value={sort} onChange={(event) => setParam("sort", event.target.value === "oldest" ? "oldest" : "")}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
      </div>

      <AgentPicks />

      <p className="story-gallery__count" role="status" aria-live="polite">
        {shown.length === 1 ? "1 story" : `${shown.length} stories`}
      </p>

      {shown.length === 0 ? (
        <BlockEmpty
          action={
            <button type="button" className="button button--small button--ghost" onClick={() => setParams({}, { replace: true })}>
              Clear filters
            </button>
          }
        >
          No stories match these filters.
        </BlockEmpty>
      ) : (
        <ul className="story-grid">
          {shown.map((story) => (
            <li key={story.id}>
              <StoryCard story={story} />
            </li>
          ))}
        </ul>
      )}

      <section className="story-end" aria-labelledby="story-end-title">
        <h2 id="story-end-title" className="story-end__title">
          Sample where there is a reason
        </h2>
        <p>
          Lab tests are expensive. Lawata never says a plume broke a rule; it says "suspicious, verify" and leaves the
          final call to people.
        </p>
        <ArrowLink to="/explore" variant="outline">
          Explore every plume on the map
        </ArrowLink>
      </section>
    </article>
  );
}

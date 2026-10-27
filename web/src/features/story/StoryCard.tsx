import { Link } from "react-router-dom";
import { formatDate } from "../../shared/format";
import { Arrow } from "../../shared/ui/ArrowLink";
import { actionLabel } from "../../shared/labels";
import { useStoryPlumeQuery } from "./api";
import { LiveMeta } from "./LiveMeta";
import { findRecordedRun } from "../../shared/recordedRuns";
import { StoryBadge } from "./StoryBadge";
import type { Story } from "./stories";

/**
 * One story in the gallery. The title link stretches over the whole card (see .story-card__link),
 * so the card is one click target while Retry stays a separate, real button.
 */
export function StoryCard({ story }: { story: Story }) {
  const live = useStoryPlumeQuery(story.place, story.date);
  const run = findRecordedRun(story.place, story.date);
  const titleId = `story-card-${story.id}`;
  const crop = live.data?.evidence_image_url;
  const cover =
    story.cover ??
    (crop
      ? { src: crop, alt: `Sentinel-2 crop of the ${story.place} plume on ${formatDate(story.date)}, with the plume outlined.` }
      : null);

  return (
    <article className="story-card" aria-labelledby={titleId}>
      <div className="story-card__media">
        {cover === null ? (
          <div className="story-card__placeholder" aria-hidden="true">
            {story.place}
          </div>
        ) : (
          <img className="story-card__img" src={cover.src} alt={cover.alt} loading="lazy" />
        )}
        <StoryBadge weather={story.weather} className="story-card__badge" />
      </div>
      <div className="story-card__body">
        <p className="story-card__meta">
          {story.place} · <time dateTime={story.date}>{formatDate(story.date)}</time>
        </p>
        <h2 id={titleId} className="story-card__title">
          <Link to={`/story/${story.id}`} className="story-card__link">
            {story.title}
          </Link>
        </h2>
        <p className="story-card__summary">{story.summary}</p>
        <LiveMeta live={live} className="story-card__live" />
        {run !== undefined && <p className="story-card__agent">Agent: {actionLabel(run.action)}</p>}
        <span className="story-card__more" aria-hidden="true">
          Read the story <Arrow />
        </span>
      </div>
    </article>
  );
}

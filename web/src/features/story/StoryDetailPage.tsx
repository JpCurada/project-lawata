import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../shared/auth";
import { formatDate } from "../../shared/format";
import { readTrace } from "../../shared/agentTrace";
import { actionLabel } from "../../shared/labels";
import { AgentRun } from "../../shared/ui/AgentRun";
import { ChevronLeft } from "../../shared/ui/Icon";
import { ArrowLink } from "../../shared/ui/ArrowLink";
import { BlockEmpty } from "../../shared/ui/BlockState";
import { SkeletonLines } from "../../shared/ui/Skeleton";
import { useStoryPlumeQuery, useStoryTaskQuery, type StoryPlume } from "./api";
import { LiveMeta } from "./LiveMeta";
import { findRecordedRun } from "../../shared/recordedRuns";
import { StoryBadge } from "./StoryBadge";
import { StoryFigureView } from "./StoryFigures";
import { exploreLink, findStory, type Story } from "./stories";
import "./story.css";

const statusText: Record<string, string> = {
  pending_approval: "pending approval",
  approved: "approved",
  rejected: "rejected",
  done: "done",
};

type Live = ReturnType<typeof useStoryPlumeQuery>;

function Step({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="story-step" aria-labelledby={id}>
      <h2 id={id} className="story-step__title">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Step 1: the story's own figures, or the plume's evidence crop when the story has none. */
function SatelliteEvidence({ story, live }: { story: Story; live: Live }) {
  const crop = live.data?.evidence_image_url;
  const figures =
    story.figures.length > 0
      ? story.figures
      : crop
        ? [
            {
              kind: "image" as const,
              src: crop,
              alt: `Sentinel-2 crop at 10 m of the ${story.place} shore on ${formatDate(story.date)}, with the detected plume outlined in red.`,
              caption:
                "The 10 m crop OpenCV inspected. Red outline: the plume. Yellow outline: cloud and shadow zone, ignored. White cross: where the water enters the lake.",
            },
          ]
        : [];
  return (
    <Step id="step-saw" title="1. What the satellite saw">
      <p>{story.sections.satelliteEvidence}</p>
      {figures.map((figure) => (
        <StoryFigureView key={figure.caption} figure={figure} />
      ))}
      {figures.length === 0 && live.isSuccess && (
        <p className="card__note">No evidence crop is stored for this plume yet.</p>
      )}
    </Step>
  );
}

/** Only dry-weather stories can lead to sampling, and sampling tasks are researcher data. */
function useTaskCheck(story: Story) {
  const { status, isResearcher } = useAuth();
  const dry = story.weather === "dry_weather";
  return { dry, signedOut: dry && status !== "loading" && !isResearcher, enabled: dry && isResearcher };
}

function TaskStatus({ story, plumeId }: { story: Story; plumeId: number }) {
  const check = useTaskCheck(story);
  const task = useStoryTaskQuery(plumeId, check.enabled);
  if (check.signedOut) return <p className="card__note">Sign in as a researcher to see whether a sampling task was proposed.</p>;
  if (!check.enabled || task.isPending) return null;
  if (task.isError) return <p className="card__note">Sign in as a researcher to see whether a sampling task was proposed.</p>;
  if (task.data === null) return <p>No sampling task has been proposed for this plume.</p>;
  return (
    <p>
      A sampling task was proposed and is <strong>{statusText[task.data.status] ?? task.data.status}</strong>
      {task.data.reviewed_by !== null && ` (by ${task.data.reviewed_by})`}.
    </p>
  );
}

/**
 * Step 3. Researchers get the live decision. Public viewers don't (the API hides it), so stories
 * with a real recorded run show that run instead, step by step.
 */
function AgentDecision({ story, plume }: { story: Story; plume: StoryPlume }) {
  const decision = plume.latest_decision;
  const run = findRecordedRun(story.place, story.date);
  if (decision !== null) {
    return (
      <blockquote className="story-quote">
        <p className="story-quote__action">{actionLabel(decision.action)}</p>
        <p>{decision.reason}</p>
      </blockquote>
    );
  }
  if (run === undefined) return <p>The agent's decision is shown to signed-in researchers.</p>;
  return (
    <>
      <AgentRun
        title={`Recorded agent run · ${formatDate(run.recordedOn)}`}
        running={false}
        outcome={readTrace(run.trace, run.action, run.reason)}
      />
      {story.sections.runSummary !== undefined && <p className="story-run__summary">{story.sections.runSummary}</p>}
    </>
  );
}

/** Steps 2 to 4, from the live record. */
function LiveSteps({ story, plume }: { story: Story; plume: StoryPlume }) {
  return (
    <>
      <Step id="step-rain" title="2. The rain check">
        {story.weather === "artifact" ? (
          <p>{story.sections.rainCheck}</p>
        ) : (
          <p>
            <StoryBadge weather={plume.is_dry ? "dry_weather" : "after_rain"} size="short" />{" "}
            {plume.is_dry === (story.weather === "dry_weather")
              ? story.sections.rainCheck
              : "The live rain record now reads differently from this story. The numbers above are the current ones."}
          </p>
        )}
      </Step>

      <Step id="step-agent" title="3. What the agent decided">
        <AgentDecision story={story} plume={plume} />
        <p className="card__note">{story.sections.agentRule}</p>
      </Step>

      <Step id="step-next" title="4. What a person does next">
        <p>{story.sections.nextStep}</p>
        {/* Only dry-weather stories can lead to sampling; the others already say "nothing to sample". */}
        {story.weather === "dry_weather" && <TaskStatus story={story} plumeId={plume.id} />}
      </Step>
    </>
  );
}

/** Main call to action. Sticks to the bottom of the screen on phones, inline from 768px. */
function ActionBar({ story, plume }: { story: Story; plume: StoryPlume | null | undefined }) {
  const task = useStoryTaskQuery(plume?.id, useTaskCheck(story).enabled);
  const pending = task.data?.status === "pending_approval";
  return (
    <div className="story-actions">
      {pending ? (
        <ArrowLink to="/sampling">Review on Sampling page</ArrowLink>
      ) : (
        <ArrowLink to={exploreLink(story)}>Open in Explore map</ArrowLink>
      )}
      {plume != null && (
        <ArrowLink to={`/plumes/${plume.id}`} variant="outline">
          Open the plume record
        </ArrowLink>
      )}
    </div>
  );
}

function BackBar({ place }: { place?: string }) {
  return (
    <nav className="story-bar" aria-label="Breadcrumb">
      <div className="story-bar__inner">
        <Link to="/story" className="story-bar__back">
          <ChevronLeft className="story-bar__chevron" />
          Back to stories
        </Link>
        {place !== undefined && (
          <ol className="story-bar__crumbs">
            <li>
              <Link to="/story">Stories</Link>
            </li>
            <li aria-current="page">{place}</li>
          </ol>
        )}
      </div>
    </nav>
  );
}

function StoryDetail({ story }: { story: Story }) {
  const live = useStoryPlumeQuery(story.place, story.date);

  let steps: ReactNode = null;
  if (live.isPending) steps = <SkeletonLines count={4} />;
  else if (live.data != null) steps = <LiveSteps story={story} plume={live.data} />;

  return (
    <>
      <header className="story-hero">
        <StoryBadge weather={story.weather} />
        <h1 className="story-hero__title">{story.title}</h1>
        <LiveMeta live={live} prefix={formatDate(story.date)} className="story-hero__meta" />
      </header>
      <SatelliteEvidence story={story} live={live} />
      {steps}
      <ActionBar story={story} plume={live.data} />
    </>
  );
}

export function StoryDetailPage() {
  const { storyId } = useParams();
  const story = findStory(storyId);
  return (
    <article className="story-detail">
      <BackBar place={story?.place} />
      <div className="page story-detail__body">
        {story === undefined ? (
          <>
            <h1 className="page__title">Story not found</h1>
            <BlockEmpty action={<ArrowLink to="/story">See all stories</ArrowLink>}>
              There is no story at this address.
            </BlockEmpty>
          </>
        ) : (
          <StoryDetail story={story} />
        )}
      </div>
    </article>
  );
}

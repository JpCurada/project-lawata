import { Bot, CloudRain, ScanSearch, Satellite, UserCheck, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { readTrace } from "../../shared/agentTrace";
import { useAuth } from "../../shared/auth";
import calambaPlume from "../../assets/story/calamba-plume-clean.jpg";
import { calambaBefore } from "../../shared/calambaPair";
import { formatCount, formatDate, formatHa } from "../../shared/format";
import { recordedRuns } from "../../shared/recordedRuns";
import { AgentRun } from "../../shared/ui/AgentRun";
import { Arrow, ArrowLink } from "../../shared/ui/ArrowLink";
import { BlockEmpty, BlockError, BlockLoading } from "../../shared/ui/BlockState";
import { Section } from "../../shared/ui/Section";
import { Skeleton, SkeletonLines } from "../../shared/ui/Skeleton";
import {
  LATEST_COUNT,
  useDryPlumesQuery,
  useLatestPlumesQuery,
  usePendingSamplingQuery,
  usePlumeCropQuery,
  usePlumePointsQuery,
  useStatsQuery,
} from "./api";
import "./home.css";

const steps: { title: string; text: string; icon: LucideIcon }[] = [
  { title: "Satellite pass", text: "A new Sentinel-2 image arrives.", icon: Satellite },
  { title: "Unusual water", text: "OpenCV finds water that looks different.", icon: ScanSearch },
  { title: "Rain check", text: "Rain explains most plumes.", icon: CloudRain },
  { title: "Agent decides", text: "It looks closer, then picks a next step.", icon: Bot },
  { title: "Person approves", text: "No field sample without a human yes.", icon: UserCheck },
];

// The three recorded runs (shared/recordedRuns.ts), one per decision, each with its story.
const decisions = [
  {
    to: "/story/pililla-apr-2026",
    place: "Pililla",
    date: "2026-04-21",
    outcome: "Image artifact",
    tone: "artifact",
    text: "It saw a cloud edge at 10 m and stopped.",
  },
  {
    to: "/story/calamba-sep-2026",
    place: "Calamba",
    date: "2026-09-25",
    outcome: "Expected runoff",
    tone: "rain",
    text: "It saw heavy rain the week before and logged it as expected.",
  },
  {
    to: "/story/binangonan-may-2026",
    place: "Binangonan",
    date: "2026-05-06",
    outcome: "Field sampling proposed",
    tone: "dry",
    text: "It saw dry weather at a river mouth and asked for a sample, pending a person's approval.",
  },
] as const;

function PlumeCardsSkeleton() {
  return (
    <div className="plume-cards">
      {[0, 1, 2, 3].map((key) => (
        <div key={key} className="card card--raised plume-card">
          <span className="plume-card__top">
            <Skeleton width="6rem" />
            <Skeleton shape="pill" width="5.5rem" height="1.6rem" />
          </span>
          <Skeleton shape="block" width="55%" height="1.75rem" className="plume-card__place" />
          <Skeleton width="70%" />
        </div>
      ))}
    </div>
  );
}

function PendingSkeleton() {
  return (
    <div className="pending">
      <span className="pending__text">
        <SkeletonLines count={2} />
      </span>
      <Skeleton shape="pill" width="10rem" height="2.75rem" />
    </div>
  );
}

function HowItWorks() {
  return (
    <section className="split how" aria-labelledby="how-title">
      <div className="container split__grid">
        <h2 id="how-title" className="split__title">
          How it works
        </h2>
        <ol className="how__steps">
          {steps.map(({ title, text, icon: StepIcon }, index) => (
            <li key={title} className="how__step">
              <span className="how__icon" aria-hidden="true">
                <StepIcon size={20} strokeWidth={1.75} />
              </span>
              <span className="how__body">
                <span className="how__name">
                  <span className="how__num">{index + 1}.</span> {title}
                </span>
                <span className="how__text">{text}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** One headline number from /api/stats: how many plumes appeared in dry weather. */
function Headline() {
  const stats = useStatsQuery();
  if (stats.isPending) {
    return <BlockLoading skeleton={<SkeletonLines count={2} />}>Loading the numbers...</BlockLoading>;
  }
  if (stats.isError) return <BlockError onRetry={() => void stats.refetch()}>Can't load the numbers right now.</BlockError>;

  const { total_plumes, dry_weather_plumes, last_scene_date } = stats.data;
  if (total_plumes === 0 && last_scene_date === null) {
    return <BlockEmpty>No satellite scenes processed yet, so there are no numbers to show.</BlockEmpty>;
  }
  return (
    <div className="headline">
      <p className="headline__text">
        {total_plumes === 0 ? (
          "No plumes detected yet."
        ) : dry_weather_plumes === 0 ? (
          <>
            None of {formatCount(total_plumes)} plumes appeared in dry weather. Rain explains them all so far.
          </>
        ) : (
          <>
            <strong className="headline__number">
              {formatCount(dry_weather_plumes)} of {formatCount(total_plumes)}
            </strong>{" "}
            plumes appeared in dry weather. Those are the ones worth a sample.
          </>
        )}
      </p>
      {last_scene_date !== null && (
        <p className="headline__meta">Latest clear Sentinel-2 pass analysed: {formatDate(last_scene_date)}</p>
      )}
    </div>
  );
}

// The run shown inline: the clearest case of the agent changing its next step because of the image.
const featured = recordedRuns.find((run) => run.place === "Pililla");
const featuredOutcome = featured ? readTrace(featured.trace, featured.action, featured.reason) : null;

/** One decision as a circle: the plume's real 10 m crop, the outcome, one line, a link to its story. */
function DecisionCircle({ item }: { item: (typeof decisions)[number] }) {
  const crop = usePlumeCropQuery(item.place, item.date);
  return (
    <li>
      <Link to={item.to} className="circle">
        <span className={`circle__frame circle__frame--${item.tone}`}>
          {crop.data ? (
            <img
              className="circle__img"
              src={crop.data}
              alt={`10 m Sentinel-2 crop of the ${item.place} plume, ${formatDate(item.date)}.`}
              loading="lazy"
            />
          ) : (
            <span className="circle__fallback" aria-hidden="true">
              {item.place}
            </span>
          )}
        </span>
        <span className="circle__place">{item.place}</span>
        <span className={`circle__outcome circle__outcome--${item.tone}`}>{item.outcome}</span>
        <span className="circle__text">{item.text}</span>
      </Link>
    </li>
  );
}

function Decisions() {
  return (
    <section className="decisions" aria-labelledby="decisions-title">
      <div className="container">
        <h2 id="decisions-title" className="statement">
          The agent looks closer before anyone goes out on the lake. Three real runs, three different decisions,
          each from what it saw:
        </h2>
        <ul className="circles">
          {decisions.map((item) => (
            <DecisionCircle key={item.to} item={item} />
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * A real recorded agent run on a band of satellite imagery, so a first-time visitor sees the agent
 * decide without signing in or clicking.
 */
function AgentBand() {
  if (!featured || !featuredOutcome) return null;
  return (
    <section className="band" aria-labelledby="agent-title" style={{ backgroundImage: `url(${calambaBefore.src})` }}>
      <div className="container">
        <div className="band__card">
          <div className="band__text">
            <h2 id="agent-title" className="band__title">
              Watch it decide
            </h2>
            <p>
              Pililla, April 2026. The first scan flagged dark water by the shore. At 10 m the agent saw the patch
              hugging a cloud edge, so it stopped there: no rain check, no field sample.
            </p>
            <p className="band__note">A real recorded run. Press replay, or open a step to see what it found.</p>
            <ArrowLink to="/story/pililla-apr-2026" variant="outline">
              Read the Pililla story
            </ArrowLink>
          </div>
          <AgentRun
            title={`Pililla, ${formatDate(featured.date)} · recorded ${formatDate(featured.recordedOn)}`}
            running={false}
            outcome={featuredOutcome}
          />
        </div>
      </div>
    </section>
  );
}

function LatestPlumes() {
  const latest = useLatestPlumesQuery();
  const dry = useDryPlumesQuery();
  if (latest.isPending) return <BlockLoading skeleton={<PlumeCardsSkeleton />}>Loading the latest plumes...</BlockLoading>;
  if (latest.isError) return <BlockError onRetry={() => void latest.refetch()}>Can't load the latest plumes right now.</BlockError>;
  if (latest.data.length === 0) return <BlockEmpty>No plumes detected yet.</BlockEmpty>;

  // Dry-weather plumes first (if that list loads), then the newest of the rest. One card per place and
  // day (the largest plume), so a single pass with several patches doesn't fill the row.
  const largestFirst = new Map<string, (typeof latest.data)[number]>();
  for (const plume of [...(dry.data ?? []), ...latest.data]) {
    const key = `${plume.place}|${plume.date}`;
    const kept = largestFirst.get(key);
    if (kept === undefined || plume.area_ha > kept.area_ha) largestFirst.set(key, plume);
  }
  const plumes = [...largestFirst.values()];

  return (
    <ol className="plume-cards">
      {plumes.slice(0, LATEST_COUNT).map((plume) => (
        <li key={plume.id}>
          <Link to={`/plumes/${plume.id}`} className="card card--raised plume-card">
            <span className="plume-card__top">
              <span className="plume-card__date">{formatDate(plume.date)}</span>
              <span className={plume.is_dry ? "pill pill--dry-label" : "pill pill--rain-label"}>
                {plume.is_dry ? "Suspicious, verify" : "After rain"}
              </span>
            </span>
            <span className="plume-card__place">{plume.place ?? "Unnamed place"}</span>
            <span className="plume-card__meta">
              {formatHa(plume.area_ha)} of unusual water{plume.is_dry ? ", dry weather" : ""}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

function PendingSampling() {
  const pending = usePendingSamplingQuery();
  if (pending.isPending) return <BlockLoading skeleton={<PendingSkeleton />}>Checking sampling tasks...</BlockLoading>;
  if (pending.isError) return <BlockError onRetry={() => void pending.refetch()}>Can't check sampling tasks right now.</BlockError>;

  const count = pending.data.length;
  if (count === 0) {
    return (
      <div className="pending pending--calm">
        <p className="pending__text">No sampling tasks are waiting for approval.</p>
        <ArrowLink to="/sampling" variant="text">
          See all sampling tasks
        </ArrowLink>
      </div>
    );
  }
  return (
    <div className="pending pending--action">
      <p className="pending__text">
        <strong className="pending__count">{count}</strong> sampling {count === 1 ? "task is" : "tasks are"} pending
        approval. A person needs to approve or reject {count === 1 ? "it" : "them"}.
      </p>
      <ArrowLink to="/sampling">Review sampling</ArrowLink>
    </div>
  );
}

/**
 * Every plume Lawata has found, drawn where it is on the lake: red for dry weather, blue for after
 * rain, bigger for larger plumes. Decorative (the map is the real view), so it's hidden from screen
 * readers and simply absent while loading or on error.
 */
function PlumeDots() {
  const points = usePlumePointsQuery();
  if (!points.data || points.data.length === 0) return null;
  const lons = points.data.map((p) => p.lon);
  const lats = points.data.map((p) => p.lat);
  const [minLon, maxLon] = [Math.min(...lons), Math.max(...lons)];
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const width = 220;
  const height = 220;
  const pad = 12;
  const x = (lon: number) => pad + ((lon - minLon) / (maxLon - minLon || 1)) * (width - 2 * pad);
  const y = (lat: number) => height - pad - ((lat - minLat) / (maxLat - minLat || 1)) * (height - 2 * pad);
  const r = (ha: number) => Math.min(9, 3 + Math.sqrt(ha) / 6);
  return (
    <figure className="hero__dots">
      <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
        {points.data.map((p) => (
          <circle
            key={p.id}
            cx={x(p.lon)}
            cy={y(p.lat)}
            r={r(p.areaHa)}
            className={p.dry ? "hero__dot hero__dot--dry" : "hero__dot hero__dot--rain"}
          />
        ))}
      </svg>
      <figcaption className="hero__dots-caption">Every plume found since January 2024, where it was. Red: dry weather.</figcaption>
    </figure>
  );
}

export function HomePage() {
  // Sampling tasks are researcher data: the block (and its query) only exists for researchers.
  const { isResearcher } = useAuth();
  return (
    <div className="home">
      <section className="hero" aria-labelledby="hero-title">
        <div className="container">
          <h1 id="hero-title" className="hero__title">
            A satellite can't tell what's in the water. It can tell where a sample is worth taking.
          </h1>
          <div className="hero__row">
            <PlumeDots />
            <div className="hero__text">
              <p className="hero__lead">
                Lawata watches Laguna de Bay in Sentinel-2 images, checks the rain, and lets an AI agent decide what
                deserves a closer look. A person makes the final call.
              </p>
              <div className="hero__actions">
                <ArrowLink to="/story">Watch the agent decide</ArrowLink>
                <ArrowLink to="/explore" variant="outline">
                  Explore the map
                </ArrowLink>
              </div>
            </div>
            <figure className="hero__figure">
              <img
                className="hero__img"
                src={calambaPlume}
                alt="Sentinel-2 image of the Calamba shore of Laguna de Bay on September 25, 2026: rivers carry brown water through the town, and a dark plume spreads from the shore into the green lake."
                width={1200}
                height={750}
                fetchPriority="high"
              />
              <figcaption className="hero__caption">
                Calamba, Sep 25, 2026, seen by Sentinel-2: after a week of rain, rivers carry sediment and dark,
                organic-rich water into the lake.
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      <section className="split" aria-labelledby="why-title">
        <div className="container split__grid">
          <h2 id="why-title" className="split__title">
            Sample where there is a reason
          </h2>
          <div className="split__body">
            <p>
              Lab tests cost money and field trips take days. Most unusual water on the lake is mud after a storm.
              Lawata sets those aside and points to the plumes that rain can't explain.
            </p>
            <Headline />
          </div>
        </div>
      </section>

      <Decisions />

      <AgentBand />

      <HowItWorks />

      <Section
        title="Latest plumes"
        intro="Dry-weather plumes first."
        action={
          <ArrowLink to="/explore" variant="text">
            See all on the map
          </ArrowLink>
        }
      >
        <LatestPlumes />
      </Section>

      {isResearcher && (
        <Section title="Sampling" intro="Field sampling only goes ahead after a person approves it." band>
          <PendingSampling />
        </Section>
      )}
    </div>
  );
}

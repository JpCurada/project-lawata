import { useEffect, useState, type ReactNode } from "react";
import { modelLabel, type AgentOutcome, type AgentStep, type StepState } from "../agentTrace";
import {
  BlockedIcon,
  CheckIcon,
  ChevronDown,
  ClockIcon,
  CrossIcon,
  FlagIcon,
  ImageIcon,
  RainIcon,
  ReplayIcon,
  SpinnerIcon,
} from "./Icon";
import { TextShimmer } from "./arc/text-shimmer/text-shimmer";
import "./agentRun.css";

// One agent run as a list of steps: a ticking "Working" row while the request is out, then the
// real steps from the trace, revealed one by one with their real durations. The trace arrives
// whole when the run ends (POST /api/analyses is synchronous), so nothing here pretends to stream.

const REVEAL_MS = 150;

const toolIcons: Record<string, () => ReactNode> = {
  inspect_plume: () => <ImageIcon />,
  get_rainfall: () => <RainIcon />,
  get_history: () => <ClockIcon />,
};

const stateIcons: Record<StepState, { icon: ReactNode; text: string }> = {
  done: { icon: <CheckIcon />, text: "done" },
  error: { icon: <CrossIcon />, text: "failed" },
  blocked: { icon: <BlockedIcon />, text: "blocked" },
};

const clock = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const prefersReducedMotion = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Milliseconds since `running` last turned true; holds the final value once it turns false. */
function useStopwatch(running: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed(Date.now() - started), 250);
    return () => {
      window.clearInterval(timer);
      setElapsed(Date.now() - started);
    };
  }, [running]);
  return elapsed;
}

/** How many rows are shown; counts up from 0 whenever `key` changes. */
function useReveal(total: number, key: unknown): number {
  const [shown, setShown] = useState(total);
  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(total);
      return;
    }
    setShown(0);
    let count = 0;
    const timer = window.setInterval(() => {
      count += 1;
      setShown(count);
      if (count >= total) window.clearInterval(timer);
    }, REVEAL_MS);
    return () => window.clearInterval(timer);
  }, [total, key]);
  return shown;
}

function StepRow({ step }: { step: AgentStep }) {
  const [open, setOpen] = useState(false);
  const state = stateIcons[step.state];
  const expandable = step.details.length > 0;
  return (
    <li className={`agent-run__step agent-run__step--${step.state}`}>
      <button
        type="button"
        className="agent-run__row"
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="agent-run__icon">{toolIcons[step.tool]?.() ?? <FlagIcon />}</span>
        <span className="agent-run__label">{step.label}</span>
        {step.ms !== undefined && <span className="agent-run__ms">{(step.ms / 1000).toFixed(1)}s</span>}
        <span className="agent-run__state">
          {state.icon}
          <span className="visually-hidden">, {state.text}</span>
        </span>
        <ChevronDown className="agent-run__chevron" />
      </button>
      {open && (
        <ul className="agent-run__details">
          {step.details.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

interface AgentRunProps {
  /** What the agent is looking at, e.g. "Box 2.1 × 1.4 km". */
  title: string;
  /** Bedrock model id; older runtimes don't report it. */
  model?: string | null;
  running: boolean;
  /** The finished run; null while running or if it failed. */
  outcome: AgentOutcome | null;
  workingLabel?: string;
}

export function AgentRun({ title, model, running, outcome, workingLabel = "Investigating" }: AgentRunProps) {
  const elapsed = useStopwatch(running);
  const [replays, setReplays] = useState(0);
  const steps = outcome?.steps ?? [];
  const rows = steps.length + (outcome?.decision ? 1 : 0);
  const shown = useReveal(rows, `${replays}:${String(outcome !== null)}:${rows}`);
  const revealing = shown < rows;
  const status = running || revealing ? "Working" : outcome?.stopped ? "Stopped" : outcome ? "Done" : "Not finished";

  return (
    <section className="agent-run" aria-label="Agent run">
      <div className="agent-run__head">
        <p className="agent-run__title">{title}</p>
        {!running && rows > 0 && (
          <button
            type="button"
            className="agent-run__replay"
            aria-label="Replay the steps"
            title="Replay the steps"
            disabled={revealing}
            onClick={() => setReplays((count) => count + 1)}
          >
            <ReplayIcon />
          </button>
        )}
      </div>
      <div className="agent-run__meta">
        {model && <span className="agent-run__model">{modelLabel(model)}</span>}
        <span className={`agent-run__status agent-run__status--${status.split(" ")[0].toLowerCase()}`}>
          {status === "Working" && <SpinnerIcon className="agent-run__spin" />}
          {status}
        </span>
        {elapsed > 0 && (
          <span className="agent-run__time">
            <span className="visually-hidden">Time taken </span>
            {clock(elapsed)}
          </span>
        )}
      </div>
      <div className="agent-run__body">
        {/* The live region holds only finished rows, each announced once as it is added. The working
            row sits outside it: TextShimmer sets aria-busy and repaints every frame, and inside the
            region that could mute or repeat announcements. */}
        <ol className="agent-run__steps" aria-live="polite" aria-relevant="additions">
          {steps.slice(0, shown).map((step, index) => (
            <StepRow key={index} step={step} />
          ))}
          {outcome?.decision && shown >= rows && (
            <li className="agent-run__step agent-run__decision">
              <div className="agent-run__row">
                <span className="agent-run__icon">
                  <FlagIcon />
                </span>
                <span className="agent-run__decision-label">{outcome.decision.label}</span>
              </div>
              {outcome.decision.reason && <p className="agent-run__reason">{outcome.decision.reason}</p>}
            </li>
          )}
        </ol>
        {(running || revealing) && (
          <div className="agent-run__step agent-run__step--running">
            <div className="agent-run__row">
              <span className="agent-run__icon">
                <SpinnerIcon className="agent-run__spin" />
              </span>
              <TextShimmer as="span" className="agent-run__label">
                {running ? workingLabel : "Reading the steps"}
              </TextShimmer>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

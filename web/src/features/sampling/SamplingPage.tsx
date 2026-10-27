import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ResearcherAccessError } from "../../shared/api/client";
import { ResearcherAccessRequired } from "../../shared/auth";
import { BlockEmpty, BlockError, BlockLoading } from "../../shared/ui/BlockState";
import { Skeleton, SkeletonLines } from "../../shared/ui/Skeleton";
import { useDecideTaskMutation, useSamplingTasksQuery } from "./api";
import { emptyGroupMessages, groupTasks, statusLabels } from "./grouping";
import { TaskCard } from "./TaskCard";
import "./sampling.css";

interface Notice {
  kind: "info" | "error";
  text: string;
}

function TasksSkeleton() {
  return (
    <div className="task-group">
      <Skeleton shape="block" width="16rem" height="2.25rem" className="task-skeleton__heading" />
      <div className="task-group__list">
        {[0, 1].map((key) => (
          <div key={key} className="task-card">
            <div className="task-card__header">
              <Skeleton width="55%" height="1.4rem" />
              <Skeleton shape="pill" width="7rem" height="1.6rem" />
            </div>
            <div className="task-card__reason">
              <SkeletonLines count={3} />
            </div>
            <Skeleton shape="block" className="mini-map" />
            <div className="task-card__actions">
              <Skeleton shape="pill" height="2.75rem" />
              <Skeleton shape="pill" height="2.75rem" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SamplingPage() {
  const tasks = useSamplingTasksQuery();
  const [notice, setNotice] = useState<Notice | null>(null);
  const decide = useDecideTaskMutation(useCallback((next: Notice) => setNotice(next), []));
  const groups = useMemo(() => groupTasks(tasks.data ?? []), [tasks.data]);
  const noticeRef = useRef<HTMLDivElement>(null);

  // The decided card leaves its group, so move focus to the outcome instead of dropping it on <main>.
  useEffect(() => {
    if (notice !== null) noticeRef.current?.focus();
  }, [notice]);

  let body;
  if (tasks.isPending) {
    body = <BlockLoading skeleton={<TasksSkeleton />}>Loading sampling tasks...</BlockLoading>;
  } else if (tasks.isError && tasks.error instanceof ResearcherAccessError) {
    body = <ResearcherAccessRequired />;
  } else if (tasks.isError) {
    body = <BlockError onRetry={() => void tasks.refetch()}>Can't load sampling tasks right now.</BlockError>;
  } else if (tasks.data.length === 0) {
    body = <BlockEmpty>No sampling tasks yet. The agent proposes them when a plume needs a field check.</BlockEmpty>;
  } else {
    body = groups.map((group) => (
      <section key={group.status} className="task-group" aria-labelledby={`group-${group.status}`}>
        <h2 id={`group-${group.status}`} className="task-group__title">
          {statusLabels[group.status]} <span className="task-group__count">({group.tasks.length})</span>
        </h2>
        {group.tasks.length === 0 ? (
          <BlockEmpty>{emptyGroupMessages[group.status]}</BlockEmpty>
        ) : (
          <div className="task-group__list">
            {group.tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                busy={decide.isPending}
                onDecide={(variables) => {
                  setNotice(null);
                  decide.mutate(variables);
                }}
              />
            ))}
          </div>
        )}
      </section>
    ));
  }

  return (
    <section className="page sampling">
      <h1 className="page__title">Sampling</h1>
      <p className="page__lead">
        The agent proposes field sampling for plumes that look suspicious, verify. Each task waits here as
        "Pending approval" until a person approves or rejects it.
      </p>
      {notice !== null && (
        <div
          ref={noticeRef}
          tabIndex={-1}
          className={notice.kind === "error" ? "notice notice--error" : "notice"}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          <p className="notice__text">{notice.text}</p>
          <button type="button" className="button button--small button--ghost" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}
      {body}
    </section>
  );
}

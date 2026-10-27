import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, retryUnlessAuth, throwIfAuthError } from "../../shared/api/client";
import type { PlumeDetail, SamplingStatus, SamplingTask, TaskConflict, TaskDecisionIn } from "../../shared/api/types";
import { statusLabels } from "./grouping";

export type { PlumeDetail, SamplingStatus, SamplingTask, TaskDecisionIn } from "../../shared/api/types";
export type Decision = "approve" | "reject";

// Matches the backend's MAX_TASK_LIMIT.
const MAX_TASKS = 200;

export const samplingTasksKey = ["sampling-tasks"] as const;

export const decisionTarget: Record<Decision, SamplingStatus> = {
  approve: "approved",
  reject: "rejected",
};

export function useSamplingTasksQuery() {
  return useQuery({
    queryKey: samplingTasksKey,
    queryFn: async ({ signal }) => {
      const { data, response } = await api.GET("/api/sampling-tasks", {
        params: { query: { limit: MAX_TASKS } },
        signal,
      });
      throwIfAuthError(response);
      if (!response.ok || data === undefined) throw new Error(`API returned ${response.status}`);
      return data;
    },
    retry: retryUnlessAuth,
  });
}

/**
 * The plume behind a task (area, weather, evidence crop), so the approver sees the evidence on the card.
 * Same key as the plume page's query, so opening the plume afterwards is instant.
 */
export function useTaskPlumeQuery(eventId: number, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["plumes", "detail", eventId] as const,
    enabled,
    queryFn: async ({ signal }): Promise<PlumeDetail> => {
      const { data, response } = await api.GET("/api/plumes/{plume_id}", {
        params: { path: { plume_id: eventId } },
        signal,
      });
      if (!response.ok || data === undefined) throw new Error(`API returned ${response.status}`);
      return data;
    },
    retry: 1,
    staleTime: 5 * 60_000,
  });
}

/** The task was decided by someone else first (HTTP 409); message names who and how. */
export class AlreadyDecidedError extends Error {}

export interface DecideVariables {
  task: SamplingTask;
  decision: Decision;
  review: TaskDecisionIn;
  /** The signed-in username, shown on the card until the server answers. */
  reviewer: string;
}

function isConflict(body: unknown): body is TaskConflict {
  return typeof body === "object" && body !== null && "status" in body && typeof body.status === "string" && body.status in statusLabels;
}

/** Built from the 409 body ({detail, status, reviewed_by}), so it names who decided first. */
export function alreadyDecidedMessage(body: unknown): string {
  if (!isConflict(body)) return "This task was already decided by someone else — refreshed.";
  const status = statusLabels[body.status].toLowerCase();
  const by = typeof body.reviewed_by === "string" && body.reviewed_by !== "" ? ` by ${body.reviewed_by}` : "";
  return `This task was already ${status}${by} — refreshed.`;
}

/** Says what the decision means in the field, not just the new status. */
export function decidedMessage(task: SamplingTask): string {
  const place = task.place ?? "this plume";
  const by = task.reviewed_by !== null ? ` Recorded as ${task.reviewed_by}.` : "";
  return task.status === "approved"
    ? `Approved: a field team is asked to take water samples at ${place}.${by}`
    : `Rejected: no field sampling at ${place}.${by}`;
}

function errorDetail(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "detail" in error) {
    const { detail } = error;
    if (typeof detail === "string") return detail;
  }
  return null;
}

/**
 * Approve or reject a pending task. The card moves to its new group at once (optimistic);
 * on any failure the list is rolled back and `onNotice` explains what happened.
 */
export function useDecideTaskMutation(onNotice: (notice: { kind: "info" | "error"; text: string }) => void) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ task, decision, review }: DecideVariables) => {
      const path = decision === "approve" ? "/api/sampling-tasks/{task_id}/approve" : "/api/sampling-tasks/{task_id}/reject";
      const { data, error, response } = await api.POST(path, {
        params: { path: { task_id: task.id } },
        body: review,
      });
      if (response.status === 409) throw new AlreadyDecidedError(alreadyDecidedMessage(error));
      throwIfAuthError(response);
      if (!response.ok || data === undefined) {
        throw new Error(errorDetail(error) ?? `API returned ${response.status}`);
      }
      return data;
    },
    onMutate: async ({ task, decision, review, reviewer }) => {
      await queryClient.cancelQueries({ queryKey: samplingTasksKey });
      const previous = queryClient.getQueryData<SamplingTask[]>(samplingTasksKey);
      queryClient.setQueryData<SamplingTask[]>(samplingTasksKey, (tasks) =>
        tasks?.map((item) =>
          item.id === task.id
            ? {
                ...item,
                status: decisionTarget[decision],
                reviewed_by: reviewer,
                review_note: review.note,
                reviewed_at: new Date().toISOString(),
              }
            : item,
        ),
      );
      return { previous };
    },
    onError: (error, { decision }, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(samplingTasksKey, context.previous);
      if (error instanceof AlreadyDecidedError) {
        onNotice({ kind: "info", text: error.message });
      } else {
        const verb = decision === "approve" ? "approve" : "reject";
        onNotice({ kind: "error", text: `Couldn't ${verb} the task: ${error.message}. Nothing was changed.` });
      }
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<SamplingTask[]>(samplingTasksKey, (tasks) =>
        tasks?.map((item) => (item.id === saved.id ? saved : item)),
      );
      onNotice({ kind: "info", text: decidedMessage(saved) });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: samplingTasksKey }),
  });
}

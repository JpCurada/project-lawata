import type { components } from "../../shared/api/schema";

type SamplingStatus = components["schemas"]["SamplingStatus"];
type SamplingTask = components["schemas"]["SamplingTaskOut"];

// Display order: what needs a person first.
export const statusOrder: readonly SamplingStatus[] = ["pending_approval", "approved", "done", "rejected"];

export const statusLabels: Record<SamplingStatus, string> = {
  pending_approval: "Pending approval",
  approved: "Approved",
  done: "Done",
  rejected: "Rejected",
};

export const emptyGroupMessages: Record<SamplingStatus, string> = {
  pending_approval: "Nothing is waiting for approval.",
  approved: "No approved tasks yet.",
  done: "No completed sampling yet.",
  rejected: "No rejected tasks.",
};

export interface TaskGroup {
  status: SamplingStatus;
  tasks: SamplingTask[];
}

/** Groups tasks by status in display order; newest first within a group. Empty groups are kept. */
export function groupTasks(tasks: readonly SamplingTask[]): TaskGroup[] {
  return statusOrder.map((status) => ({
    status,
    tasks: tasks
      .filter((task) => task.status === status)
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
  }));
}

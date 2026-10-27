import type { PlumeStatus, Verdict } from "./api";

// Plume status comes from the API (`status`). Sampling stays "pending approval" until a person approves.
export const statusLabels: Record<PlumeStatus, string> = {
  new: "New",
  triaged: "Triaged",
  sampling_pending: "Sampling: pending approval",
  sampling_approved: "Sampling approved",
  reviewed: "Reviewed",
};

export { actionLabel } from "../../shared/labels";

export const verdictLabels: Record<Verdict, string> = {
  confirmed: "Plume confirmed: suspicious, verify",
  artifact: "Not a plume (image artifact)",
  uncertain: "Uncertain",
};

export function verdictLabel(verdict: string): string {
  return verdict in verdictLabels ? verdictLabels[verdict as Verdict] : verdict;
}

const dateFormat = new Intl.DateTimeFormat("en-PH", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
const dateTimeFormat = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

/** Formats an ISO date (YYYY-MM-DD) without shifting it across time zones. */
export const formatDate = (isoDate: string) => dateFormat.format(new Date(`${isoDate}T00:00:00Z`));
export const formatDateTime = (isoDateTime: string) => dateTimeFormat.format(new Date(isoDateTime));
export const formatMm = (mm: number | null) => (mm === null ? "No data" : `${mm.toFixed(1)} mm`);
export const formatHa = (ha: number) => `${Math.round(ha).toLocaleString("en-PH")} ha`;

// Test-only fixtures shaped like the plume detail, history and reviews responses.
import type { PlumeDetail, PlumeSummary, Review } from "./api";

export const binangonanDetail: PlumeDetail = {
  id: 27,
  place: "Binangonan",
  province: "Rizal",
  date: "2026-05-06",
  area_ha: 92,
  kind: "brown",
  rain_3d_mm: 1.2,
  rain_7d_mm: 1.4,
  is_dry: true,
  entry_lat: 14.5016,
  entry_lon: 121.145,
  latest_review: null,
  latest_decision: {
    action: "create_sampling_task",
    reason: "Dry-weather plume at a river mouth, seen in 4 earlier dry seasons. Suspicious, verify.",
    created_at: "2026-05-07T02:00:00Z",
  },
  evidence_image_url: "/evidence/27.png",
  viewer: "researcher",
  status: "sampling_pending",
};

/** The same plume as a signed-out visitor gets it: no agent decision. */
export const binangonanPublic: PlumeDetail = { ...binangonanDetail, viewer: "public", latest_decision: null };

const summary = (id: number, date: string, area_ha: number, is_dry: boolean): PlumeSummary => ({
  id,
  date,
  area_ha,
  is_dry,
  place: "Binangonan",
  kind: "brown",
  entry_lat: 14.5,
  entry_lon: 121.14,
});

export const binangonanHistory: PlumeSummary[] = [
  summary(27, "2026-05-06", 92, true),
  summary(19, "2025-04-12", 60, true),
  summary(8, "2024-08-30", 140, false),
];

export const existingReview: Review = {
  id: 1,
  verdict: "confirmed",
  reason: "Visually consistent with a water-color plume",
  reviewer: "jp",
  reviewed_at: "2026-10-15T09:48:08+00:00",
};

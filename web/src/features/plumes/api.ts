import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, retryUnlessAuth, throwIfAuthError } from "../../shared/api/client";
import type { NewReview, PlumeReview, Verdict } from "../../shared/api/types";

export type { AgentDecision, NewReview, PlumeDetail, PlumeStatus, PlumeSummary, Verdict } from "../../shared/api/types";
export type Review = PlumeReview;

export const verdicts: readonly Verdict[] = ["confirmed", "artifact", "uncertain"];

export class NotFoundError extends Error {}
export class ApiValidationError extends Error {}

const MAX_HISTORY = 500;

export const plumeKeys = {
  detail: (id: number) => ["plumes", "detail", id] as const,
  place: (place: string) => ["plumes", "place", place] as const,
  reviews: (id: number) => ["plumes", "reviews", id] as const,
};

/** The API decides what the viewer sees (`viewer`, `latest_decision`) from the bearer token. */
export function usePlumeQuery(id: number, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: plumeKeys.detail(id),
    enabled,
    queryFn: async ({ signal }) => {
      const { data, response } = await api.GET("/api/plumes/{plume_id}", {
        params: { path: { plume_id: id } },
        signal,
      });
      if (response.status === 404) throw new NotFoundError("Plume not found");
      if (!response.ok || data === undefined) throw new Error(`API returned ${response.status}`);
      return data;
    },
    retry: (count, error) => !(error instanceof NotFoundError) && count < 1,
  });
}

/** Other plumes at the same place (GET /api/plumes?place=...), newest first. */
export function usePlaceHistoryQuery(place: string | null) {
  return useQuery({
    queryKey: plumeKeys.place(place ?? ""),
    enabled: place !== null,
    queryFn: async ({ signal }) => {
      const { data, response } = await api.GET("/api/plumes", {
        params: { query: { place: place ?? undefined, limit: MAX_HISTORY } },
        signal,
      });
      if (!response.ok || data === undefined) throw new Error(`API returned ${response.status}`);
      return [...data].sort((a, b) => b.date.localeCompare(a.date));
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** FastAPI's 422 body: {detail: string | [{msg}]}. */
function validationMessage(body: unknown): string {
  if (isRecord(body)) {
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) {
      const messages = body.detail.map((item) => (isRecord(item) && typeof item.msg === "string" ? item.msg : null));
      const joined = messages.filter((m): m is string => m !== null).join("; ");
      if (joined !== "") return joined;
    }
  }
  return "The review was not accepted. Check the fields and try again.";
}

/** Researcher only (GET /api/plumes/{id}/reviews), newest first. */
export function useReviewsQuery(id: number) {
  return useQuery({
    queryKey: plumeKeys.reviews(id),
    queryFn: async ({ signal }) => {
      const { data, response } = await api.GET("/api/plumes/{plume_id}/reviews", {
        params: { path: { plume_id: id } },
        signal,
      });
      throwIfAuthError(response);
      if (!response.ok || data === undefined) throw new Error(`API returned ${response.status}`);
      return data;
    },
    retry: retryUnlessAuth,
  });
}

/** Researcher only. The reviewer is taken from the token by the API, never sent. */
export function useCreateReviewMutation(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (review: NewReview) => {
      const { data, error, response } = await api.POST("/api/plumes/{plume_id}/reviews", {
        params: { path: { plume_id: id } },
        body: review,
      });
      throwIfAuthError(response);
      if (response.status === 422 || response.status === 400) throw new ApiValidationError(validationMessage(error));
      if (!response.ok || data === undefined) throw new Error(`API returned ${response.status}`);
      return data;
    },
    onSuccess: (created) => {
      // Show it at once, then refetch so the list and the status pill match the server.
      queryClient.setQueryData<Review[]>(plumeKeys.reviews(id), (current) => [
        created,
        ...(current ?? []).filter((review) => review.id !== created.id),
      ]);
      void queryClient.invalidateQueries({ queryKey: plumeKeys.reviews(id) });
      void queryClient.invalidateQueries({ queryKey: plumeKeys.detail(id) });
    },
  });
}

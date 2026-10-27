// API types used by the features, aliased from the generated schema.ts (never edit schema.ts;
// regenerate it with `npm run gen:api`). Features import from here so a rename in the API only
// touches this file.
import type { components, paths } from "./schema";

type Schemas = components["schemas"];

export type ApiPaths = paths;

export type PlumeDetail = Schemas["PlumeDetailOut"];
export type PlumeStatus = PlumeDetail["status"];
export type Viewer = PlumeDetail["viewer"];
export type PlumeSummary = Schemas["PlumeSummaryOut"];
export type AgentDecision = Schemas["AgentDecisionOut"];
export type PlumeReview = Schemas["PlumeReviewOut"];
export type NewReview = Schemas["ReviewIn"];
export type Verdict = NewReview["verdict"];
export type SamplingTask = Schemas["SamplingTaskOut"];
export type SamplingStatus = Schemas["SamplingStatus"];
export type TaskDecisionIn = Schemas["TaskReviewIn"];
export type TaskConflict = Schemas["TaskConflictOut"];
export type Me = Schemas["MeOut"];
export type AreaIn = Schemas["AreaIn"];
export type AreaAnalysis = Schemas["AnalysisOut"];

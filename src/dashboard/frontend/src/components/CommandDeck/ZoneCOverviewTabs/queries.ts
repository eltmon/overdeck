/**
 * Shared queries for ZoneCOverview tabs.
 *
 * All tab panels for the issue-selected mode pull from a small set of
 * endpoints. Centralising the query keys here lets sibling tabs share the
 * QueryClient cache (no duplicate fetches when the user switches between
 * Overview ↔ PRD ↔ Activity, etc.).
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

export interface PlanningResponse {
  prd?: string;
  state?: string;
  inference?: string;
  statusReview?: string;
  statusReviewedAt?: string;
  transcripts?: Array<unknown>;
  discussions?: Array<{
    file?: string;
    body?: string;
    author?: string;
    createdAt?: string;
  }>;
  notes?: Array<unknown>;
}

export interface ReviewerRoundSummary {
  round: number;
  status?: string;
  startedAt?: string;
  endedAt?: string;
  /** Server returns null when timestamps were missing/invalid; consumers should handle null. */
  durationSec?: number | null;
  cost?: number;
  findings?: number;
}

export interface ReviewerRoundMetadata {
  roundCount: number;
  latestRound: number;
  latestStatus?: string;
  history: ReviewerRoundSummary[];
}

export interface ActivitySection {
  type: string;
  sessionId: string;
  model: string;
  startedAt: string;
  duration: number | null;
  status: string;
  transcript?: string;
  tmuxSession?: string;
  role?: string;
  roundMetadata?: ReviewerRoundMetadata;
}

export interface ActivityResponse {
  issueId: string;
  sections: ActivitySection[];
  costByStage?: Record<string, { cost: number; tokens: number }>;
  totalCost?: number;
}

export interface SessionCost {
  sessionId: string;
  agentId?: string;
  startedAt: string;
  endedAt: string | null;
  type: string;
  model: string;
  cost?: number;
  tokenCount?: number;
}

export interface IssueCostData {
  issueId: string;
  totalCost: number;
  totalTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  sessions: SessionCost[];
  byModel: Record<string, { cost: number; tokens: number }>;
  byStage?: Record<string, { cost: number; tokens: number }>;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
  }
  return res.json() as Promise<T>;
}

export function usePlanningQuery(issueId: string): UseQueryResult<PlanningResponse> {
  return useQuery({
    queryKey: ['command-deck-planning', issueId],
    queryFn: () => fetchJson<PlanningResponse>(`/api/command-deck/planning/${issueId}`),
    refetchInterval: 30_000,
  });
}

export function useActivityQuery(issueId: string): UseQueryResult<ActivityResponse> {
  return useQuery({
    queryKey: ['command-deck-activity', issueId],
    queryFn: () => fetchJson<ActivityResponse>(`/api/command-deck/activity/${issueId}`),
    refetchInterval: 5_000,
  });
}

export function useIssueCostsQuery(issueId: string): UseQueryResult<IssueCostData> {
  return useQuery({
    queryKey: ['issueCosts', issueId],
    queryFn: () => fetchJson<IssueCostData>(`/api/issues/${issueId}/costs`),
    refetchInterval: 30_000,
  });
}

// ─── PR/Diff (pan-9yn5) ─────────────────────────────────────────────────────

export interface PullRequestData {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  baseRefName: string;
  headRefName: string;
  author: { login?: string; name?: string } | null;
  createdAt: string;
  updatedAt: string;
  reviewDecision: string | null;
  reviewRequests: Array<{ login?: string; name?: string; __typename?: string }>;
  statusCheckRollup: Array<{
    name?: string;
    state?: string;
    conclusion?: string;
    status?: string;
    detailsUrl?: string;
    workflowName?: string;
    __typename?: string;
  }>;
  additions: number;
  deletions: number;
  changedFiles: number;
  files: Array<{ path: string; additions: number; deletions: number }>;
  labels: Array<{ name?: string; color?: string }>;
  mergeable: string | null;
  body: string;
}

export interface PrEndpointResponse {
  issueId: string;
  pr: PullRequestData | null;
  diff: string | null;
  error?: string;
}

export function usePrQuery(issueId: string): UseQueryResult<PrEndpointResponse> {
  return useQuery({
    queryKey: ['issuePr', issueId],
    queryFn: () => fetchJson<PrEndpointResponse>(`/api/issues/${issueId}/pr`),
    refetchInterval: 30_000,
  });
}

// ─── Discussions (pan-1r7j) ─────────────────────────────────────────────────

export type DiscussionSource =
  | 'linear'
  | 'github-issue'
  | 'github-pr-conversation'
  | 'github-pr-review'
  | 'github-pr-review-comment';

export interface DiscussionItem {
  id: string;
  source: DiscussionSource;
  author: string;
  body: string;
  createdAt: string;
  url?: string;
  prNumber?: number;
  reviewState?: string;
  filePath?: string;
  line?: number;
}

export interface DiscussionsResponse {
  issueId: string;
  items: DiscussionItem[];
  prNumber: number | null;
  errors?: string[];
}

export function useDiscussionsQuery(
  issueId: string,
): UseQueryResult<DiscussionsResponse> {
  return useQuery({
    queryKey: ['issueDiscussions', issueId],
    queryFn: () =>
      fetchJson<DiscussionsResponse>(`/api/issues/${issueId}/discussions`),
    refetchInterval: 30_000,
  });
}

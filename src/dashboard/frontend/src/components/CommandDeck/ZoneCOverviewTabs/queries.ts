/**
 * Shared queries for ZoneCOverview tabs.
 *
 * All tab panels for the issue-selected mode pull from a small set of
 * endpoints. Centralising the query keys here lets sibling tabs share the
 * QueryClient cache (no duplicate fetches when the user switches between
 * Overview ↔ PRD ↔ Activity, etc.).
 */

import {
  useQuery,
  type UseQueryOptions,
  type UseQueryResult,
} from '@tanstack/react-query';

export interface PlanningSummaryResponse {
  hasPrd: boolean;
  hasState: boolean;
  hasInference?: boolean;
  acceptanceProgress?: { completed: number; total: number; percent: number };
  stashCount?: number;
  statusReviewedAt?: string;
  transcriptCount?: number;
  discussionCount?: number;
  noteCount?: number;
}

export interface PlanningArtifact {
  filename?: string;
  content?: string;
  uploadedAt?: string;
  syncedAt?: string;
}

export interface PlanningResponse extends PlanningSummaryResponse {
  prd?: string;
  state?: string;
  inference?: string;
  statusReview?: string;
  transcripts?: PlanningArtifact[];
  discussions?: PlanningArtifact[];
  notes?: PlanningArtifact[];
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
  aggregateCost?: number | null;
  liveCost?: number | null;
  resolvedTotalCost?: number | null;
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
  resolvedTotalCost?: number | null;
  aggregateCost?: number | null;
  liveCost?: number | null;
  totalTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  sessions: SessionCost[];
  byModel: Record<string, { cost: number; tokens: number }>;
  byStage?: Record<string, { cost: number; tokens: number }>;
  lastUpdated?: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
  }
  return res.json() as Promise<T>;
}

export function usePlanningSummaryQuery(issueId: string): UseQueryResult<PlanningSummaryResponse> {
  return useQuery({
    queryKey: ['command-deck-planning', issueId, 'summary'],
    queryFn: () => fetchJson<PlanningSummaryResponse>(`/api/command-deck/planning/${issueId}?summary=1`),
    // Planning data is mostly static — 60s is sufficient
    refetchInterval: 60_000,
  });
}

export function usePlanningSummaryWithOverridesQuery(
  issueId: string,
  options?: Omit<UseQueryOptions<PlanningSummaryResponse>, 'queryKey' | 'queryFn'>,
): UseQueryResult<PlanningSummaryResponse> {
  return useQuery({
    queryKey: ['command-deck-planning', issueId, 'summary'],
    queryFn: () => fetchJson<PlanningSummaryResponse>(`/api/command-deck/planning/${issueId}?summary=1`),
    refetchInterval: 30_000,
    ...options,
  });
}

export function usePlanningQuery(
  issueId: string,
  options?: Omit<UseQueryOptions<PlanningResponse>, 'queryKey' | 'queryFn'>,
): UseQueryResult<PlanningResponse> {
  return useQuery({
    queryKey: ['command-deck-planning', issueId, 'full'],
    queryFn: () => fetchJson<PlanningResponse>(`/api/command-deck/planning/${issueId}`),
    refetchInterval: false,
    ...options,
  });
}

export function useActivityQuery(issueId: string): UseQueryResult<ActivityResponse> {
  return useQuery({
    queryKey: ['command-deck-activity', issueId, 'summary'],
    queryFn: () => fetchJson<ActivityResponse>(`/api/command-deck/activity/${issueId}?summary=1`),
    // Poll fast (5s) when any session is active; slow (30s) when all ended/idle.
    // Prevents hammering the server for issues with no live agents.
    refetchInterval: (query) => {
      const sections = query.state.data?.sections;
      if (!sections) return 5_000;
      const hasActive = sections.some(
        (s) => s.status === 'running' || s.status === 'active',
      );
      return hasActive ? 5_000 : 30_000;
    },
  });
}

export interface ReviewStatusData {
  issueId: string;
  reviewStatus: 'pending' | 'reviewing' | 'passed' | 'failed' | 'blocked';
  testStatus: 'pending' | 'testing' | 'passed' | 'failed' | 'skipped' | 'dispatch_failed';
  mergeStatus?: 'pending' | 'queued' | 'merging' | 'verifying' | 'merged' | 'failed';
  verificationStatus?: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  verificationNotes?: string;
  verificationCycleCount?: number;
  verificationMaxCycles?: number;
  testNotes?: string;
  reviewNotes?: string;
  mergeNotes?: string;
  mergeRetryCount?: number;
  readyForMerge: boolean;
  updatedAt: string;
  /** PAN-905: GitHub-native merge blocker reasons */
  blockerReasons?: BlockerReason[];
  /** PAN-366: Queue position — null = not queued, 0 = active, 1+ = position */
  queuePosition?: number | null;
  /** PAN-366: Which specialist is active or will handle this issue */
  activeSpecialist?: 'review' | 'test' | 'merge' | null;
}

export interface BlockerReason {
  type: 'failing_checks' | 'merge_conflict' | 'unresolved_conversations' | 'changes_requested' | 'draft_pr' | 'not_mergeable';
  summary: string;
  details?: string;
  detectedAt: string;
}

export function useReviewStatusQuery(issueId: string): UseQueryResult<ReviewStatusData> {
  return useQuery({
    queryKey: ['review-status', issueId],
    queryFn: () => fetchJson<ReviewStatusData>(`/api/review/${issueId}/status`),
    refetchInterval: 30_000,
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
  error?: string;
}

export interface PrDiffResponse {
  issueId: string;
  diff: string | null;
  error?: string;
}

export interface PrDetailsResponse extends PrEndpointResponse {
  diff: string | null;
}

export function usePrQuery(
  issueId: string,
  options?: Omit<UseQueryOptions<PrEndpointResponse>, 'queryKey' | 'queryFn'>,
): UseQueryResult<PrEndpointResponse> {
  return useQuery({
    queryKey: ['issuePr', issueId],
    queryFn: () => fetchJson<PrEndpointResponse>(`/api/issues/${issueId}/pr`),
    refetchInterval: 30_000,
    enabled: !!issueId,
    ...options,
  });
}

export function usePrDiffQuery(issueId: string): UseQueryResult<PrDiffResponse> {
  return useQuery({
    queryKey: ['issuePr', issueId, 'details'],
    queryFn: () => fetchJson<PrDetailsResponse>(`/api/issues/${issueId}/pr/details`),
    select: (data) => ({
      issueId: data.issueId,
      diff: data.diff,
      error: data.error,
    }),
    refetchInterval: false,
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

// ─── Workspace (/api/workspaces/:issueId) ───────────────────────────────────

export interface WorkspaceContainerStatus {
  running: boolean;
  uptime: string | null;
  status?: string;
}

export interface WorkspaceStackHealth {
  healthy: boolean;
  reasons: string[];
  lastObserved: string;
}

export interface WorkspaceData {
  exists: boolean;
  issueId: string;
  path?: string;
  frontendUrl?: string;
  apiUrl?: string;
  mrUrl?: string;
  hasAgent?: boolean;
  agentSessionId?: string | null;
  agentModel?: string;
  agentModelFull?: string;
  git?: { ahead: number; behind: number; branch: string; dirty: boolean } | null;
  repoGit?: { ahead: number; behind: number; branch: string; dirty: boolean } | null;
  services?: Array<{ name: string; url?: string }>;
  containers?: Record<string, WorkspaceContainerStatus> | null;
  stackHealth?: WorkspaceStackHealth;
  hasDocker?: boolean;
  canContainerize?: boolean;
  pendingOperation?: string | null;
  location?: 'local' | 'remote';
  isRemote?: boolean;
  vmName?: string;
  remotePath?: string;
  corrupted?: boolean;
}

export function useWorkspaceQuery(issueId: string): UseQueryResult<WorkspaceData> {
  return useQuery({
    queryKey: ['workspace', issueId],
    queryFn: () => fetchJson<WorkspaceData>(`/api/workspaces/${issueId}`),
    refetchInterval: 30_000,
  });
}

/**
 * GitHub webhook event handlers (PAN-905)
 *
 * Dispatches verified webhook events to per-type handlers that update
 * review_status blockerReasons based on GitHub-native merge blockers.
 */

import { Effect } from 'effect';
import { setReviewStatus, getReviewStatus, loadReviewStatuses, type BlockerReason, type ReviewStatus } from './review-status.js';
import { getGitHubConfig } from '../dashboard/server/services/tracker-config.js';
import { GitHubApiError } from './errors.js';

export interface WebhookPayload {
  action?: string;
  pull_request?: {
    number: number;
    head: { ref: string; sha?: string };
    html_url?: string;
    mergeable?: boolean | null;
    mergeable_state?: string;
    draft?: boolean;
    state?: string;
    merged?: boolean;
  };
  check_suite?: {
    status?: string;
    conclusion?: string | null;
    pull_requests?: Array<{ number: number; head: { ref: string; sha?: string } }>;
  };
  check_run?: {
    id?: number;
    name?: string;
    status?: string;
    conclusion?: string | null;
    pull_requests?: Array<{ number: number; head: { ref: string; sha?: string } }>;
  };
  repository?: { full_name: string };
  review?: { state: string };
  thread?: { id?: number; resolved?: boolean };
  // status event payload
  sha?: string;
  state?: string;
  context?: string;
  branches?: Array<{ name: string }>;
}

function issueIdFromBranch(ref: string): string | null {
  const match = ref.match(/feature\/([a-z]+-\d+)$/i);
  return match ? match[1].toUpperCase() : null;
}

// ─── Repository authorization (defense-in-depth) ─────────────────────────────

// ─── Cached repository allowlist (refreshed every 5 min) ─────────────────────

let cachedTrackedRepos: Set<string> | null = null;
let cachedTrackedReposAt = 0;
const REPO_CACHE_TTL_MS = 5 * 60 * 1000;

function getTrackedRepos(): Set<string> {
  const now = Date.now();
  if (!cachedTrackedRepos || now - cachedTrackedReposAt > REPO_CACHE_TTL_MS) {
    const config = getGitHubConfig();
    cachedTrackedRepos = config
      ? new Set(config.repos.map(({ owner, repo }) => `${owner}/${repo}`.toLowerCase()))
      : new Set();
    cachedTrackedReposAt = now;
  }
  return cachedTrackedRepos;
}

export function isTrackedRepositorySync(fullName: string | undefined): boolean {
  if (!fullName) return false;
  return getTrackedRepos().has(fullName.toLowerCase());
}

// ─── PR identity validation ──────────────────────────────────────────────────

function getRepoFromPrUrl(prUrl: string): string | null {
  const m = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/i);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

async function loadAndValidateStatus(
  issueId: string,
  repo: string,
  prNumber?: number,
  headSha?: string,
): Promise<ReviewStatus | null> {
  const status = await Effect.runPromise(getReviewStatus(issueId));
  if (!status) return null;

  // If no PR identity is stored yet, allow the event (identity will be populated lazily).
  if (!status.prUrl && !status.prNumber && !status.prHeadSha) {
    return status;
  }

  const storedRepo = status.prUrl ? getRepoFromPrUrl(status.prUrl) : null;
  if (storedRepo && storedRepo !== repo.toLowerCase()) {
    console.warn(`[webhook] Repo mismatch for ${issueId}: stored=${storedRepo} event=${repo}`);
    return null;
  }

  if (prNumber != null && status.prNumber != null && prNumber !== status.prNumber) {
    console.warn(`[webhook] PR number mismatch for ${issueId}: stored=${status.prNumber} event=${prNumber}`);
    return null;
  }

  if (headSha && status.prHeadSha && headSha !== status.prHeadSha) {
    console.warn(`[webhook] Head SHA mismatch for ${issueId}: stored=${status.prHeadSha} event=${headSha}`);
    return null;
  }

  return status;
}

// ─── Per-source failing_checks tracking ──────────────────────────────────────

function getFailingChecksBlocker(blockers: BlockerReason[]): BlockerReason | undefined {
  return blockers.find((b) => b.type === 'failing_checks');
}

function parseFailingSources(details?: string): Record<string, string> {
  if (!details) return {};
  try {
    const parsed = JSON.parse(details) as { sources?: Record<string, string> };
    return parsed.sources ?? {};
  } catch {
    return {};
  }
}

function serializeFailingSources(sources: Record<string, string>): string {
  return JSON.stringify({ sources });
}

function addFailingSource(blockers: BlockerReason[], sourceKey: string, summary: string): BlockerReason[] {
  const existing = getFailingChecksBlocker(blockers);
  const sources = parseFailingSources(existing?.details);
  sources[sourceKey] = summary;
  const updated: BlockerReason = {
    type: 'failing_checks',
    summary: Object.values(sources).join('; '),
    details: serializeFailingSources(sources),
    detectedAt: existing?.detectedAt ?? new Date().toISOString(),
  };
  return [...blockers.filter((b) => b.type !== 'failing_checks'), updated];
}

function removeFailingSource(blockers: BlockerReason[], sourceKey: string): BlockerReason[] {
  const existing = getFailingChecksBlocker(blockers);
  if (!existing) return blockers;
  const sources = parseFailingSources(existing.details);
  delete sources[sourceKey];
  if (Object.keys(sources).length === 0) {
    return blockers.filter((b) => b.type !== 'failing_checks');
  }
  const updated: BlockerReason = {
    type: 'failing_checks',
    summary: Object.values(sources).join('; '),
    details: serializeFailingSources(sources),
    detectedAt: existing.detectedAt,
  };
  return [...blockers.filter((b) => b.type !== 'failing_checks'), updated];
}

// ─── Merge state reconciliation for unknown mergeable_state ──────────────────

const KNOWN_CONFLICT_STATES = new Set(['dirty']);
const KNOWN_NON_BLOCKING_STATES = new Set(['clean', 'unstable']);
const KNOWN_NOT_MERGEABLE_STATES = new Set(['blocked', 'behind']);

/** `gh` statusCheckRollup conclusions/states that count as a failing required check. */
const FAILING_CHECK_CONCLUSIONS = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE']);

const pendingReconciliation = new Set<string>();
const reconciliationTimeouts = new Map<string, NodeJS.Timeout>();

export function clearAllReconciliationTimeouts(): void {
  for (const timeout of reconciliationTimeouts.values()) {
    clearTimeout(timeout);
  }
  reconciliationTimeouts.clear();
  pendingReconciliation.clear();
}

function scheduleMergeStateReconciliation(issueId: string, repo: string, prNumber: number): void {
  if (pendingReconciliation.has(issueId)) return;
  pendingReconciliation.add(issueId);
  const timeout = setTimeout(() => {
    pendingReconciliation.delete(issueId);
    reconciliationTimeouts.delete(issueId);
    refreshMergeStateFromGitHub(issueId, repo, prNumber).catch(() => {});
  }, 30000);
  timeout.unref();
  reconciliationTimeouts.set(issueId, timeout);
}

export async function refreshMergeStateFromGitHub(issueId: string, repo: string, prNumber: number): Promise<void> {
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    // gh GraphQL fields (NOT the REST webhook shape): mergeable is an enum
    // (MERGEABLE | CONFLICTING | UNKNOWN), mergeStateStatus is CLEAN | DIRTY |
    // UNSTABLE | BLOCKED | BEHIND | …, isDraft is a bool, and statusCheckRollup
    // carries the required-check results. The previous query used `mergeableState`
    // (no such gh field) so the call threw on every invocation and this reconciler
    // silently did nothing — leaving readyForMerge PRs with stale/empty blockers. PAN-1620.
    const { stdout } = await execFileAsync(
      'gh',
      ['pr', 'view', String(prNumber), '--repo', repo, '--json', 'mergeable,mergeStateStatus,isDraft,statusCheckRollup'],
      { encoding: 'utf-8', timeout: 15000 },
    );
    const pr = JSON.parse(stdout) as {
      mergeable?: string | null;
      mergeStateStatus?: string | null;
      isDraft?: boolean;
      statusCheckRollup?: Array<{ conclusion?: string | null; state?: string | null }>;
    };
    const status = await Effect.runPromise(getReviewStatus(issueId));
    if (!status) return;

    const mergeable = (pr.mergeable ?? '').toUpperCase();
    const mergeState = (pr.mergeStateStatus ?? '').toUpperCase();
    const isConflicting = mergeable === 'CONFLICTING' || mergeState === 'DIRTY';
    const checksFailed = (pr.statusCheckRollup ?? []).some((c) =>
      FAILING_CHECK_CONCLUSIONS.has((c.conclusion || c.state || '').toUpperCase()),
    );

    // Rebuild the GitHub-native blockers from live state, preserving any
    // non-GitHub-native ones (e.g. unresolved_conversations, changes_requested).
    const GH_NATIVE = new Set<BlockerReason['type']>(['merge_conflict', 'not_mergeable', 'failing_checks', 'draft_pr']);
    const now = new Date().toISOString();
    const blockers: BlockerReason[] = (status.blockerReasons ?? []).filter((b) => !GH_NATIVE.has(b.type));
    if (pr.isDraft) blockers.push({ type: 'draft_pr', summary: 'Pull request is in draft state', detectedAt: now });
    if (isConflicting) {
      blockers.push({ type: 'merge_conflict', summary: 'Merge conflict with target branch', detectedAt: now });
    } else if (mergeState === 'BLOCKED' && !checksFailed) {
      blockers.push({ type: 'not_mergeable', summary: 'PR blocked by branch protection', detectedAt: now });
    }
    if (checksFailed) blockers.push({ type: 'failing_checks', summary: 'Required checks are failing', detectedAt: now });

    // Only write when the GitHub-native blocker set actually changed.
    const prevTypes = new Set((status.blockerReasons ?? []).filter((b) => GH_NATIVE.has(b.type)).map((b) => b.type));
    const nextTypes = new Set(blockers.filter((b) => GH_NATIVE.has(b.type)).map((b) => b.type));
    const changed = prevTypes.size !== nextTypes.size || [...nextTypes].some((t) => !prevTypes.has(t));
    if (changed) {
      await Effect.runPromise(setReviewStatus(issueId, { blockerReasons: blockers.length > 0 ? blockers : undefined }, status));
    }
  } catch (err) {
    console.warn(`[webhook] Merge state reconciliation failed for ${issueId}:`, err);
  }
}async function handleCheckSuitePromise(payload: WebhookPayload): Promise<void> {
  if (!isTrackedRepositorySync(payload.repository?.full_name)) return;
  const suite = payload.check_suite;
  if (!suite) return;
  if (!suite.pull_requests || suite.pull_requests.length === 0) return;

  const repo = payload.repository!.full_name;

  for (const pr of suite.pull_requests) {
    const issueId = issueIdFromBranch(pr.head.ref);
    if (!issueId) continue;

    const status = await loadAndValidateStatus(issueId, repo, pr.number, pr.head.sha);
    if (!status) continue;

    let blockers = [...(status.blockerReasons ?? [])];

    if (suite.conclusion === 'success') {
      blockers = removeFailingSource(blockers, 'check_suite');
    } else if (suite.conclusion) {
      // Any terminal conclusion other than success is blocking
      blockers = addFailingSource(blockers, 'check_suite', `CI check suite ${suite.conclusion}`);
    }

    const update: Partial<ReviewStatus> = {};
    if (blockers.length > 0) update.blockerReasons = blockers;
    else if (status.blockerReasons && status.blockerReasons.length > 0) update.blockerReasons = undefined;

    if (Object.keys(update).length > 0) {
      await Effect.runPromise(setReviewStatus(issueId, update, status));
    }
  }
}async function handleCheckRunPromise(payload: WebhookPayload): Promise<void> {
  if (!isTrackedRepositorySync(payload.repository?.full_name)) return;
  const run = payload.check_run;
  if (!run) return;
  if (!run.pull_requests || run.pull_requests.length === 0) return;

  const repo = payload.repository!.full_name;
  const sourceKey = `check_run:${run.name ?? String(run.id ?? 'unknown')}`;

  for (const pr of run.pull_requests) {
    const issueId = issueIdFromBranch(pr.head.ref);
    if (!issueId) continue;

    const status = await loadAndValidateStatus(issueId, repo, pr.number, pr.head.sha);
    if (!status) continue;

    let blockers = [...(status.blockerReasons ?? [])];

    if (run.conclusion === 'success') {
      blockers = removeFailingSource(blockers, sourceKey);
    } else if (run.conclusion) {
      blockers = addFailingSource(blockers, sourceKey, `CI check run ${run.conclusion}: ${run.name ?? 'unknown'}`);
    }

    const update: Partial<ReviewStatus> = {};
    if (blockers.length > 0) update.blockerReasons = blockers;
    else if (status.blockerReasons && status.blockerReasons.length > 0) update.blockerReasons = undefined;

    if (Object.keys(update).length > 0) {
      await Effect.runPromise(setReviewStatus(issueId, update, status));
    }
  }
}async function handlePullRequestPromise(payload: WebhookPayload): Promise<void> {
  if (!isTrackedRepositorySync(payload.repository?.full_name)) return;
  const pr = payload.pull_request;
  if (!pr) return;
  const issueId = issueIdFromBranch(pr.head.ref);
  if (!issueId) return;

  const repo = payload.repository!.full_name;

  // PAN-1513: fire postMergeLifecycle when GitHub reports the PR closed+merged.
  // Without this, admin-merges (gh pr merge --admin) and any merge that doesn't
  // route through Panopticon's own merge flow leave work agents, strikes, tmux
  // sessions, and worktrees orphaned. postMergeLifecycle has its own
  // single-flight guard (specialists.ts L116) and _completedPostMerge marker,
  // so duplicate webhook deliveries are idempotent.
  if (payload.action === 'closed' && pr.merged === true) {
    try {
      const { postMergeLifecycle } = await import('./cloister/merge-agent.js');
      const { resolveProjectFromIssueSync } = await import('./projects.js');
      const project = resolveProjectFromIssueSync(issueId);
      if (project) {
        const branchName = pr.head.ref;
        postMergeLifecycle(issueId, project.projectPath, branchName).catch(err =>
          console.warn(`[webhook] postMergeLifecycle failed for ${issueId} (${branchName}): ${err?.message ?? err}`),
        );
      }
    } catch (err: any) {
      console.warn(`[webhook] Failed to dispatch postMergeLifecycle for ${issueId}: ${err?.message ?? err}`);
    }
  }

  // For synchronize/opened/reopened the head SHA may have changed — skip SHA
  // validation so the handler can refresh prHeadSha and recompute blockers.
  const headMayHaveMoved = ['synchronize', 'opened', 'reopened'].includes(payload.action ?? '');
  const status = await loadAndValidateStatus(issueId, repo, pr.number, headMayHaveMoved ? undefined : pr.head.sha);
  if (!status) return;

  const update: Partial<ReviewStatus> = {};
  let blockers = [...(status.blockerReasons ?? [])];

  // Populate missing PR identity and keep head SHA in sync on synchronize
  if (!status.prUrl) update.prUrl = pr.html_url ?? `https://github.com/${repo}/pull/${pr.number}`;
  if (!status.prNumber) update.prNumber = pr.number;
  if (pr.head.sha && (!status.prHeadSha || payload.action === 'synchronize')) {
    update.prHeadSha = pr.head.sha;
  }

  // Dismissed reviews
  if (payload.action === 'review_dismissed') {
    blockers = blockers.filter((b) => b.type !== 'changes_requested');
  }

  // Draft PR
  if (pr.draft) {
    const draftBlocker: BlockerReason = {
      type: 'draft_pr',
      summary: 'Pull request is in draft state',
      detectedAt: new Date().toISOString(),
    };
    blockers = [...blockers.filter((b) => b.type !== 'draft_pr'), draftBlocker];
  } else {
    blockers = blockers.filter((b) => b.type !== 'draft_pr');
  }

  // Merge state
  if (pr.mergeable_state === 'unknown') {
    scheduleMergeStateReconciliation(issueId, repo, pr.number);
  } else if (pr.mergeable_state && KNOWN_CONFLICT_STATES.has(pr.mergeable_state)) {
    const mergeConflictBlocker: BlockerReason = {
      type: 'merge_conflict',
      summary: 'Merge conflict with target branch',
      detectedAt: new Date().toISOString(),
    };
    blockers = [...blockers.filter((b) => b.type !== 'merge_conflict' && b.type !== 'not_mergeable'), mergeConflictBlocker];
  } else if (pr.mergeable === false && (pr.mergeable_state === null || pr.mergeable_state === undefined)) {
    const mergeConflictBlocker: BlockerReason = {
      type: 'merge_conflict',
      summary: 'Merge conflict with target branch',
      detectedAt: new Date().toISOString(),
    };
    blockers = [...blockers.filter((b) => b.type !== 'merge_conflict' && b.type !== 'not_mergeable'), mergeConflictBlocker];
  } else if ((pr.mergeable_state && KNOWN_NON_BLOCKING_STATES.has(pr.mergeable_state)) || pr.mergeable === true) {
    blockers = blockers.filter((b) => b.type !== 'merge_conflict' && b.type !== 'not_mergeable');
  } else if (pr.mergeable_state && KNOWN_NOT_MERGEABLE_STATES.has(pr.mergeable_state)) {
    const notMergeableBlocker: BlockerReason = {
      type: 'not_mergeable',
      summary: `PR not mergeable: ${pr.mergeable_state}`,
      detectedAt: new Date().toISOString(),
    };
    blockers = [...blockers.filter((b) => b.type !== 'merge_conflict' && b.type !== 'not_mergeable'), notMergeableBlocker];
  }

  if (blockers.length > 0) update.blockerReasons = blockers;
  else if (status.blockerReasons && status.blockerReasons.length > 0) update.blockerReasons = undefined;

  if (Object.keys(update).length > 0) {
    await Effect.runPromise(setReviewStatus(issueId, update, status));
  }
}async function handlePullRequestReviewPromise(payload: WebhookPayload): Promise<void> {
  if (!isTrackedRepositorySync(payload.repository?.full_name)) return;
  const pr = payload.pull_request;
  const review = payload.review;
  if (!pr || !review) return;
  const issueId = issueIdFromBranch(pr.head.ref);
  if (!issueId) return;

  const repo = payload.repository!.full_name;
  const status = await loadAndValidateStatus(issueId, repo, pr.number);
  if (!status) return;

  // Dismissed reviews are handled by the pull_request review_dismissed action.
  if (review.state === 'dismissed') return;

  let blockers = [...(status.blockerReasons ?? [])];

  if (review.state === 'changes_requested') {
    blockers = [...blockers.filter((b) => b.type !== 'changes_requested'), {
      type: 'changes_requested',
      summary: 'Changes requested on pull request',
      detectedAt: new Date().toISOString(),
    }];
  } else if (review.state === 'approved') {
    blockers = blockers.filter((b) => b.type !== 'changes_requested');
  }

  const update: Partial<ReviewStatus> = {};
  if (blockers.length > 0) update.blockerReasons = blockers;
  else if (status.blockerReasons && status.blockerReasons.length > 0) update.blockerReasons = undefined;

  if (Object.keys(update).length > 0) {
    await Effect.runPromise(setReviewStatus(issueId, update, status));
  }
}async function handlePullRequestReviewThreadPromise(payload: WebhookPayload): Promise<void> {
  if (!isTrackedRepositorySync(payload.repository?.full_name)) return;
  const pr = payload.pull_request;
  const thread = payload.thread;
  if (!pr || !thread) return;
  const issueId = issueIdFromBranch(pr.head.ref);
  if (!issueId) return;

  const repo = payload.repository!.full_name;
  const status = await loadAndValidateStatus(issueId, repo, pr.number);
  if (!status) return;

  let blockers = [...(status.blockerReasons ?? [])];

  if (thread.resolved === false) {
    if (thread.id == null) {
      console.warn(`[webhook] Unresolved review thread without id for ${issueId} — cannot track conversation`);
    }
    const existing = blockers.find((b) => b.type === 'unresolved_conversations');
    let threadIds: Set<string>;
    try {
      threadIds = new Set<string>(JSON.parse(existing?.details ?? '[]') as string[]);
    } catch {
      threadIds = new Set<string>();
    }
    if (thread.id != null) threadIds.add(String(thread.id));
    const updated: BlockerReason = {
      type: 'unresolved_conversations',
      summary: 'Unresolved review conversation',
      details: JSON.stringify([...threadIds]),
      detectedAt: existing?.detectedAt ?? new Date().toISOString(),
    };
    blockers = [...blockers.filter((b) => b.type !== 'unresolved_conversations'), updated];
  } else if (thread.resolved === true) {
    if (thread.id == null) return;
    const existing = blockers.find((b) => b.type === 'unresolved_conversations');
    if (!existing) return;
    let threadIds: Set<string>;
    try {
      threadIds = new Set<string>(JSON.parse(existing.details ?? '[]') as string[]);
    } catch {
      threadIds = new Set<string>();
    }
    threadIds.delete(String(thread.id));
    if (threadIds.size === 0) {
      blockers = blockers.filter((b) => b.type !== 'unresolved_conversations');
    } else {
      const updated: BlockerReason = {
        type: 'unresolved_conversations',
        summary: 'Unresolved review conversation',
        details: JSON.stringify([...threadIds]),
        detectedAt: existing.detectedAt,
      };
      blockers = [...blockers.filter((b) => b.type !== 'unresolved_conversations'), updated];
    }
  }

  const update: Partial<ReviewStatus> = {};
  if (blockers.length > 0) update.blockerReasons = blockers;
  else if (status.blockerReasons && status.blockerReasons.length > 0) update.blockerReasons = undefined;

  if (Object.keys(update).length > 0) {
    await Effect.runPromise(setReviewStatus(issueId, update, status));
  }
}async function handleStatusPromise(payload: WebhookPayload): Promise<void> {
  if (!isTrackedRepositorySync(payload.repository?.full_name)) return;
  const state = payload.state;
  const branches = payload.branches;
  if (!state || !branches || branches.length === 0) return;

  const repo = payload.repository!.full_name;
  const context = payload.context ?? 'default';
  const sourceKey = `status:${context}`;

  for (const branch of branches) {
    const issueId = issueIdFromBranch(branch.name);
    if (issueId) {
      const status = await loadAndValidateStatus(issueId, repo, undefined, payload.sha);
      if (!status) continue;

      let blockers = [...(status.blockerReasons ?? [])];

      if (state === 'success') {
        blockers = removeFailingSource(blockers, sourceKey);
      } else if (state === 'failure' || state === 'error') {
        blockers = addFailingSource(blockers, sourceKey, `Commit status: ${state}`);
      }

      const update: Partial<ReviewStatus> = {};
      if (blockers.length > 0) update.blockerReasons = blockers;
      else if (status.blockerReasons && status.blockerReasons.length > 0) update.blockerReasons = undefined;

      // Do NOT populate prHeadSha from status events — we don't have the PR number
      // to construct a prUrl, and the SHA alone isn't enough to bind identity.

      if (Object.keys(update).length > 0) {
        await Effect.runPromise(setReviewStatus(issueId, update, status));
      }

      // Keep scanning in case the payload includes multiple feature branches.
      continue;
    }
  }
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

const toGhError = (op: string, cause: unknown): GitHubApiError =>
  new GitHubApiError({
    operation: op,
    status: 0,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });

/** Effect: handle a `check_suite` GitHub webhook payload. */
export const handleCheckSuite = (
  payload: WebhookPayload,
): Effect.Effect<void, GitHubApiError> =>
  Effect.tryPromise({
    try: () => handleCheckSuitePromise(payload),
    catch: (cause) => toGhError('handleCheckSuite', cause),
  });

/** Effect: handle a `check_run` GitHub webhook payload. */
export const handleCheckRun = (
  payload: WebhookPayload,
): Effect.Effect<void, GitHubApiError> =>
  Effect.tryPromise({
    try: () => handleCheckRunPromise(payload),
    catch: (cause) => toGhError('handleCheckRun', cause),
  });

/** Effect: handle a `pull_request` GitHub webhook payload. */
export const handlePullRequest = (
  payload: WebhookPayload,
): Effect.Effect<void, GitHubApiError> =>
  Effect.tryPromise({
    try: () => handlePullRequestPromise(payload),
    catch: (cause) => toGhError('handlePullRequest', cause),
  });

/** Effect: handle a `pull_request_review` GitHub webhook payload. */
export const handlePullRequestReview = (
  payload: WebhookPayload,
): Effect.Effect<void, GitHubApiError> =>
  Effect.tryPromise({
    try: () => handlePullRequestReviewPromise(payload),
    catch: (cause) => toGhError('handlePullRequestReview', cause),
  });

/** Effect: handle a `pull_request_review_thread` GitHub webhook payload. */
export const handlePullRequestReviewThread = (
  payload: WebhookPayload,
): Effect.Effect<void, GitHubApiError> =>
  Effect.tryPromise({
    try: () => handlePullRequestReviewThreadPromise(payload),
    catch: (cause) => toGhError('handlePullRequestReviewThread', cause),
  });

/** Effect: handle a `status` GitHub webhook payload. */
export const handleStatus = (
  payload: WebhookPayload,
): Effect.Effect<void, GitHubApiError> =>
  Effect.tryPromise({
    try: () => handleStatusPromise(payload),
    catch: (cause) => toGhError('handleStatus', cause),
  });

/** True if the repo is in the cached tracked-repos allowlist. Pure. */
export const isTrackedRepository = (
  fullName: string | undefined,
): Effect.Effect<boolean> =>
  Effect.sync(() => isTrackedRepositorySync(fullName));

// ─── Boot-time blocker reconciliation (PAN-1771) ─────────────────────────────

const GH_NATIVE_BLOCKER_TYPES = new Set<BlockerReason['type']>([
  'merge_conflict',
  'not_mergeable',
  'failing_checks',
  'draft_pr',
]);

function prNumberFromUrl(prUrl: string): number | null {
  const m = prUrl.match(/\/pull\/(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Pure boot-sweep filter: returns the PR identity to refresh when a status
 * carries GitHub-native blockers that may have gone stale, null otherwise.
 * Exported for tests.
 */
export function needsBlockerReconciliation(
  status: Pick<ReviewStatus, 'mergeStatus' | 'blockerReasons' | 'prUrl' | 'prNumber'>,
): { repo: string; prNumber: number } | null {
  if (status.mergeStatus === 'merged') return null;
  const ghBlockers = (status.blockerReasons ?? []).filter((b) => GH_NATIVE_BLOCKER_TYPES.has(b.type));
  if (ghBlockers.length === 0) return null;
  const repo = status.prUrl ? getRepoFromPrUrl(status.prUrl) : null;
  const prNumber = status.prNumber ?? (status.prUrl ? prNumberFromUrl(status.prUrl) : null);
  if (!repo || !prNumber) return null;
  return { repo, prNumber };
}

/**
 * PAN-1771: GitHub-native blockers (failing_checks, merge_conflict, draft_pr,
 * not_mergeable) are refreshed only by webhook-driven
 * refreshMergeStateFromGitHub calls. Webhooks that arrive while the server is
 * down (reboot, deploy restart, crash) are lost, so a blocker recorded before
 * the outage can outlive the condition it describes — and a stale blocker pins
 * readyForMerge=false forever under the PAN-1650 event-driven derivation.
 *
 * Re-derives the blocker set from live PR state for every non-merged status
 * still carrying GitHub-native blockers. Sequential on purpose: the candidate
 * set is small and this avoids a gh subprocess burst at boot. Returns the
 * number of statuses refreshed.
 */
export async function reconcileStaleGitHubBlockers(): Promise<number> {
  const statuses = loadReviewStatuses();
  let refreshed = 0;
  for (const status of Object.values(statuses)) {
    const target = needsBlockerReconciliation(status);
    if (!target) continue;
    await refreshMergeStateFromGitHub(status.issueId, target.repo, target.prNumber);
    refreshed++;
  }
  return refreshed;
}

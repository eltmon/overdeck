/**
 * GitHub webhook event handlers (PAN-905)
 *
 * Dispatches verified webhook events to per-type handlers that update
 * review_status blockerReasons based on GitHub-native merge blockers.
 */

import { setReviewStatusAsync, getReviewStatusAsync, type BlockerReason, type ReviewStatus } from './review-status.js';
import { getGitHubConfig } from '../dashboard/server/services/tracker-config.js';

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
  const match = ref.match(/feature\/([a-z]+-\d+)/i);
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

export function isTrackedRepository(fullName: string | undefined): boolean {
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
  const status = await getReviewStatusAsync(issueId);
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

async function refreshMergeStateFromGitHub(issueId: string, repo: string, prNumber: number): Promise<void> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const { stdout } = await execAsync(
      `gh pr view ${prNumber} --repo ${repo} --json mergeable,mergeableState,draft --jq '[.mergeable,.mergeableState,.draft]'`,
      { encoding: 'utf-8', timeout: 15000 },
    );
    const [mergeable, mergeableState, draft] = JSON.parse(stdout) as [boolean | null, string | null, boolean];
    const status = await getReviewStatusAsync(issueId);
    if (!status) return;

    const update: Partial<ReviewStatus> = {};
    let blockers = [...(status.blockerReasons ?? [])];

    if (draft) {
      const draftBlocker: BlockerReason = {
        type: 'draft_pr',
        summary: 'Pull request is in draft state',
        detectedAt: new Date().toISOString(),
      };
      blockers = [...blockers.filter((b) => b.type !== 'draft_pr'), draftBlocker];
    } else {
      blockers = blockers.filter((b) => b.type !== 'draft_pr');
    }

    if (mergeableState && KNOWN_CONFLICT_STATES.has(mergeableState)) {
      const mergeConflictBlocker: BlockerReason = {
        type: 'merge_conflict',
        summary: 'Merge conflict with target branch',
        detectedAt: new Date().toISOString(),
      };
      blockers = [...blockers.filter((b) => b.type !== 'merge_conflict' && b.type !== 'not_mergeable'), mergeConflictBlocker];
    } else if (mergeable === false && (mergeableState == null || mergeableState === undefined)) {
      const mergeConflictBlocker: BlockerReason = {
        type: 'merge_conflict',
        summary: 'Merge conflict with target branch',
        detectedAt: new Date().toISOString(),
      };
      blockers = [...blockers.filter((b) => b.type !== 'merge_conflict' && b.type !== 'not_mergeable'), mergeConflictBlocker];
    } else if ((mergeableState && KNOWN_NON_BLOCKING_STATES.has(mergeableState)) || mergeable === true) {
      blockers = blockers.filter((b) => b.type !== 'merge_conflict' && b.type !== 'not_mergeable');
    } else if (mergeableState && KNOWN_NOT_MERGEABLE_STATES.has(mergeableState)) {
      const notMergeableBlocker: BlockerReason = {
        type: 'not_mergeable',
        summary: `PR not mergeable: ${mergeableState}`,
        detectedAt: new Date().toISOString(),
      };
      blockers = [...blockers.filter((b) => b.type !== 'merge_conflict' && b.type !== 'not_mergeable'), notMergeableBlocker];
    }

    if (blockers.length > 0) update.blockerReasons = blockers;
    else if (status.blockerReasons && status.blockerReasons.length > 0) update.blockerReasons = undefined;

    if (Object.keys(update).length > 0) {
      await setReviewStatusAsync(issueId, update, status);
    }
  } catch (err) {
    console.warn(`[webhook] Merge state reconciliation failed for ${issueId}:`, err);
  }
}

// ─── check_suite / check_run ─────────────────────────────────────────────────

export async function handleCheckSuite(payload: WebhookPayload): Promise<void> {
  if (!isTrackedRepository(payload.repository?.full_name)) return;
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
      await setReviewStatusAsync(issueId, update, status);
    }
  }
}

export async function handleCheckRun(payload: WebhookPayload): Promise<void> {
  if (!isTrackedRepository(payload.repository?.full_name)) return;
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
      await setReviewStatusAsync(issueId, update, status);
    }
  }
}

// ─── pull_request ────────────────────────────────────────────────────────────

export async function handlePullRequest(payload: WebhookPayload): Promise<void> {
  if (!isTrackedRepository(payload.repository?.full_name)) return;
  const pr = payload.pull_request;
  if (!pr) return;
  const issueId = issueIdFromBranch(pr.head.ref);
  if (!issueId) return;

  const repo = payload.repository!.full_name;
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
    await setReviewStatusAsync(issueId, update, status);
  }
}

// ─── pull_request_review ─────────────────────────────────────────────────────

export async function handlePullRequestReview(payload: WebhookPayload): Promise<void> {
  if (!isTrackedRepository(payload.repository?.full_name)) return;
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
    await setReviewStatusAsync(issueId, update, status);
  }
}

// ─── pull_request_review_thread ──────────────────────────────────────────────

export async function handlePullRequestReviewThread(payload: WebhookPayload): Promise<void> {
  if (!isTrackedRepository(payload.repository?.full_name)) return;
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
    await setReviewStatusAsync(issueId, update, status);
  }
}

// ─── status ──────────────────────────────────────────────────────────────────

export async function handleStatus(payload: WebhookPayload): Promise<void> {
  if (!isTrackedRepository(payload.repository?.full_name)) return;
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
        await setReviewStatusAsync(issueId, update, status);
      }

      // Only act on the first feature branch match
      break;
    }
  }
}

/**
 * GitHub webhook event handlers (PAN-905)
 *
 * Dispatches verified webhook events to per-type handlers that update
 * review_status blockerReasons based on GitHub-native merge blockers.
 */

import { setReviewStatusAsync, getReviewStatusAsync, type BlockerReason } from './review-status.js';
import { getGitHubConfig } from '../dashboard/server/services/tracker-config.js';

export interface WebhookPayload {
  action?: string;
  pull_request?: {
    number: number;
    head: { ref: string };
    mergeable?: boolean | null;
    mergeable_state?: string;
    draft?: boolean;
    state?: string;
  };
  check_suite?: {
    status?: string;
    conclusion?: string | null;
    pull_requests?: Array<{ number: number; head: { ref: string } }>;
  };
  check_run?: {
    status?: string;
    conclusion?: string | null;
    pull_requests?: Array<{ number: number; head: { ref: string } }>;
  };
  repository?: { full_name: string };
  review?: { state: string };
  thread?: { id?: number; resolved?: boolean };
  // status event payload
  sha?: string;
  state?: string;
  branches?: Array<{ name: string }>;
}

function issueIdFromBranch(ref: string): string | null {
  const match = ref.match(/feature\/(pan-\d+)/i);
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

// ─── Batched blocker mutation (single read + single write per event) ─────────

async function mutateBlockers(issueId: string, fn: (blockers: BlockerReason[]) => BlockerReason[]): Promise<void> {
  const status = await getReviewStatusAsync(issueId);
  const blockers = status?.blockerReasons ?? [];
  const updated = fn(blockers);
  await setReviewStatusAsync(issueId, { blockerReasons: updated.length > 0 ? updated : undefined });
}

async function addBlocker(issueId: string, blocker: BlockerReason): Promise<void> {
  await mutateBlockers(issueId, (blockers) => {
    const filtered = blockers.filter((b: BlockerReason) => b.type !== blocker.type);
    return [...filtered, blocker];
  });
}

async function removeBlocker(issueId: string, type: BlockerReason['type']): Promise<void> {
  await mutateBlockers(issueId, (blockers) => blockers.filter((b: BlockerReason) => b.type !== type));
}

// ─── check_suite / check_run ─────────────────────────────────────────────────

export async function handleCheckSuite(payload: WebhookPayload): Promise<void> {
  if (!isTrackedRepository(payload.repository?.full_name)) return;
  const suite = payload.check_suite;
  if (!suite) return;
  const pr = suite.pull_requests?.[0];
  if (!pr) return;
  const issueId = issueIdFromBranch(pr.head.ref);
  if (!issueId) return;

  if (suite.conclusion === 'failure') {
    await addBlocker(issueId, {
      type: 'failing_checks',
      summary: 'CI check suite failed',
      detectedAt: new Date().toISOString(),
    });
  } else if (suite.conclusion === 'success') {
    await removeBlocker(issueId, 'failing_checks');
  }
}

export async function handleCheckRun(payload: WebhookPayload): Promise<void> {
  if (!isTrackedRepository(payload.repository?.full_name)) return;
  const run = payload.check_run;
  if (!run) return;
  const pr = run.pull_requests?.[0];
  if (!pr) return;
  const issueId = issueIdFromBranch(pr.head.ref);
  if (!issueId) return;

  if (run.conclusion === 'failure') {
    await addBlocker(issueId, {
      type: 'failing_checks',
      summary: 'CI check run failed',
      detectedAt: new Date().toISOString(),
    });
  }
  // Do NOT remove failing_checks on individual check_run success —
  // other runs in the same suite may still be failing. Blocker
  // removal is handled by check_suite conclusion='success'.
}

// ─── pull_request ────────────────────────────────────────────────────────────

export async function handlePullRequest(payload: WebhookPayload): Promise<void> {
  if (!isTrackedRepository(payload.repository?.full_name)) return;
  const pr = payload.pull_request;
  if (!pr) return;
  const issueId = issueIdFromBranch(pr.head.ref);
  if (!issueId) return;

  // Merge conflict detection + draft PR + not_mergeable — batched into one DB write
  await mutateBlockers(issueId, (blockers) => {
    // Draft PR
    if (pr.draft) {
      const draftBlocker: BlockerReason = {
        type: 'draft_pr',
        summary: 'Pull request is in draft state',
        detectedAt: new Date().toISOString(),
      };
      blockers = blockers.filter((b) => b.type !== 'draft_pr');
      blockers = [...blockers, draftBlocker];
    } else {
      // Covers pr.draft === false and pr.draft === undefined (older payloads)
      blockers = blockers.filter((b) => b.type !== 'draft_pr');
    }

    // Merge state — classify into exactly one mutually-exclusive bucket.
    // Only known states get blockers; unknown/future states are left untouched.
    const KNOWN_CONFLICT_STATES = new Set(['dirty']);
    const KNOWN_NON_BLOCKING_STATES = new Set(['clean', 'unstable']);
    const KNOWN_NOT_MERGEABLE_STATES = new Set(['blocked', 'behind']);

    if (pr.mergeable_state && KNOWN_CONFLICT_STATES.has(pr.mergeable_state)) {
      const mergeConflictBlocker: BlockerReason = {
        type: 'merge_conflict',
        summary: 'Merge conflict with target branch',
        detectedAt: new Date().toISOString(),
      };
      blockers = blockers.filter((b) => b.type !== 'merge_conflict' && b.type !== 'not_mergeable');
      blockers = [...blockers, mergeConflictBlocker];
    } else if (pr.mergeable === false && (pr.mergeable_state === null || pr.mergeable_state === undefined)) {
      // Fallback: mergeable is explicitly false but mergeable_state is unavailable
      const mergeConflictBlocker: BlockerReason = {
        type: 'merge_conflict',
        summary: 'Merge conflict with target branch',
        detectedAt: new Date().toISOString(),
      };
      blockers = blockers.filter((b) => b.type !== 'merge_conflict' && b.type !== 'not_mergeable');
      blockers = [...blockers, mergeConflictBlocker];
    } else if ((pr.mergeable_state && KNOWN_NON_BLOCKING_STATES.has(pr.mergeable_state)) || pr.mergeable === true) {
      blockers = blockers.filter((b) => b.type !== 'merge_conflict' && b.type !== 'not_mergeable');
    } else if (pr.mergeable_state && KNOWN_NOT_MERGEABLE_STATES.has(pr.mergeable_state)) {
      const notMergeableBlocker: BlockerReason = {
        type: 'not_mergeable',
        summary: `PR not mergeable: ${pr.mergeable_state}`,
        detectedAt: new Date().toISOString(),
      };
      blockers = blockers.filter((b) => b.type !== 'merge_conflict' && b.type !== 'not_mergeable');
      blockers = [...blockers, notMergeableBlocker];
    }

    return blockers;
  });
}

// ─── pull_request_review ─────────────────────────────────────────────────────

export async function handlePullRequestReview(payload: WebhookPayload): Promise<void> {
  if (!isTrackedRepository(payload.repository?.full_name)) return;
  const pr = payload.pull_request;
  const review = payload.review;
  if (!pr || !review) return;
  const issueId = issueIdFromBranch(pr.head.ref);
  if (!issueId) return;

  if (review.state === 'changes_requested') {
    await addBlocker(issueId, {
      type: 'changes_requested',
      summary: 'Changes requested on pull request',
      detectedAt: new Date().toISOString(),
    });
  } else if (review.state === 'approved') {
    await removeBlocker(issueId, 'changes_requested');
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

  if (thread.resolved === false) {
    await mutateBlockers(issueId, (blockers) => {
      const existing = blockers.find((b) => b.type === 'unresolved_conversations');
      const threadIds = new Set<string>(JSON.parse(existing?.details ?? '[]') as string[]);
      if (thread.id != null) threadIds.add(String(thread.id));
      const updated: BlockerReason = {
        type: 'unresolved_conversations',
        summary: 'Unresolved review conversation',
        details: JSON.stringify([...threadIds]),
        detectedAt: existing?.detectedAt ?? new Date().toISOString(),
      };
      return [...blockers.filter((b) => b.type !== 'unresolved_conversations'), updated];
    });
  } else if (thread.resolved === true) {
    // Without a thread id we cannot determine which thread was resolved.
    if (thread.id == null) return;
    await mutateBlockers(issueId, (blockers) => {
      const existing = blockers.find((b) => b.type === 'unresolved_conversations');
      if (!existing) return blockers;
      const threadIds = new Set<string>(JSON.parse(existing.details ?? '[]') as string[]);
      threadIds.delete(String(thread.id));
      if (threadIds.size === 0) {
        return blockers.filter((b) => b.type !== 'unresolved_conversations');
      }
      const updated: BlockerReason = {
        type: 'unresolved_conversations',
        summary: 'Unresolved review conversation',
        details: JSON.stringify([...threadIds]),
        detectedAt: existing.detectedAt,
      };
      return [...blockers.filter((b) => b.type !== 'unresolved_conversations'), updated];
    });
  }
}

// ─── status ──────────────────────────────────────────────────────────────────

export async function handleStatus(payload: WebhookPayload): Promise<void> {
  if (!isTrackedRepository(payload.repository?.full_name)) return;
  const state = payload.state;
  const branches = payload.branches;
  if (!state || !branches || branches.length === 0) return;

  // Map commit status to the first matching feature branch
  for (const branch of branches) {
    const issueId = issueIdFromBranch(branch.name);
    if (issueId) {
      if (state === 'failure' || state === 'error') {
        await addBlocker(issueId, {
          type: 'failing_checks',
          summary: `Commit status: ${state}`,
          detectedAt: new Date().toISOString(),
        });
      } else if (state === 'success') {
        await removeBlocker(issueId, 'failing_checks');
      }
      // Only act on the first feature branch match
      break;
    }
  }
}

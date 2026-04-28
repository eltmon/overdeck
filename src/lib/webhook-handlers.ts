/**
 * GitHub webhook event handlers (PAN-905)
 *
 * Dispatches verified webhook events to per-type handlers that update
 * review_status blockerReasons based on GitHub-native merge blockers.
 */

import { setReviewStatus, getReviewStatus, type BlockerReason } from './review-status.js';

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
  thread?: { resolved?: boolean };
  // status event payload
  sha?: string;
  state?: string;
  branches?: Array<{ name: string }>;
}

function issueIdFromBranch(ref: string): string | null {
  const match = ref.match(/feature\/(pan-\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

// ─── Batched blocker mutation (single read + single write per event) ─────────

function mutateBlockers(issueId: string, fn: (blockers: BlockerReason[]) => BlockerReason[]): void {
  const status = getReviewStatus(issueId);
  const blockers = status?.blockerReasons ?? [];
  const updated = fn(blockers);
  setReviewStatus(issueId, { blockerReasons: updated.length > 0 ? updated : undefined });
}

function addBlocker(issueId: string, blocker: BlockerReason): void {
  mutateBlockers(issueId, (blockers) => {
    const filtered = blockers.filter((b: BlockerReason) => b.type !== blocker.type);
    return [...filtered, blocker];
  });
}

function removeBlocker(issueId: string, type: BlockerReason['type']): void {
  mutateBlockers(issueId, (blockers) => blockers.filter((b: BlockerReason) => b.type !== type));
}

// ─── check_suite / check_run ─────────────────────────────────────────────────

export function handleCheckSuite(payload: WebhookPayload): void {
  const suite = payload.check_suite;
  if (!suite) return;
  const pr = suite.pull_requests?.[0];
  if (!pr) return;
  const issueId = issueIdFromBranch(pr.head.ref);
  if (!issueId) return;

  if (suite.conclusion === 'failure') {
    addBlocker(issueId, {
      type: 'failing_checks',
      summary: 'CI check suite failed',
      detectedAt: new Date().toISOString(),
    });
  } else if (suite.conclusion === 'success') {
    removeBlocker(issueId, 'failing_checks');
  }
}

export function handleCheckRun(payload: WebhookPayload): void {
  const run = payload.check_run;
  if (!run) return;
  const pr = run.pull_requests?.[0];
  if (!pr) return;
  const issueId = issueIdFromBranch(pr.head.ref);
  if (!issueId) return;

  if (run.conclusion === 'failure') {
    addBlocker(issueId, {
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

export function handlePullRequest(payload: WebhookPayload): void {
  const pr = payload.pull_request;
  if (!pr) return;
  const issueId = issueIdFromBranch(pr.head.ref);
  if (!issueId) return;

  // Merge conflict detection + draft PR + not_mergeable — batched into one DB write
  mutateBlockers(issueId, (blockers) => {
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

    // Non-mergeable state — only mutate when GitHub has computed a value.
    // When mergeable_state is null/undefined, the payload is incomplete;
    // leave existing blockers untouched to avoid flicker.
    if (pr.mergeable_state !== null && pr.mergeable_state !== undefined) {
      if (pr.mergeable_state !== 'clean' && pr.mergeable_state !== 'unstable' && pr.mergeable_state !== 'dirty' && pr.mergeable_state !== 'unknown') {
        const notMergeableBlocker: BlockerReason = {
          type: 'not_mergeable',
          summary: `PR not mergeable: ${pr.mergeable_state}`,
          detectedAt: new Date().toISOString(),
        };
        blockers = blockers.filter((b) => b.type !== 'not_mergeable');
        blockers = [...blockers, notMergeableBlocker];
      } else {
        blockers = blockers.filter((b) => b.type !== 'not_mergeable');
      }
    }

    // Merge conflict detection — only mutate on definitive values.
    // null = GitHub is recomputing; leave blockers untouched.
    if (pr.mergeable === false || pr.mergeable_state === 'dirty') {
      const mergeConflictBlocker: BlockerReason = {
        type: 'merge_conflict',
        summary: 'Merge conflict with target branch',
        detectedAt: new Date().toISOString(),
      };
      blockers = blockers.filter((b) => b.type !== 'merge_conflict');
      blockers = [...blockers, mergeConflictBlocker];
    } else if (pr.mergeable === true || pr.mergeable_state === 'clean') {
      blockers = blockers.filter((b) => b.type !== 'merge_conflict');
    }

    return blockers;
  });
}

// ─── pull_request_review ─────────────────────────────────────────────────────

export function handlePullRequestReview(payload: WebhookPayload): void {
  const pr = payload.pull_request;
  const review = payload.review;
  if (!pr || !review) return;
  const issueId = issueIdFromBranch(pr.head.ref);
  if (!issueId) return;

  if (review.state === 'changes_requested') {
    addBlocker(issueId, {
      type: 'changes_requested',
      summary: 'Changes requested on pull request',
      detectedAt: new Date().toISOString(),
    });
  } else if (review.state === 'approved') {
    removeBlocker(issueId, 'changes_requested');
  }
}

// ─── pull_request_review_thread ──────────────────────────────────────────────

export function handlePullRequestReviewThread(payload: WebhookPayload): void {
  const pr = payload.pull_request;
  const thread = payload.thread;
  if (!pr || !thread) return;
  const issueId = issueIdFromBranch(pr.head.ref);
  if (!issueId) return;

  if (thread.resolved === false) {
    addBlocker(issueId, {
      type: 'unresolved_conversations',
      summary: 'Unresolved review conversation',
      detectedAt: new Date().toISOString(),
    });
  } else if (thread.resolved === true) {
    removeBlocker(issueId, 'unresolved_conversations');
  }
}

// ─── status ──────────────────────────────────────────────────────────────────

export function handleStatus(payload: WebhookPayload): void {
  const state = payload.state;
  const branches = payload.branches;
  if (!state || !branches || branches.length === 0) return;

  // Map commit status to the first matching feature branch
  for (const branch of branches) {
    const issueId = issueIdFromBranch(branch.name);
    if (!issueId) continue;

    if (state === 'failure' || state === 'error') {
      addBlocker(issueId, {
        type: 'failing_checks',
        summary: `Commit status: ${state}`,
        detectedAt: new Date().toISOString(),
      });
    } else if (state === 'success') {
      removeBlocker(issueId, 'failing_checks');
    }
    // Only act on the first feature branch match
    break;
  }
}

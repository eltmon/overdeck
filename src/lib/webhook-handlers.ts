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
}

function issueIdFromBranch(ref: string): string | null {
  const match = ref.match(/feature\/(pan-\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

function addBlocker(issueId: string, blocker: BlockerReason): void {
  const status = getReviewStatus(issueId);
  const existing = status?.blockerReasons ?? [];
  const filtered = existing.filter((b: BlockerReason) => b.type !== blocker.type);
  setReviewStatus(issueId, { blockerReasons: [...filtered, blocker] });
}

function removeBlocker(issueId: string, type: BlockerReason['type']): void {
  const status = getReviewStatus(issueId);
  const existing = status?.blockerReasons ?? [];
  const filtered = existing.filter((b: BlockerReason) => b.type !== type);
  setReviewStatus(issueId, { blockerReasons: filtered.length > 0 ? filtered : undefined });
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
  } else if (run.conclusion === 'success') {
    // Only remove if there are no other failing checks — simplified: always try remove
    removeBlocker(issueId, 'failing_checks');
  }
}

// ─── pull_request ────────────────────────────────────────────────────────────

export function handlePullRequest(payload: WebhookPayload): void {
  const pr = payload.pull_request;
  if (!pr) return;
  const issueId = issueIdFromBranch(pr.head.ref);
  if (!issueId) return;

  const action = payload.action;

  // Merge conflict detection
  if (pr.mergeable === false || pr.mergeable_state === 'dirty') {
    addBlocker(issueId, {
      type: 'merge_conflict',
      summary: 'Merge conflict with target branch',
      detectedAt: new Date().toISOString(),
    });
  } else if (pr.mergeable === true) {
    removeBlocker(issueId, 'merge_conflict');
  }

  // Draft PR detection
  if (pr.draft) {
    addBlocker(issueId, {
      type: 'draft_pr',
      summary: 'Pull request is in draft state',
      detectedAt: new Date().toISOString(),
    });
  } else if (!pr.draft) {
    removeBlocker(issueId, 'draft_pr');
  }

  // Non-mergeable state
  if (pr.mergeable_state) {
    if (pr.mergeable_state !== 'clean' && pr.mergeable_state !== 'unstable' && pr.mergeable_state !== 'dirty' && pr.mergeable_state !== 'unknown') {
      addBlocker(issueId, {
        type: 'not_mergeable',
        summary: `PR not mergeable: ${pr.mergeable_state}`,
        detectedAt: new Date().toISOString(),
      });
    } else {
      removeBlocker(issueId, 'not_mergeable');
    }
  }

  // Merge conflict detection — also clear when mergeable_state is clean
  if (pr.mergeable === false || pr.mergeable_state === 'dirty') {
    addBlocker(issueId, {
      type: 'merge_conflict',
      summary: 'Merge conflict with target branch',
      detectedAt: new Date().toISOString(),
    });
  } else if (pr.mergeable === true || pr.mergeable_state === 'clean') {
    removeBlocker(issueId, 'merge_conflict');
  }
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

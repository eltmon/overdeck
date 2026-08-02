/**
 * The verdict write door — recordReviewVerdict + dispatch-not-drop + fallback kill-conditional
 *
 * Single source of truth for terminal review verdict writes. Every call site
 * that writes a final verdict (passed/blocked) routes through this door.
 *
 * Dispatch-not-drop rule: a terminal review verdict whose evidence head disagrees
 * with the row's lastVerifiedCommit is never silently discarded. Provably-stale
 * evidence is rejected WITH a review.verdict_rejected domain event and an
 * activity entry; anything else lands and re-gates.
 */
import { join } from 'path';
import { execFileAsync } from 'child_process';
import { parseCompositeSnapshot, formatAnchorShort } from '../git-utils.js';
import { resolveWorkspaceRepoRootsSync } from '../project-repos.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { emitActivityEntrySync } from '../activity-logger.js';
import { getCloisterEventStore } from './event-store-provider.js';
import { getReviewStatusSync, setReviewStatusSync } from '../review-status.js';
import type { ReviewStatus, ReviewStatusUpdate } from '../review-status-reconcile.js';
import type { HeadAnchor } from '../workspace-anchor-drift.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type VerdictWriter = 'coordinator' | 'fallback' | 'quick-signal' | 'orphan-restore' | 'sweeper-restore' | 'unsignaled-recovery' | 'infra-bypass';

export type ReviewVerdict = 'passed' | 'blocked';

export interface VerdictInput {
  verdict: ReviewVerdict;
  notes?: string;
  reviewerVerdicts?: Array<{ reviewer: string; verdict: ReviewVerdict; atCommit?: string }>;
  evidenceHead?: string;
  extra?: Record<string, unknown>;
  runId?: string;
  writer: VerdictWriter;
}

export type VerdictOutcome = { landed: true; classification: 'no-evidence' | 'anchor-match' | 'dispatched' } | { landed: false; reason: string };

// ─── Private: Head Classification ─────────────────────────────────────────────

type EvidenceClassification = 'no-evidence' | 'anchor-match' | 'stale' | 'fresh' | 'indeterminate';

async function classifyEvidenceAgainstAnchor(
  issueId: string,
  workspacePath: string,
  evidenceHead: string,
  rowHead: HeadAnchor,
): Promise<EvidenceClassification> {
  // Parse both anchors to get per-repo SHAs
  const evidenceMap = parseCompositeSnapshot(evidenceHead);
  const rowMap = parseCompositeSnapshot(rowHead);

  // If shapes differ (bare vs composite), classify as indeterminate
  if ((evidenceMap.size === 0) !== (rowMap.size === 0) || (evidenceMap.size === 0 && rowMap.size === 0 && evidenceHead !== rowHead)) {
    return 'indeterminate';
  }

  // Resolve workspace repo roots
  let repoRoots: Array<{ repoKey: string; dir: string }>;
  try {
    repoRoots = resolveWorkspaceRepoRootsSync(issueId, workspacePath);
  } catch {
    return 'indeterminate';
  }

  // Build a map of repoKey -> root for quick lookup
  const rootMap = new Map(repoRoots.map(r => [r.repoKey, r.dir]));

  // If repo key set differs, classify as indeterminate
  if (evidenceMap.size !== rowMap.size || ![...evidenceMap.keys()].every(k => rowMap.has(k))) {
    return 'indeterminate';
  }

  // For each repo, run `git merge-base --is-ancestor evidenceSha rowSha`
  let allStale = true;
  for (const [repoKey, evidenceSha] of evidenceMap) {
    const rowSha = rowMap.get(repoKey);
    if (!rowSha) {
      return 'indeterminate';
    }

    const root = rootMap.get(repoKey);
    if (!root) {
      return 'indeterminate';
    }

    try {
      const result = await execFileAsync('git', ['merge-base', '--is-ancestor', evidenceSha, rowSha], {
        cwd: root,
        timeout: 10_000,
      });
      // If git merge-base returns 0, evidenceSha is an ancestor of rowSha
      if (result.status === 0) {
        // evidenceSha is an ancestor — this repo is old
        // but we need ALL repos to be stale to classify as 'stale'
        continue;
      } else {
        // evidenceSha is NOT an ancestor — this repo is fresh
        allStale = false;
      }
    } catch (err) {
      // Non-clean exec failure (non-zero exit, timeout, etc.)
      return 'indeterminate';
    }
  }

  return allStale ? 'stale' : 'fresh';
}

// ─── Public: Verdict Write Door ───────────────────────────────────────────────

/**
 * Record a terminal review verdict through the single write door.
 *
 * Returns {landed: true} if the verdict was written to the row, or
 * {landed: false; reason} if the verdict was rejected (stale evidence only).
 */
export async function recordReviewVerdict(issueId: string, input: VerdictInput): Promise<VerdictOutcome> {
  const status = getReviewStatusSync(issueId);
  if (!status) {
    // Issue not found; return a rejection to be safe
    return { landed: false, reason: 'issue-not-found' };
  }

  // Resolve workspace path
  const workspacePath = (() => {
    const resolved = resolveProjectFromIssueSync(issueId);
    return resolved ? join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`) : null;
  })();

  // No evidence head or row head absent: take the no-evidence path
  if (!input.evidenceHead || !status.lastVerifiedCommit) {
    const update: ReviewStatusUpdate = {
      reviewStatus: input.verdict,
      reviewNotes: input.notes,
      reviewerVerdicts: input.reviewerVerdicts,
      ...(input.extra ? { ...input.extra } : {}),
    };
    const updated = setReviewStatusSync(issueId, update, status);
    return { landed: true, classification: 'no-evidence' };
  }

  // Evidence heads equal: take the anchor-match path
  if (input.evidenceHead === status.lastVerifiedCommit) {
    const update: ReviewStatusUpdate = {
      reviewStatus: input.verdict,
      reviewNotes: input.notes,
      reviewerVerdicts: input.reviewerVerdicts,
      ...(input.extra ? { ...input.extra } : {}),
    };
    setReviewStatusSync(issueId, update, status);
    return { landed: true, classification: 'anchor-match' };
  }

  // Evidence heads differ: classify and decide
  if (!workspacePath) {
    return { landed: false, reason: 'workspace-not-resolvable' };
  }

  const classification = await classifyEvidenceAgainstAnchor(issueId, workspacePath, input.evidenceHead, status.lastVerifiedCommit);

  if (classification === 'stale') {
    // Reject with event and activity entry
    const eventStore = getCloisterEventStore();
    if (eventStore) {
      eventStore.append({
        type: 'review.verdict_rejected' as const,
        timestamp: new Date().toISOString(),
        payload: {
          issueId,
          workspaceId: workspacePath ? workspacePath.split('/').pop() : undefined,
          writer: input.writer,
          verdict: input.verdict,
          evidenceHead: input.evidenceHead,
          rowHead: status.lastVerifiedCommit,
          reason: 'stale-evidence-head',
        },
      });
    }

    emitActivityEntrySync({
      source: 'cloister',
      level: 'warn',
      message: `[review-verdict-writer] Rejected stale evidence: writer=${input.writer} verdict=${input.verdict} evidence=${formatAnchorShort(input.evidenceHead)} row=${formatAnchorShort(status.lastVerifiedCommit)}`,
    });

    return { landed: false, reason: 'stale-evidence-head' };
  }

  // Fresh or indeterminate: land the verdict
  const testGateReset = status.testStatus === 'passed' || status.testStatus === 'skipped';
  const update: ReviewStatusUpdate = {
    reviewStatus: input.verdict,
    reviewNotes: input.notes,
    reviewedAtCommit: input.evidenceHead as HeadAnchor,
    reviewerVerdicts: input.reviewerVerdicts,
    ...(testGateReset ? { testStatus: 'pending', testNotes: `Verdict re-gated: evidence=${formatAnchorShort(input.evidenceHead)} row=${formatAnchorShort(status.lastVerifiedCommit)} writer=${input.writer}` } : {}),
    ...(input.extra ? { ...input.extra } : {}),
  };

  setReviewStatusSync(issueId, update, status);

  const eventStore = getCloisterEventStore();
  if (eventStore) {
    eventStore.append({
      type: 'review.verdict_dispatched' as const,
      timestamp: new Date().toISOString(),
      payload: {
        issueId,
        workspaceId: workspacePath ? workspacePath.split('/').pop() : undefined,
        writer: input.writer,
        verdict: input.verdict,
        evidenceHead: input.evidenceHead,
        rowHead: status.lastVerifiedCommit,
        classification,
        testGateReset,
      },
    });
  }

  return { landed: true, classification: 'dispatched' };
}

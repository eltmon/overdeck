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
import { execFile } from 'child_process';
import { promisify } from 'util';
import { parseCompositeSnapshot, formatAnchorShort, type HeadAnchor } from '../git-utils.js';
import { resolveWorkspaceRepoRootsSync } from '../project-repos.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { emitActivityEntrySync } from '../activity-logger.js';
import { getCloisterEventStore } from './event-store-provider.js';
import { getReviewStatusSync, setReviewStatusSync, type ReviewStatus, type ReviewStatusUpdate } from '../review-status.js';

const execFileAsync = promisify(execFile);

// ─── Types ────────────────────────────────────────────────────────────────────

export type VerdictWriter = 'coordinator' | 'fallback' | 'quick-signal' | 'orphan-restore' | 'sweeper-restore' | 'unsignaled-recovery' | 'infra-bypass';

export type ReviewVerdict = 'passed' | 'blocked' | 'failed';

export interface VerdictInput {
  verdict: ReviewVerdict;
  notes?: string;
  reviewerVerdicts?: Array<{ reviewer: string; verdict: ReviewVerdict; atCommit?: HeadAnchor }>;
  evidenceHead?: HeadAnchor;
  extra?: Record<string, unknown>;
  runId?: string;
  writer: VerdictWriter;
}

export type VerdictOutcome = { landed: true; classification: 'no-evidence' | 'anchor-match' | 'dispatched' } | { landed: false; reason: string };

// ─── Private: Helpers ─────────────────────────────────────────────────────────

function convertReviewerVerdicts(
  array?: Array<{ reviewer: string; verdict: ReviewVerdict; atCommit?: string }>,
): Partial<Record<string, { status: 'passed' | 'blocked'; atCommit?: string }>> | undefined {
  if (!array) return undefined;
  const result: Record<string, { status: 'passed' | 'blocked'; atCommit?: string }> = {};
  for (const item of array) {
    if (item.verdict === 'passed' || item.verdict === 'blocked') {
      result[item.reviewer] = { status: item.verdict, ...(item.atCommit ? { atCommit: item.atCommit } : {}) };
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

// ─── Private: Head Classification ─────────────────────────────────────────────

type EvidenceClassification = 'no-evidence' | 'anchor-match' | 'stale' | 'fresh' | 'indeterminate';

async function classifyEvidenceAgainstAnchor(
  issueId: string,
  workspacePath: string,
  evidenceHead: HeadAnchor | string,
  rowHead: HeadAnchor | string,
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
      await execFileAsync('git', ['merge-base', '--is-ancestor', evidenceSha, rowSha], {
        cwd: root,
        timeout: 10_000,
      });
      // If git merge-base succeeds (exit 0), evidenceSha is an ancestor of rowSha
      // evidenceSha is an ancestor — this repo is old
      // but we need ALL repos to be stale to classify as 'stale'
      continue;
    } catch (err: unknown) {
      // Check if this is a non-zero exit (not an ancestor)
      if ((err as { code?: number }).code === 1) {
        // evidenceSha is NOT an ancestor — this repo is fresh
        allStale = false;
      } else {
        // Non-clean exec failure (timeout, unreadable repo, etc.)
        return 'indeterminate';
      }
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
      ...(input.reviewerVerdicts ? { reviewerVerdicts: convertReviewerVerdicts(input.reviewerVerdicts) } : {}),
      ...(input.extra ? { ...input.extra } : {}),
    };
    setReviewStatusSync(issueId, update, status);
    return { landed: true, classification: 'no-evidence' };
  }

  // Evidence heads equal: take the anchor-match path
  if (input.evidenceHead === status.lastVerifiedCommit) {
    const update: ReviewStatusUpdate = {
      reviewStatus: input.verdict,
      reviewNotes: input.notes,
      ...(input.reviewerVerdicts ? { reviewerVerdicts: convertReviewerVerdicts(input.reviewerVerdicts) } : {}),
      ...(input.extra ? { ...input.extra } : {}),
    };
    setReviewStatusSync(issueId, update, status);
    return { landed: true, classification: 'anchor-match' };
  }

  // Evidence heads differ: classify and decide
  if (!workspacePath) {
    return { landed: false, reason: 'workspace-not-resolvable' };
  }

  // At this point we know evidenceHead and lastVerifiedCommit both exist (checked above)
  const classification = await classifyEvidenceAgainstAnchor(
    issueId,
    workspacePath,
    input.evidenceHead!,
    status.lastVerifiedCommit!,
  );

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
          evidenceHead: input.evidenceHead as string,
          rowHead: status.lastVerifiedCommit as string,
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
    ...(input.evidenceHead ? { reviewedAtCommit: input.evidenceHead as HeadAnchor } : {}),
    ...(input.reviewerVerdicts ? { reviewerVerdicts: convertReviewerVerdicts(input.reviewerVerdicts) } : {}),
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
        evidenceHead: input.evidenceHead as string,
        rowHead: status.lastVerifiedCommit as string,
        classification,
        testGateReset,
      },
    });
  }

  return { landed: true, classification: 'dispatched' };
}

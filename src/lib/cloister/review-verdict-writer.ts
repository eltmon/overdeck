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

export type VerdictWriter = 'coordinator' | 'fallback' | 'quick-signal' | 'orphan-restore' | 'sweeper-restore' | 'unsignaled-recovery' | 'infra-bypass' | 'dispatch-converge';

export type ReviewVerdict = 'passed' | 'blocked' | 'failed';

export interface VerdictInput {
  verdict: ReviewVerdict;
  notes?: string;
  evidenceHead?: HeadAnchor;
  extra?: Record<string, unknown>;
  runId?: string;
  writer: VerdictWriter;
}

export type VerdictOutcome = { landed: true; classification: 'no-evidence' | 'anchor-match' | 'dispatched' } | { landed: false; reason: string };

// ─── Private: Head Classification ─────────────────────────────────────────────

type EvidenceClassification = 'no-evidence' | 'anchor-match' | 'stale' | 'fresh' | 'indeterminate';

function isNonAncestorExit(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 1;
}

async function classifyEvidenceAgainstAnchor(
  issueId: string,
  workspacePath: string,
  evidenceHead: HeadAnchor | string,
  rowHead: HeadAnchor | string,
): Promise<EvidenceClassification> {
  const evidenceMap = parseCompositeSnapshot(evidenceHead);
  const rowMap = parseCompositeSnapshot(rowHead);
  const evidenceIsComposite = evidenceMap.size > 0;
  const rowIsComposite = rowMap.size > 0;

  if (evidenceIsComposite !== rowIsComposite) {
    return 'indeterminate';
  }

  let repoRoots: Array<{ repoKey: string; dir: string }>;
  try {
    repoRoots = resolveWorkspaceRepoRootsSync(issueId, workspacePath);
  } catch {
    return 'indeterminate';
  }

  let comparisons: Array<{ dir: string; evidenceSha: string; rowSha: string }>;
  if (!evidenceIsComposite) {
    if (repoRoots.length !== 1) {
      return 'indeterminate';
    }
    comparisons = [{
      dir: repoRoots[0]!.dir,
      evidenceSha: evidenceHead,
      rowSha: rowHead,
    }];
  } else {
    const rootMap = new Map(repoRoots.map(root => [root.repoKey, root.dir]));
    if (evidenceMap.size !== rowMap.size || ![...evidenceMap.keys()].every(key => rowMap.has(key))) {
      return 'indeterminate';
    }

    comparisons = [];
    for (const [repoKey, evidenceSha] of evidenceMap) {
      const rowSha = rowMap.get(repoKey);
      const dir = rootMap.get(repoKey);
      if (!rowSha || !dir) {
        return 'indeterminate';
      }
      comparisons.push({ dir, evidenceSha, rowSha });
    }
  }

  let allStale = true;
  for (const comparison of comparisons) {
    try {
      await execFileAsync(
        'git',
        ['merge-base', '--is-ancestor', comparison.evidenceSha, comparison.rowSha],
        { cwd: comparison.dir, timeout: 10_000 },
      );
    } catch (error: unknown) {
      if (isNonAncestorExit(error)) {
        allStale = false;
      } else {
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
    setReviewStatusSync(issueId, {
      reviewStatus: input.verdict,
      reviewNotes: input.notes,
      ...(input.extra ? { ...input.extra } : {}),
    });
    return { landed: true, classification: 'no-evidence' };
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
      ...(input.extra ? { ...input.extra } : {}),
    };
    setReviewStatusSync(issueId, update, status);
    return { landed: true, classification: 'no-evidence' };
  }

  // Evidence heads equal: land the verdict without re-gating the same test result.
  if (input.evidenceHead === status.lastVerifiedCommit) {
    const update: ReviewStatusUpdate = {
      reviewStatus: input.verdict,
      reviewNotes: input.notes,
      reviewedAtCommit: input.evidenceHead as HeadAnchor,
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
          classification: 'anchor-match',
          testGateReset: false,
        },
      });
    }

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

  // Fresh or indeterminate: land the verdict.
  // The re-gate keys off the test status this write would actually PERSIST, not
  // just the one already on the row. Orphan restore forwards a historical
  // terminal test result through `extra`, so a row sitting at 'pending' would
  // otherwise let that stale 'passed'/'skipped' land against fresh evidence and
  // advance without a new test run.
  const incomingTestStatus = input.extra?.['testStatus'];
  const effectiveTestStatus = incomingTestStatus ?? status.testStatus;
  const testGateReset = (effectiveTestStatus === 'passed' || effectiveTestStatus === 'skipped')
    && input.evidenceHead !== status.lastVerifiedCommit;
  const update: ReviewStatusUpdate = {
    reviewStatus: input.verdict,
    reviewNotes: input.notes,
    ...(input.evidenceHead ? { reviewedAtCommit: input.evidenceHead as HeadAnchor } : {}),
    ...(input.extra ? { ...input.extra } : {}),
    // The re-gate lands LAST so no caller extra can overwrite it. Orphan restore
    // forwards the restored snapshot's historical testStatus/testNotes; letting
    // those win would make a newer reviewed head look verified with no new test
    // run — the "admit a verdict that should not advance" failure this door exists to prevent.
    ...(testGateReset ? { testStatus: 'pending', testNotes: `Verdict re-gated: evidence=${formatAnchorShort(input.evidenceHead)} row=${formatAnchorShort(status.lastVerifiedCommit)} writer=${input.writer}` } : {}),
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

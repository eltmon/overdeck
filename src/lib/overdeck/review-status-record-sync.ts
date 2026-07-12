import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ReviewStatus } from '../review-status.js';
import { updateIssueRecordForIssue, type PanIssuePipelineRecord } from '../pan-dir/records.js';
import { readIssueRecordSync } from '../pan-dir/record.js';
import { resolveProjectFromIssueSync, getProjectSync } from '../projects.js';

export function updateIssueRecordForReviewStatusSync(issueId: string, status: ReviewStatus): void {
  // PAN-2583: the state-dir journal is the durable home, but a sandboxed reviewer
  // (codex workspace-write) cannot write ${OVERDECK_HOME}/state — and swallowing that
  // failure here is how blocked review verdicts silently vanished for hours. When the
  // journal write does not land, drop the durable verdict into the workspace runtime
  // dir (the one place a sandboxed agent can always write); readJournalStatusSync
  // overlays it on the next host-side read.
  void Promise.resolve(updateIssueRecordForIssue(issueId, status))
    .then((landed) => {
      // Only an explicit `false` means the durable write failed — undefined
      // (e.g. a test double) is "unknown", not "failed".
      if (landed === false) writeWorkspaceVerdictFallbackSync(issueId, status);
    })
    .catch(() => writeWorkspaceVerdictFallbackSync(issueId, status));
}

/** Resolve and read the per-issue journal record's pipeline block, or null. Best-effort. */
function readPipelineSync(issueId: string): PanIssuePipelineRecord | null {
  try {
    const resolved = resolveProjectFromIssueSync(issueId);
    if (!resolved) return null;
    const project = getProjectSync(resolved.projectKey);
    if (!project) return null;
    const record = readIssueRecordSync(project, issueId);
    return record?.pipeline ?? null;
  } catch {
    return null;
  }
}

/**
 * PAN-1988: feedback TEXT (review / test / merge / inspect / verification notes) is durable
 * JOURNAL state, not DB-cache state. The SQLite row holds only the queryable status flags;
 * the human-readable notes live in the per-issue git record (`<workspace>/.pan/records/<issue>.json`,
 * PAN-1908). This overlays those notes onto a DB-sourced status so every reader (deacon
 * CI-failure detection, dashboard panels) stays transparent while the DB stops storing them.
 */
export function enrichReviewNotesFromRecordSync(issueId: string, status: ReviewStatus): ReviewStatus {
  const pipeline = readPipelineSync(issueId);
  if (!pipeline) return status;
  return {
    ...status,
    reviewNotes: pipeline.reviewNotes ?? status.reviewNotes,
    testNotes: pipeline.testNotes ?? status.testNotes,
    mergeNotes: pipeline.mergeNotes ?? status.mergeNotes,
    inspectNotes: pipeline.inspectNotes ?? status.inspectNotes,
    verificationNotes: pipeline.verificationNotes ?? status.verificationNotes,
    scopeDrift: pipeline.scopeDrift ?? status.scopeDrift,
    // PAN-1988 auto-heal: the durable review-request intent is journal-only — overlay it on every
    // read so the merge base preserves it through partial updates and the dispatch reconcile sees it.
    reviewRequestedAt: pipeline.reviewRequestedAt ?? status.reviewRequestedAt,
  };
}

type DurableStatusFields = Partial<ReviewStatus> & { closedOut?: boolean; closedOutAt?: string };

/**
 * The durable field subset shared by the journal record's pipeline block and the
 * workspace verdict fallback (PAN-2583). Derived/live columns (readyForMerge,
 * blockerReasons) are intentionally omitted — the reader recomputes them.
 */
function durableSubset(p: PanIssuePipelineRecord): DurableStatusFields {
  return {
    reviewStatus: p.reviewStatus as ReviewStatus['reviewStatus'],
    testStatus: p.testStatus as ReviewStatus['testStatus'],
    mergeStatus: (p.mergeStatus as ReviewStatus['mergeStatus']) ?? undefined,
    inspectStatus: (p.inspectStatus as ReviewStatus['inspectStatus']) ?? undefined,
    verificationStatus: (p.verificationStatus as ReviewStatus['verificationStatus']) ?? undefined,
    reviewNotes: p.reviewNotes,
    testNotes: p.testNotes,
    mergeNotes: p.mergeNotes,
    inspectNotes: p.inspectNotes,
    verificationNotes: p.verificationNotes,
    scopeDrift: p.scopeDrift,
    prUrl: p.prUrl,
    prNumber: p.prNumber,
    prHeadSha: p.prHeadSha,
    reviewedAtCommit: p.reviewedAtCommit,
    lastVerifiedCommit: p.lastVerifiedCommit,
    reviewRequestedAt: p.reviewRequestedAt,
    reviewSpawnedAt: p.reviewSpawnedAt,
    reviewerVerdicts: p.reviewerVerdicts as ReviewStatus['reviewerVerdicts'],
    autoMerge: p.autoMerge,
    deaconIgnored: p.deaconIgnored,
    deaconIgnoredAt: p.deaconIgnoredAt,
    deaconIgnoredReason: p.deaconIgnoredReason,
    closedOut: p.closedOut,
    closedOutAt: p.closedOutAt,
  };
}

/**
 * PAN-2583: sandbox-writable emergency drop for a verdict whose state-dir journal
 * write failed. Lives in the workspace runtime dir (gitignored), swept by
 * readJournalStatusSync on the next host-side read.
 */
interface WorkspaceVerdictFallback {
  issueId: string;
  updatedAt: string;
  pipeline: DurableStatusFields;
}

export function workspaceVerdictFallbackPath(issueId: string): string | null {
  try {
    const resolved = resolveProjectFromIssueSync(issueId);
    if (!resolved) return null;
    return join(
      resolved.projectPath,
      'workspaces',
      `feature-${issueId.toLowerCase()}`,
      '.overdeck',
      'pipeline-verdict.json',
    );
  } catch {
    return null;
  }
}

function writeWorkspaceVerdictFallbackSync(issueId: string, status: ReviewStatus): void {
  try {
    const path = workspaceVerdictFallbackPath(issueId);
    if (!path) {
      console.error(
        `[review-status] PAN-2583: journal write failed for ${issueId} and no workspace could be resolved — the verdict is NOT durable`,
      );
      return;
    }
    mkdirSync(dirname(path), { recursive: true });
    const payload: WorkspaceVerdictFallback = {
      issueId: issueId.toUpperCase(),
      updatedAt: status.updatedAt ?? new Date().toISOString(),
      pipeline: durableSubset(status as unknown as PanIssuePipelineRecord),
    };
    writeFileSync(path, JSON.stringify(payload, null, 2));
    console.warn(
      `[review-status] journal write failed for ${issueId} — durable verdict written to workspace fallback ${path}; the host sweeps it on the next status read (PAN-2583)`,
    );
  } catch (err) {
    console.error(
      `[review-status] PAN-2583: could not persist verdict for ${issueId} anywhere durable: ${(err as Error).message}`,
    );
  }
}

function readWorkspaceVerdictFallbackSync(issueId: string): WorkspaceVerdictFallback | null {
  try {
    const path = workspaceVerdictFallbackPath(issueId);
    if (!path || !existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as WorkspaceVerdictFallback;
    if (!parsed?.updatedAt || !parsed.pipeline) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * PAN-1988: read the journal record's durable verdict for an issue — the SOURCE OF TRUTH.
 * Returns the record `updatedAt` (used to decide whether the journal is newer than the DB
 * cache) plus the durable status fields (flags + feedback notes). Derived/live columns
 * (readyForMerge, blockerReasons) are intentionally omitted — the reader recomputes them.
 *
 * This is what makes verdict writes host-owned: a sandboxed agent can always write the journal
 * (workspace-local) even when it cannot write `~/.overdeck/overdeck.db`. The host reconciles
 * the cache from this on read, so no agent has to escalate out of its sandbox to record a verdict.
 *
 * PAN-2583: since the records migration (PAN-2541) the journal itself lives in
 * ${OVERDECK_HOME}/state, which a sandboxed reviewer cannot write either. When such a
 * writer dropped its verdict into the workspace fallback instead, overlay it here —
 * a strictly newer fallback wins over the record, and the host's own next journal
 * write folds it back into the canonical record.
 */
export function readJournalStatusSync(
  issueId: string,
): { updatedAt: string; durable: DurableStatusFields } | null {
  const p = readPipelineSync(issueId);
  const fallback = readWorkspaceVerdictFallbackSync(issueId);
  const fallbackNewer = !!fallback && (!p || (p.updatedAt ?? '') < fallback.updatedAt);
  if (fallback && fallbackNewer) {
    const base = p ? durableSubset(p) : {};
    const overlay = Object.fromEntries(
      Object.entries(fallback.pipeline).filter(([, value]) => value !== undefined),
    ) as DurableStatusFields;
    return { updatedAt: fallback.updatedAt, durable: { ...base, ...overlay } };
  }
  if (!p) return null;
  return { updatedAt: p.updatedAt, durable: durableSubset(p) };
}

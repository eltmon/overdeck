/**
 * PAN-1922: reconstruct the SQLite review_status cache from the durable
 * per-issue git record (PAN-1908) plus a live GitHub re-derivation of
 * PR-owned merge-state.
 *
 * This is the inverse arrow of the PAN-1908 mirror: the mirror writes durable
 * verdicts into the record on every status write; this module reads them back
 * when the cache needs to be rebuilt.
 */

import {
  getProjectSync,
  loadProjectsConfigSync,
  resolveProjectFromIssueSync,
  type ProjectConfig,
} from '../projects.js';
import { setReviewStatusSync, type ReviewStatus } from '../review-status.js';
import { collectInFlightIssueIds } from './records-backfill.js';
import { readIssueRecord, type PanIssuePipelineRecord } from './records.js';

export interface RestoreVerdictsOptions {
  /** If provided, only restore this issue. */
  issueId?: string;
  /** Show what would be restored without writing. */
  dryRun?: boolean;
  /** Log each processed issue. */
  verbose?: boolean;
}

export interface RestoreVerdictsResult {
  restored: number;
  skipped: number;
  failed: number;
  details: Array<{ issueId: string; action: 'restored' | 'skipped' | 'failed'; reason?: string }>;
}

function parseRepoFromPrUrl(prUrl: string): string | null {
  const m = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/i);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

/**
 * Map only the durable verdict columns from a per-issue record pipeline block
 * to a Partial<ReviewStatus> update. Derived/live columns (blockerReasons,
 * readyForMerge) are intentionally omitted.
 */
function pipelineToDurableUpdate(pipeline: PanIssuePipelineRecord): Partial<ReviewStatus> {
  return {
    reviewStatus: pipeline.reviewStatus as ReviewStatus['reviewStatus'],
    testStatus: pipeline.testStatus as ReviewStatus['testStatus'],
    mergeStatus: pipeline.mergeStatus as ReviewStatus['mergeStatus'] ?? undefined,
    inspectStatus: pipeline.inspectStatus as ReviewStatus['inspectStatus'] ?? undefined,
    inspectNotes: pipeline.inspectNotes,
    verificationStatus: pipeline.verificationStatus as ReviewStatus['verificationStatus'] ?? undefined,
    verificationNotes: pipeline.verificationNotes,
    reviewNotes: pipeline.reviewNotes,
    testNotes: pipeline.testNotes,
    mergeNotes: pipeline.mergeNotes,
    prUrl: pipeline.prUrl,
    prNumber: pipeline.prNumber,
    prHeadSha: pipeline.prHeadSha,
    reviewedAtCommit: pipeline.reviewedAtCommit,
    lastVerifiedCommit: pipeline.lastVerifiedCommit,
    autoMerge: pipeline.autoMerge,
    deaconIgnored: pipeline.deaconIgnored,
    deaconIgnoredAt: pipeline.deaconIgnoredAt,
    deaconIgnoredReason: pipeline.deaconIgnoredReason,
  };
}

async function restoreOneIssue(
  issueId: string,
  options: RestoreVerdictsOptions,
): Promise<{ action: 'restored' | 'skipped' | 'failed'; reason?: string }> {
  const normalizedId = issueId.toUpperCase();

  const resolved = resolveProjectFromIssueSync(normalizedId);
  if (!resolved) {
    return { action: 'failed', reason: 'could not resolve project' };
  }

  const project = getProjectSync(resolved.projectKey);
  if (!project) {
    return { action: 'failed', reason: 'project not found' };
  }

  const record = await readIssueRecord(project, normalizedId);
  if (!record || !record.pipeline) {
    return { action: 'skipped', reason: 'no record' };
  }

  const update = pipelineToDurableUpdate(record.pipeline);

  if (options.dryRun) {
    return { action: 'restored' };
  }

  // Write through the normal setReviewStatusSync path on purpose: it recomputes
  // ready_for_merge (PAN-1650 gate + PAN-905 blocker override), re-fires the
  // harmless idempotent PAN-1908 mirror, and seeds ephemeral counters at their
  // schema defaults via the upsert.
  setReviewStatusSync(normalizedId, update);

  // Re-derive PR-owned merge-state live for issues with a tracked PR. This is
  // intentionally done AFTER the durable write so the refreshed blocker set is
  // applied to the newly-restored row.
  if (!options.dryRun && update.prUrl && update.prNumber != null) {
    const repo = parseRepoFromPrUrl(update.prUrl);
    if (repo) {
      try {
        const { refreshMergeStateFromGitHub } = await import('../webhook-handlers.js');
        await refreshMergeStateFromGitHub(normalizedId, repo, update.prNumber);
      } catch (err) {
        console.warn(
          `[verdict-restore] GitHub merge-state refresh failed for ${normalizedId}: ${(err as Error).message}`,
        );
      }
    }
  }

  return { action: 'restored' };
}

/**
 * Rebuild durable review_status rows from the per-issue git record.
 *
 * When no issueId is given, every in-flight issue (agent row, review_status
 * row, or continue file) is processed, matching the scope of the PAN-1908
 * backfill command.
 */
export async function restoreReviewStatusFromRecords(
  options: RestoreVerdictsOptions = {},
): Promise<RestoreVerdictsResult> {
  const config = loadProjectsConfigSync();
  const projects = Object.entries(config.projects).map(([key, p]) => ({ ...p, key }));

  let issueIds: Set<string>;
  if (options.issueId) {
    issueIds = new Set([options.issueId.toUpperCase()]);
  } else {
    issueIds = await collectInFlightIssueIds(projects);
  }

  const result: RestoreVerdictsResult = {
    restored: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };

  for (const issueId of issueIds) {
    if (options.verbose) {
      console.log(`[verdict-restore] ${issueId} ...`);
    }

    const outcome = await restoreOneIssue(issueId, options);
    result.details.push({ issueId, ...outcome });

    if (outcome.action === 'restored') result.restored++;
    else if (outcome.action === 'skipped') result.skipped++;
    else result.failed++;

    if (options.verbose) {
      console.log(`[verdict-restore] ${issueId} -> ${outcome.action}${outcome.reason ? ` (${outcome.reason})` : ''}`);
    }
  }

  return result;
}

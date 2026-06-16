/**
 * PAN-1908 / PAN-1919: per-issue permanent-record builder.
 *
 * Builds a single JSON record per issue from SQLite (pipeline verdicts, usage,
 * merges) plus the legacy project-side continue file. The actual read/write/path
 * helpers live in `record.ts` (PAN-1919 single-writer module) and write the
 * record onto the feature branch at `<workspace>/.pan/records/<issue>.json`.
 */

import { hostname } from 'node:os';
import { join } from 'node:path';
import { promises as fsp } from 'node:fs';

// ─── Types ────────────────────────────────────────────────────────────────────
import {
  getCostBreakdownByStageAndModel,
  getCostForIssueFromDb,
} from '../database/cost-events-db.js';
import { getMergeSetSync } from '../merge-set.js';
import {
  getProjectSync,
  resolveProjectFromIssueSync,
  type ProjectConfig,
} from '../projects.js';
import type { ReviewStatus } from '../review-status.js';
import type {
  ContinueBeadsMapping,
  ContinueDecision,
  ContinueFeedbackEntry,
  ContinueHazard,
  ContinueResumePoint,
  ContinueSessionEntry,
} from '../vbrief/continue-state.js';
import {
  getIssueRecordPath,
  queueIssueRecordCommit,
  readIssueRecord,
  writeIssueRecordSync,
  type PanIssueRecord,
  type PanIssueCloseOutRecord,
  type PanIssuePipelineRecord,
  type PanIssueUsageRecord,
} from './record.js';

export type {
  PanIssueRecord,
  PanIssueCloseOutRecord,
  PanIssuePipelineRecord,
  PanIssueUsageRecord,
} from './record.js';

// ─── Continue projection ──────────────────────────────────────────────────────

interface ContinueFile {
  issueId?: string;
  gitState?: { branch?: string };
  decisions?: ContinueDecision[];
  hazards?: ContinueHazard[];
  resumePoint?: ContinueResumePoint | null;
  beadsMapping?: ContinueBeadsMapping;
  sessionHistory?: ContinueSessionEntry[];
  feedback?: ContinueFeedbackEntry[];
  agentModel?: string;
}

function projectContinue(raw: ContinueFile | null): Pick<PanIssueRecord, 'decisions' | 'hazards' | 'resumePoint' | 'beadsMapping' | 'sessionHistory' | 'feedback'> {
  return {
    decisions: raw?.decisions,
    hazards: raw?.hazards,
    resumePoint: raw?.resumePoint,
    beadsMapping: raw?.beadsMapping,
    sessionHistory: raw?.sessionHistory,
    feedback: raw?.feedback ?? [],
  };
}

// ─── Pipeline projection ──────────────────────────────────────────────────────

function projectPipeline(issueId: string, status: ReviewStatus | null): PanIssuePipelineRecord {
  const base: PanIssuePipelineRecord = {
    issueId,
    reviewStatus: status?.reviewStatus ?? 'pending',
    testStatus: status?.testStatus ?? 'pending',
    verificationStatus: status?.verificationStatus,
    inspectStatus: status?.inspectStatus,
    mergeStatus: status?.mergeStatus,
    readyForMerge: status?.readyForMerge ?? false,
    updatedAt: status?.updatedAt ?? new Date().toISOString(),
  };

  if (!status) return base;

  return {
    ...base,
    reviewNotes: status.reviewNotes,
    testNotes: status.testNotes,
    verificationNotes: status.verificationNotes,
    inspectNotes: status.inspectNotes,
    mergeNotes: status.mergeNotes,
    blockerReasons: status.blockerReasons,
    prUrl: status.prUrl,
    prNumber: status.prNumber,
    prHeadSha: status.prHeadSha,
    reviewedAtCommit: status.reviewedAtCommit,
    lastVerifiedCommit: status.lastVerifiedCommit,
    autoMerge: status.autoMerge,
    deaconIgnored: status.deaconIgnored,
    deaconIgnoredAt: status.deaconIgnoredAt,
    deaconIgnoredReason: status.deaconIgnoredReason,
    reviewerVerdicts: (status as { reviewerVerdicts?: unknown }).reviewerVerdicts,
  };
}

// ─── Usage projection ─────────────────────────────────────────────────────────

function projectUsage(issueId: string): PanIssueUsageRecord {
  const { byStage, totals } = getCostBreakdownByStageAndModel(issueId);
  const aggregate = getCostForIssueFromDb(issueId);

  return {
    byStage,
    totals,
    costAtCloseOut: {
      usd: aggregate?.totalCost ?? 0,
      pricingAsOf: new Date().toISOString(),
    },
  };
}

// ─── Merge projection ─────────────────────────────────────────────────────────

function projectMerges(issueId: string): string[] {
  const mergeSet = getMergeSetSync(issueId);
  if (!mergeSet) return [];
  return mergeSet.repos
    .map(r => r.artifactUrl)
    .filter((url): url is string => typeof url === 'string' && url.length > 0);
}

// ─── Record builder ───────────────────────────────────────────────────────────

async function readLegacyContinueText(projectRoot: string, issueId: string): Promise<string | null> {
  const path = join(projectRoot, '.pan', 'continues', `${issueId.toLowerCase()}.vbrief.json`);
  try {
    return await fsp.readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

export interface BuildIssueRecordOptions {
  closedAt?: string;
  owner?: string;
  reviewStatus?: ReviewStatus | null;
}

export async function buildIssueRecord(
  project: ProjectConfig,
  issueId: string,
  opts: BuildIssueRecordOptions = {},
): Promise<PanIssueRecord> {
  const existing = await readIssueRecord(project, issueId);
  const legacyContinueText = await readLegacyContinueText(project.path, issueId);
  const continueSubset = projectContinue(legacyContinueText ? (JSON.parse(legacyContinueText) as ContinueFile) : null);
  const pipelineRecord = projectPipeline(issueId, opts.reviewStatus ?? null);
  const usageRecord = projectUsage(issueId);
  const merges = projectMerges(issueId);

  return {
    issueId: issueId.toUpperCase(),
    schemaVersion: 1,
    ...continueSubset,
    ...existing,
    pipeline: pipelineRecord,
    closeOut: {
      usage: usageRecord,
      merges,
      ranOn: hostname(),
      closedAt: opts.closedAt,
    },
    owner: opts.owner ?? existing?.owner,
  };
}

// Re-export core record I/O from the PAN-1919 single-writer module.
export {
  getIssueRecordPath,
  writeIssueRecordSync,
  readIssueRecord,
  queueIssueRecordCommit,
} from './record.js';

// ─── Owner-URI lease (PAN-1908, CP-3) ─────────────────────────────────────────

export {
  buildOwnUri,
  claimIssueOwner,
  clearIssueOwner,
  type ClaimResult,
} from './record.js';

/**
 * PAN-1908 / PAN-1919: rebuild and queue the per-issue permanent record for a
 * given issue. Fire-and-forget: failures are logged, never thrown, so
 * review-status writes stay synchronous and fast.
 */
export async function updateIssueRecordForIssue(
  issueId: string,
  reviewStatus?: ReviewStatus | null,
): Promise<void> {
  try {
    const resolved = resolveProjectFromIssueSync(issueId);
    if (!resolved) return;
    const project = getProjectSync(resolved.projectKey);
    if (!project) return;

    const record = await buildIssueRecord(project, issueId, { reviewStatus });
    const recordPath = writeIssueRecordSync(project, issueId, record);
    queueIssueRecordCommit(project, issueId, recordPath);
  } catch (err) {
    console.warn(`[pan-dir/records] Failed to update record for ${issueId}: ${(err as Error).message}`);
  }
}

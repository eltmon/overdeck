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
import { existsSync, readFileSync } from 'node:fs';
import { readFile as readFileAsync } from 'node:fs/promises';
import { Effect } from 'effect';

// ─── Types ────────────────────────────────────────────────────────────────────
import {
  getCostBreakdownByStageAndModel,
  getCostForIssueFromDb,
} from '../database/cost-events-db.js';
import { getMergeSetSync } from '../merge-set.js';
import { getPanopticonHome } from '../paths.js';
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
  RECORD_SCHEMA_VERSION,
  writeIssueRecordSync,
  type PanIssueRecord,
  type PanIssueCloseOutRecord,
  type PanIssuePipelineRecord,
  type PanIssueUsageRecord,
} from './record.js';
import { readWorkspaceContinue } from './continue.js';

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
  statusOverrides?: Record<string, string>;
}

function projectContinue(raw: ContinueFile | null): Pick<PanIssueRecord, 'decisions' | 'hazards' | 'resumePoint' | 'beadsMapping' | 'sessionHistory' | 'feedback' | 'statusOverrides'> {
  return {
    decisions: raw?.decisions,
    hazards: raw?.hazards,
    resumePoint: raw?.resumePoint,
    beadsMapping: raw?.beadsMapping,
    sessionHistory: raw?.sessionHistory,
    feedback: raw?.feedback ?? [],
    statusOverrides: raw?.statusOverrides,
  };
}

async function readWorkspaceContinueText(workspacePath: string): Promise<ContinueFile | null> {
  if (!existsSync(workspacePath)) return null;
  const state = await Effect.runPromise(
    readWorkspaceContinue(workspacePath).pipe(Effect.catch(() => Effect.succeed(null))),
  );
  return state;
}

function readAgentStateHarnessModel(issueId: string): Pick<PanIssueRecord, 'harness' | 'model'> | null {
  const agentId = `agent-${issueId.toLowerCase()}`;
  const statePath = join(getPanopticonHome(), 'agents', agentId, 'state.json');
  if (!existsSync(statePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(statePath, 'utf-8')) as { harness?: string; model?: string };
    if (!raw.harness && !raw.model) return null;
    return {
      harness: raw.harness as PanIssueRecord['harness'],
      model: raw.model,
    };
  } catch {
    return null;
  }
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
    return await readFileAsync(path, 'utf-8');
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
  const workspacePath = join(project.path, 'workspaces', `feature-${issueId.toLowerCase()}`);
  const workspaceContinue = existsSync(workspacePath) ? await readWorkspaceContinueText(workspacePath) : null;
  const legacyContinueText = await readLegacyContinueText(project.path, issueId);
  const legacyContinue = legacyContinueText ? (JSON.parse(legacyContinueText) as ContinueFile) : null;
  // Merge: legacy project-side continue is the base, workspace continue overlays it
  // (workspace is newer during active work), and the per-issue record overlays both.
  const mergedContinue: ContinueFile | null = legacyContinue || workspaceContinue
    ? {
        ...legacyContinue,
        ...workspaceContinue,
        // Concatenate array fields so nothing is lost; workspace entries appended last.
        decisions: [...(legacyContinue?.decisions ?? []), ...(workspaceContinue?.decisions ?? [])],
        hazards: [...(legacyContinue?.hazards ?? []), ...(workspaceContinue?.hazards ?? [])],
        sessionHistory: [...(legacyContinue?.sessionHistory ?? []), ...(workspaceContinue?.sessionHistory ?? [])],
        feedback: [...(legacyContinue?.feedback ?? []), ...(workspaceContinue?.feedback ?? [])],
        beadsMapping: { ...(legacyContinue?.beadsMapping ?? {}), ...(workspaceContinue?.beadsMapping ?? {}) },
        statusOverrides: { ...(legacyContinue?.statusOverrides ?? {}), ...(workspaceContinue?.statusOverrides ?? {}) },
      }
    : null;
  const continueSubset = projectContinue(mergedContinue);
  const harnessModel = readAgentStateHarnessModel(issueId);
  const pipelineRecord = projectPipeline(issueId, opts.reviewStatus ?? null);
  const usageRecord = projectUsage(issueId);
  const merges = projectMerges(issueId);

  return {
    issueId: issueId.toUpperCase(),
    schemaVersion: RECORD_SCHEMA_VERSION,
    ...continueSubset,
    ...harnessModel,
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
  getIssueRecordBasePath,
  getIssueRecordPath,
  getIssueWorkspacePath,
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

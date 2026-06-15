/**
 * PAN-1908: per-issue permanent-record writer.
 *
 * Produces a single JSON file per issue containing the durable subset of
 * pipeline state that belongs in the infra repo:
 *   - continue: durable subset of the workspace continue file
 *   - pipeline: durable review_status verdicts
 *   - closeOut: usage, merges, ranOn (populated at close-out time)
 *   - owner: URI lease metadata
 *
 * The writer is deliberately read-only w.r.t. the live orchestrator: it reads
 * SQLite + the continue file and writes a JSON record. Callers decide when to
 * build, write, and commit the record.
 */

import { existsSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { Effect } from 'effect';
import { getReviewStatusSync } from '../review-status.js';
import { getCostForIssueFromDb } from '../database/cost-events-db.js';
import { getMergeSetSync } from '../merge-set.js';
import { readContinueFile } from './continues.js';
import { resolveInfraRepo, type ProjectConfig } from '../projects.js';
import { queueAutoCommit } from './auto-commit.js';
import type { ReviewStatus } from '../review-status.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PanIssueContinueRecord {
  issueId: string;
  branch?: string;
  decisions?: Array<{ id: string; summary: string; recordedAt: string }>;
  hazards?: Array<{ id: string; summary: string; mitigation: string }>;
}

export interface PanIssuePipelineRecord {
  issueId: string;
  reviewStatus: string;
  testStatus: string;
  verificationStatus?: string;
  inspectStatus?: string;
  mergeStatus?: string;
  readyForMerge: boolean;
  reviewNotes?: string;
  testNotes?: string;
  verificationNotes?: string;
  inspectNotes?: string;
  mergeNotes?: string;
  blockerReasons?: unknown[];
  prUrl?: string;
  prNumber?: number;
  prHeadSha?: string;
  reviewedAtCommit?: string;
  lastVerifiedCommit?: string;
  autoMerge?: boolean;
  deaconIgnored?: boolean;
  deaconIgnoredAt?: string;
  deaconIgnoredReason?: string;
  reviewerVerdicts?: unknown;
  updatedAt: string;
}

export interface PanIssueUsageStageRecord {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
  calls: number;
}

export interface PanIssueUsageRecord {
  byStage: Record<string, PanIssueUsageStageRecord>;
  byModel: Record<string, PanIssueUsageStageRecord>;
  costAtCloseOut?: { usd: number; pricingAsOf: string };
}

export interface PanIssueCloseOutRecord {
  usage: PanIssueUsageRecord;
  merges: string[];
  ranOn: string;
  closedAt?: string;
}

export interface PanIssueOwnerRecord {
  uri?: string;
  claimedAt?: string;
  expiresAt?: string;
}

export interface PanIssueRecord {
  issueId: string;
  schemaVersion: number;
  continue: PanIssueContinueRecord;
  pipeline: PanIssuePipelineRecord;
  closeOut: PanIssueCloseOutRecord;
  owner: PanIssueOwnerRecord;
}

// ─── Continue projection ──────────────────────────────────────────────────────

interface ContinueFile {
  issueId?: string;
  gitState?: { branch?: string };
  decisions?: PanIssueContinueRecord['decisions'];
  hazards?: PanIssueContinueRecord['hazards'];
}

function projectContinue(issueId: string, raw: ContinueFile | null): PanIssueContinueRecord {
  return {
    issueId,
    branch: raw?.gitState?.branch,
    decisions: raw?.decisions,
    hazards: raw?.hazards,
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

function emptyStageRecord(): PanIssueUsageStageRecord {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, calls: 0 };
}

function projectUsage(issueId: string): PanIssueUsageRecord {
  const aggregate = getCostForIssueFromDb(issueId);
  const byStage: Record<string, PanIssueUsageStageRecord> = {};
  const byModel: Record<string, PanIssueUsageStageRecord> = {};

  if (aggregate) {
    for (const [stage, breakdown] of Object.entries(aggregate.stages ?? {})) {
      const key = stage || 'other';
      byStage[key] = {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        costUsd: breakdown.cost ?? 0,
        calls: breakdown.calls ?? 0,
      };
    }

    for (const [model, breakdown] of Object.entries(aggregate.models ?? {})) {
      byModel[model] = {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        costUsd: breakdown.cost ?? 0,
        calls: breakdown.calls ?? 0,
      };
    }
  }

  const totalCost = aggregate?.totalCost ?? 0;
  return {
    byStage,
    byModel,
    costAtCloseOut: {
      usd: totalCost,
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

export interface BuildIssueRecordOptions {
  closedAt?: string;
  owner?: PanIssueOwnerRecord;
}

export async function buildIssueRecord(
  projectRoot: string,
  issueId: string,
  opts: BuildIssueRecordOptions = {},
): Promise<PanIssueRecord> {
  const rawContinue = await readContinueFile(projectRoot, issueId).pipe(
    Effect.matchEffect({
      onSuccess: (text) => Effect.succeed(text ? (JSON.parse(text) as ContinueFile) : null),
      onFailure: () => Effect.succeed(null),
    }),
  );
  const continueRecord = projectContinue(issueId, await Effect.runPromise(rawContinue));
  const reviewStatus = getReviewStatusSync(issueId);
  const pipelineRecord = projectPipeline(issueId, reviewStatus);
  const usageRecord = projectUsage(issueId);
  const merges = projectMerges(issueId);

  return {
    issueId,
    schemaVersion: 1,
    continue: continueRecord,
    pipeline: pipelineRecord,
    closeOut: {
      usage: usageRecord,
      merges,
      ranOn: hostname(),
      closedAt: opts.closedAt,
    },
    owner: opts.owner ?? {},
  };
}

// ─── Record writer ────────────────────────────────────────────────────────────

export function getIssueRecordPath(project: ProjectConfig, issueId: string): string {
  const { repoPath, recordsPath } = resolveInfraRepo(project);
  return join(repoPath, recordsPath, `${issueId.toLowerCase()}.json`);
}

export function writeIssueRecordSync(
  project: ProjectConfig,
  issueId: string,
  record: PanIssueRecord,
): string {
  const path = getIssueRecordPath(project, issueId);
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(record, null, 2), 'utf-8');
  return path;
}

export function queueIssueRecordCommit(
  project: ProjectConfig,
  issueId: string,
  recordPath: string,
): void {
  const { repoPath } = resolveInfraRepo(project);
  queueAutoCommit({
    projectRoot: repoPath,
    paths: [recordPath],
    subject: `chore(records): update ${issueId.toUpperCase()} permanent record`,
  });
}

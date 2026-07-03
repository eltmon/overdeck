/**
 * PAN-1908: one-time backfill of per-issue permanent records.
 *
 * Builds a record for every in-flight issue (anything with a review_status
 * row, an agents-table row, or a `.pan/continues/<issue>.vbrief.json` file)
 * and writes it into the declared infra repo. Re-running is safe: records
 * whose content has not changed are skipped, and unchanged commits are
 * suppressed by the auto-commit diff check.
 */

import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { listOverdeckAgentStatesSync } from '../overdeck/agent-state-sync.js';
import { getAllReviewStatusesFromDb } from '../overdeck/review-status-sync.js';
import {
  getProjectSync,
  loadProjectsConfigSync,
  resolveInfraRepo,
  resolveProjectFromIssueSync,
  type ProjectConfig,
} from '../projects.js';
import {
  buildIssueRecord,
  getIssueRecordPath,
  queueIssueRecordCommit,
  readIssueRecord,
  writeIssueRecordSync,
  type PanIssueRecord,
} from './records.js';
import { withIssueRecordLock } from './record-lock.js';

export interface BackfillRecordsResult {
  processed: number;
  skipped: number;
  failed: number;
  details: Array<{ issueId: string; action: 'written' | 'skipped' | 'failed'; reason?: string }>;
}

export interface BackfillRecordsOptions {
  /** If provided, only backfill this issue. */
  issueId?: string;
  /** Log each processed issue. */
  verbose?: boolean;
  /** Force overwrite even if the record is unchanged. */
  force?: boolean;
}

function getProjectRoot(project: ProjectConfig): string {
  return project.path;
}

async function collectContinueIssueIds(project: ProjectConfig): Promise<Set<string>> {
  const ids = new Set<string>();
  const continuesDir = join(getProjectRoot(project), '.pan', 'continues');
  if (!existsSync(continuesDir)) return ids;

  try {
    const entries = await readdir(continuesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const match = entry.name.match(/^([a-z0-9]+-\d+)\.vbrief\.json$/i);
      if (!match) continue;
      ids.add(match[1].toUpperCase());
    }
  } catch {
    // Directory may be unreadable; skip.
  }
  return ids;
}

function collectAgentIssueIds(): Set<string> {
  const ids = new Set<string>();
  try {
    for (const agent of listOverdeckAgentStatesSync()) {
      if (agent.issueId) ids.add(agent.issueId.toUpperCase());
    }
  } catch {
    // Agents table may not exist on very old dbs; skip.
  }
  return ids;
}

function collectReviewStatusIssueIds(): Set<string> {
  const ids = new Set<string>();
  try {
    const statuses = getAllReviewStatusesFromDb();
    for (const issueId of Object.keys(statuses)) {
      ids.add(issueId.toUpperCase());
    }
  } catch {
    // review_status table may not exist; skip.
  }
  return ids;
}

export async function collectInFlightIssueIds(projects: ProjectConfig[]): Promise<Set<string>> {
  const ids = collectAgentIssueIds();
  for (const id of collectReviewStatusIssueIds()) ids.add(id);

  for (const project of projects) {
    for (const id of await collectContinueIssueIds(project)) ids.add(id);
  }

  return ids;
}

function normalizeRecordForCompare(record: PanIssueRecord): string {
  // Several fields are build metadata rather than durable state and move on
  // every build: usage pricing, pipeline.updatedAt, closeOut.closedAt, etc.
  // Exclude them from idempotency comparison so unchanged issues don't churn.
  const { closeOut, pipeline, ...rest } = record;
  const normalized = {
    ...rest,
    pipeline: pipeline
      ? {
          ...pipeline,
          updatedAt: undefined,
        }
      : undefined,
    closeOut: closeOut
      ? {
          ...closeOut,
          closedAt: undefined,
          usage: closeOut.usage
            ? {
                byStage: closeOut.usage.byStage,
                totals: closeOut.usage.totals,
              }
            : undefined,
        }
      : undefined,
  };
  return JSON.stringify(normalized);
}

async function backfillIssue(
  issueId: string,
  opts: BackfillRecordsOptions,
): Promise<{ action: 'written' | 'skipped' | 'failed'; reason?: string }> {
  const resolved = resolveProjectFromIssueSync(issueId);
  if (!resolved) {
    return { action: 'failed', reason: 'could not resolve project' };
  }

  const project = getProjectSync(resolved.projectKey);
  if (!project) {
    return { action: 'failed', reason: 'project not found' };
  }

  try {
    const { repoPath } = resolveInfraRepo(project);
    if (!existsSync(join(repoPath, '.git'))) {
      return { action: 'failed', reason: 'infra repo is not a git checkout' };
    }

    return await withIssueRecordLock(issueId, async () => {
      const existing = await readIssueRecord(project, issueId);
      const reviewStatus = getAllReviewStatusesFromDb()[issueId.toUpperCase()] ?? null;
      const record = await buildIssueRecord(project, issueId, { reviewStatus });

      if (!opts.force && existing && normalizeRecordForCompare(existing) === normalizeRecordForCompare(record)) {
        return { action: 'skipped', reason: 'record unchanged' };
      }

      const recordPath = writeIssueRecordSync(project, issueId, record);
      queueIssueRecordCommit(project, issueId, recordPath);
      return { action: 'written' };
    });
  } catch (err) {
    return { action: 'failed', reason: (err as Error).message };
  }
}

/**
 * Backfill per-issue permanent records for all in-flight issues.
 */
export async function backfillIssueRecords(
  options: BackfillRecordsOptions = {},
): Promise<BackfillRecordsResult> {
  const config = loadProjectsConfigSync();
  const projects = Object.entries(config.projects).map(([key, p]) => ({ ...p, key }));

  let issueIds: Set<string>;
  if (options.issueId) {
    issueIds = new Set([options.issueId.toUpperCase()]);
  } else {
    issueIds = await collectInFlightIssueIds(projects);
  }

  const result: BackfillRecordsResult = {
    processed: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };

  for (const issueId of issueIds) {
    if (options.verbose) {
      console.log(`[records-backfill] ${issueId} ...`);
    }

    const outcome = await backfillIssue(issueId, options);
    result.details.push({ issueId, ...outcome });

    if (outcome.action === 'written') result.processed++;
    else if (outcome.action === 'skipped') result.skipped++;
    else result.failed++;

    if (options.verbose) {
      console.log(`[records-backfill] ${issueId} -> ${outcome.action}${outcome.reason ? ` (${outcome.reason})` : ''}`);
    }
  }

  return result;
}

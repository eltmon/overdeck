/**
 * PAN-3850 (W40, FR-27): the report-only invariant checker.
 *
 * Three planes claim to know an issue's pipeline state: the permanent record
 * (`records/<issue>.json` on overdeck-state), the review-status row in
 * overdeck.db, and agent liveness (agents-table status vs a live tmux
 * session). When they disagree, every gate downstream reads a different truth.
 * This checker is the reconciliation ALARM: it compares the planes field by
 * field, emits one activity entry per mismatching entity per day plus a
 * summary count, persists its latest report for `pan doctor` and the parked
 * resolver's `invariant-mismatch` orbit — and writes NOTHING else. It never
 * touches the record writer, `setReviewStatusSync`, or any store it reads.
 *
 * Registered in `runPatrol` every 10 passes (PAN-3850); the mismatches it
 * reports are repaired by their own doors (`pan review resync <id>` for
 * verdict drift, `pan admin agents exited <id>` for liveness drift).
 *
 * Field scope: the eight fields both planes carry (reviewStatus, testStatus,
 * verificationStatus, uatStatus, reviewedAtCommit, lastVerifiedCommit,
 * readyForMerge, reviewStaleSince). The PRD also names stuck/stuckReason, but
 * the record's pipeline block does not mirror them — a one-sided field cannot
 * drift, so they are not compared.
 *
 * Liveness scope: only "row claims alive, session is gone" is a mismatch. The
 * reverse (stopped row, live session) is the PAN-2579 warm-session steady
 * state, not drift. When the tmux census is unavailable the liveness pass
 * fails open (no rows) rather than declaring every agent dead.
 *
 * PAN-3849 note: when Phase 4's single liveness oracle lands, the liveness
 * comparison here should switch from the census-based probe to `isAliveSync`.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { emitActivityEntryOnce, emitActivityEntrySync, type EmitActivityOptions } from '../activity-logger.js';
import { listRunningAgentsSync } from '../agents/queries.js';
import { readIssueRecord, type PanIssuePipelineRecord } from '../pan-dir/record.js';
import { getProjectSync, resolveProjectFromIssueSync } from '../projects.js';
import { getOverdeckHome } from '../paths.js';
import { type ReviewStatus } from '../review-status.js';
import { listPipelineStatuses } from '../overdeck/pipeline-view.js';

/** The pipeline fields both the record and the review-status row carry. */
export const INVARIANT_PIPELINE_FIELDS = [
  'reviewStatus',
  'testStatus',
  'verificationStatus',
  'uatStatus',
  'reviewedAtCommit',
  'lastVerifiedCommit',
  'readyForMerge',
  'reviewStaleSince',
] as const;

export type InvariantPipelineField = (typeof INVARIANT_PIPELINE_FIELDS)[number];

export interface InvariantFieldMismatch {
  field: InvariantPipelineField | 'record';
  recordValue?: unknown;
  rowValue?: unknown;
}

export type InvariantMismatchKind = 'pipeline' | 'liveness';

export interface InvariantMismatch {
  /** Issue id for pipeline mismatches, agent id for liveness mismatches. */
  entity: string;
  kind: InvariantMismatchKind;
  /** Pipeline: which fields drifted. */
  fields: InvariantFieldMismatch[];
  /** Liveness: a human sentence ("agents row says running, no tmux session"). */
  detail?: string;
  /** Set for liveness mismatches: the issue the agent belongs to, if known. */
  issueId?: string;
}

export interface InvariantReport {
  generatedAt: string;
  mismatches: InvariantMismatch[];
}

export function invariantReportPath(): string {
  return join(getOverdeckHome(), 'deacon', 'invariant-report.json');
}

/**
 * Pure field-by-field comparison of the record's pipeline block against the
 * review-status row. Returns null when they agree. A missing record is itself
 * a mismatch (the record is canonical; an in-pipeline issue must have one).
 */
export function comparePipelineInvariant(
  issueId: string,
  pipeline: PanIssuePipelineRecord | null,
  row: ReviewStatus,
): InvariantMismatch | null {
  if (!pipeline) {
    return {
      entity: issueId,
      kind: 'pipeline',
      fields: [{ field: 'record', recordValue: '<missing>', rowValue: '<present>' }],
    };
  }
  const fields: InvariantFieldMismatch[] = [];
  for (const field of INVARIANT_PIPELINE_FIELDS) {
    const recordValue = pipeline[field];
    const rowValue = row[field];
    if (recordValue !== rowValue) {
      fields.push({ field, recordValue: recordValue ?? null, rowValue: rowValue ?? null });
    }
  }
  return fields.length > 0 ? { entity: issueId, kind: 'pipeline', fields } : null;
}

/**
 * Pure liveness comparison for one agent row. Only "alive row, dead session"
 * drifts (see module header for the asymmetry). Returns null when they agree.
 */
export function compareLivenessInvariant(agent: { id: string; status: string; issueId?: string; tmuxActive: boolean }): InvariantMismatch | null {
  const claimsAlive = agent.status === 'running' || agent.status === 'starting';
  if (!claimsAlive || agent.tmuxActive) return null;
  return {
    entity: agent.id,
    kind: 'liveness',
    fields: [],
    detail: `agents row says ${agent.status} but no tmux session exists for ${agent.id}`,
    ...(agent.issueId ? { issueId: agent.issueId } : {}),
  };
}

/** Tolerant read of the last checker report; a missing/torn file is empty. */
export function readInvariantReport(filePath = invariantReportPath()): InvariantReport {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return { generatedAt: '', mismatches: [] };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<InvariantReport>;
    if (parsed && Array.isArray(parsed.mismatches)) {
      return { generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : '', mismatches: parsed.mismatches as InvariantMismatch[] };
    }
  } catch {
    // torn write reads as empty
  }
  return { generatedAt: '', mismatches: [] };
}

function writeInvariantReport(report: InvariantReport, filePath = invariantReportPath()): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    renameSync(tmp, filePath);
  } catch (error) {
    console.warn(`[invariant-checker] failed to persist report: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Injectable dependencies — the defaults are the canonical read doors. */
export interface InvariantCheckerDeps {
  now?: Date;
  reportPath?: string;
  loadRows?: () => Record<string, ReviewStatus>;
  /** Record read door: the pipeline block for one issue, or null when absent/unreadable. */
  readPipeline?: (issueId: string) => Promise<PanIssuePipelineRecord | null>;
  listAgents?: () => { id: string; status: string; issueId?: string; tmuxActive: boolean }[];
  emitOnce?: (options: EmitActivityOptions & { id: string }) => Promise<unknown>;
  emitSummary?: (options: EmitActivityOptions) => void;
}

async function defaultReadPipeline(issueId: string): Promise<PanIssuePipelineRecord | null> {
  try {
    const resolved = resolveProjectFromIssueSync(issueId);
    if (!resolved) return null;
    const project = getProjectSync(resolved.projectKey);
    if (!project) return null;
    const record = await readIssueRecord(project, issueId);
    return record?.pipeline ?? null;
  } catch {
    return null;
  }
}

function describeMismatch(mismatch: InvariantMismatch): string {
  if (mismatch.kind === 'liveness') return mismatch.detail ?? 'liveness drift';
  return `record/row drift on ${mismatch.fields.map((f) => f.field).join(', ')}`;
}

/**
 * Run one checker pass: compare every non-merged issue's record pipeline
 * block with its review-status row, and every agent row's status with session
 * liveness. Emits one activity entry per mismatching entity per UTC day plus
 * a per-run summary, and persists the report for `pan doctor` / the parked
 * resolver. Never writes the record, the review-status store, or agent state.
 */
export async function runInvariantChecker(deps: InvariantCheckerDeps = {}): Promise<InvariantReport> {
  const now = deps.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  const loadRows = deps.loadRows ?? listPipelineStatuses;
  const readPipeline = deps.readPipeline ?? defaultReadPipeline;
  const listAgents = deps.listAgents ?? listRunningAgentsSync;
  const emitOnce = deps.emitOnce ?? emitActivityEntryOnce;
  const emitSummary = deps.emitSummary ?? emitActivityEntrySync;

  const mismatches: InvariantMismatch[] = [];

  const rows = loadRows();
  for (const [key, row] of Object.entries(rows)) {
    if (row.mergeStatus === 'merged') continue;
    const issueId = key.toUpperCase();
    const pipeline = await readPipeline(issueId);
    const mismatch = comparePipelineInvariant(issueId, pipeline, row);
    if (mismatch) mismatches.push(mismatch);
  }

  for (const agent of listAgents()) {
    const mismatch = compareLivenessInvariant(agent);
    if (mismatch) mismatches.push(mismatch);
  }

  const report: InvariantReport = { generatedAt: now.toISOString(), mismatches };
  writeInvariantReport(report, deps.reportPath ?? invariantReportPath());

  for (const mismatch of mismatches) {
    const description = describeMismatch(mismatch);
    const issueId = mismatch.kind === 'pipeline' ? mismatch.entity : mismatch.issueId;
    await emitOnce({
      id: `invariant-mismatch:${mismatch.entity}:${day}`,
      source: 'cloister',
      level: 'warn',
      message: `Invariant mismatch: ${mismatch.entity} — ${description}`,
      details: mismatch.kind === 'pipeline'
        ? `Run pan review resync ${mismatch.entity} once the drift cause is understood.`
        : `Run pan admin agents exited ${mismatch.entity} to mark the row stopped.`,
      ...(issueId ? { issueId } : {}),
    });
  }

  const pipelineCount = mismatches.filter((m) => m.kind === 'pipeline').length;
  const livenessCount = mismatches.length - pipelineCount;
  emitSummary({
    source: 'cloister',
    level: mismatches.length > 0 ? 'warn' : 'info',
    message: `Invariant checker: ${mismatches.length} mismatching entit${mismatches.length === 1 ? 'y' : 'ies'} (${pipelineCount} pipeline, ${livenessCount} liveness)`,
  });

  return report;
}

/**
 * Patrol entry point (PAN-3850 W40): run the checker and return summary
 * action strings for the deacon log. Registered in `runPatrol` every 10
 * passes, wrapped in the patrol budget like every other patrol.
 */
export async function runInvariantCheckerPatrol(): Promise<string[]> {
  const report = await runInvariantChecker();
  if (report.mismatches.length === 0) return [];
  return report.mismatches.map((mismatch) => `Invariant mismatch: ${mismatch.entity} — ${describeMismatch(mismatch)}`);
}

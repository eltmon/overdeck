/**
 * PAN-1919: single per-issue git-tracked record.
 *
 * Replaces the dual "continues" plane (project-side `.pan/continues/` and
 * workspace-side `.pan/continue.json`) plus the harness/model data that only
 * lived in machine-local `~/.overdeck/agents/<id>/state.json`.
 *
 * The record lives on the feature branch at:
 *   `<workspace>/.pan/records/<issueId-lowercase>.json`
 *
 * This keeps mutable progress state out of `main` (PAN-1124 single-spec-on-main
 * invariant) while still making it portable via `git push`.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, promises as fsp } from 'node:fs';
import { dirname, join } from 'node:path';
import { hostname } from 'node:os';

import { queueAutoCommit } from './auto-commit.js';
import { resolveStateReadHomeSync } from '../state-read-home.js';
import {
  getProjectSync,
  resolveProjectFromIssueSync,
  type ProjectConfig,
} from '../projects.js';
import type { RuntimeName } from '../runtimes/types.js';
import type { ReviewMode } from '../config-yaml.js';
import type {
  ContinueBeadsMapping,
  ContinueDecision,
  ContinueFeedbackEntry,
  ContinueHazard,
  ContinueResumePoint,
  ContinueSessionEntry,
  ScopeDriftRecord,
} from '../vbrief/continue-state.js';

// ─── Schema ───────────────────────────────────────────────────────────────────

export const RECORD_SCHEMA_VERSION = 2;
export const RECORD_DIRNAME = 'records';

export interface PanIssueUsageModelRecord {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface PanIssueUsageRecord {
  byStage: Record<string, Record<string, PanIssueUsageModelRecord>>;
  totals: Record<string, PanIssueUsageModelRecord>;
  costAtCloseOut?: { usd: number; pricingAsOf: string };
}

export interface PanIssueCloseOutRecord {
  usage: PanIssueUsageRecord;
  merges: string[];
  ranOn: string;
  closedAt?: string;
}

export interface PanIssueSwarmFailedMergeBlock {
  issueId: string;
  itemId: string;
  slotIndex: number;
  branch?: string;
  note: string;
}

export interface PanIssueSwarmSlotAssignment {
  slotIndex: number;
  itemId: string;
  agentId?: string;
  branch?: string;
  assignedAt?: string;
}

export interface PanIssueSwarmSupersededAttempt {
  slotIndex: number;
  itemId: string;
  agentId?: string;
  branch?: string;
  archivedBranch?: string;
  archivedWorktree?: string;
  reason: string;
  supersededAt: string;
}

/**
 * PAN-2372 WI-3 / FR-4: durable per-slot completion marker. A slot's `pan done`
 * writes one of these keyed by `String(slotIndex)` so the swarm coordinator can
 * tell a finished slot from one still working — without relying on the
 * runtime-only agent-state plane, which is exactly what was being lost.
 */
export interface PanIssueSwarmSlotCompletion {
  slotIndex: number;
  itemId?: string;
  agentId: string;
  completedAt: string;
}

export interface PanIssueSwarmRecord {
  finalizedAt?: string;
  /**
   * @deprecated Read for migration only; new blocks live in `failedMergeBlocks`
   * keyed by `String(slotIndex)`. `writeSwarmFailedMergeBlock` folds this into
   * the map and clears it on first write.
   */
  failedMergeBlock?: PanIssueSwarmFailedMergeBlock;
  slotAssignments?: PanIssueSwarmSlotAssignment[];
  supersededAttempts?: PanIssueSwarmSupersededAttempt[];
  /**
   * Keyed by `String(slotIndex)`. The coordinator (WI-4) consumes this to mark
   * a slot durable-ready; merge/requeue clears the key (clearSwarmSlotCompletion).
   */
  slotCompletions?: Record<string, PanIssueSwarmSlotCompletion>;
  /**
   * PAN-2364: failed-merge and stalled-slot recovery blocks keyed by
   * `String(slotIndex)`. The legacy singular `failedMergeBlock` above is folded
   * into this map on first write.
   */
  failedMergeBlocks?: Record<string, PanIssueSwarmFailedMergeBlock>;
}

export interface PanIssueRecoveryTrip {
  issue: string;
  recoveryPath: string;
  obligationGeneration: string;
  tripCount: number;
  open: boolean;
  needsYouEmittedAt?: string;
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
  /** PAN-1988 auto-heal: durable "the work agent finished and wants review" intent (set by `pan done`). */
  reviewRequestedAt?: string;
  /** PAN-1762: advisory files_scope drift recorded at pan done. */
  scopeDrift?: ScopeDriftRecord;
  autoMerge?: boolean;
  deaconIgnored?: boolean;
  deaconIgnoredAt?: string;
  deaconIgnoredReason?: string;
  /** PAN-2207: durable tombstone set when deacon recovers a stuck-pending completion; cleared by re-run of `pan done`. */
  panDoneRecoveredAt?: string;
  closedOut?: boolean;
  closedOutAt?: string;
  reviewerVerdicts?: unknown;
  updatedAt: string;
}

/**
 * Single durable record per issue. Contains the superset of data previously
 * scattered across project continue, workspace continue, and state.json:
 *
 *   - decisions / hazards / resumePoint / beadsMapping / sessionHistory /
 *     feedback (from continues)
 *   - statusOverrides (from workspace continue)
 *   - harness / model (from state.json)
 *   - pipeline / closeOut / owner (existing PAN-1908 record fields)
 */
export interface PanIssueRecord {
  issueId: string;
  schemaVersion: number;
  created?: string;
  updated?: string;
  branch?: string;

  /** Coding-agent harness (from state.json; PAN-1919). */
  harness?: RuntimeName;
  /** Agent model (from state.json; PAN-1919). */
  model?: string;
  /** Per-issue review mode override; beats project/global config. */
  reviewMode?: ReviewMode;
  /** Per-issue tiered execution override; beats plan-metadata and global config. */
  tieredExecutionOverride?: 'on' | 'off';

  decisions?: ContinueDecision[];
  hazards?: ContinueHazard[];
  resumePoint?: ContinueResumePoint | null;
  beadsMapping?: ContinueBeadsMapping;
  statusOverrides?: Record<string, string>;
  sessionHistory?: ContinueSessionEntry[];
  feedback?: ContinueFeedbackEntry[];
  scopeDrift?: ScopeDriftRecord;
  swarm?: PanIssueSwarmRecord;
  recoveryTrips?: PanIssueRecoveryTrip[];

  pipeline: PanIssuePipelineRecord;
  closeOut: PanIssueCloseOutRecord;
  owner?: string;
}

// ─── Path resolution ──────────────────────────────────────────────────────────

/** Workspace path for an issue, or null if no project is configured. */
export function getIssueWorkspacePath(issueId: string): string | null {
  const resolved = resolveProjectFromIssueSync(issueId);
  if (!resolved) return null;
  return join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
}

/**
 * Record path for an issue reached from a workspace directory. When the issue
 * resolves to a registered project, delegates to {@link getIssueRecordPath}
 * (canonical, migration-aware) so every workspace-door caller converges on the
 * SAME record as the canonical door — including a migrated project, whose
 * record lives at `${OVERDECK_HOME}/state/<project>/records/` rather than the
 * slot worktree (FR-3, PAN-2372 WI-2).
 *
 * When no project can be resolved for the issue, falls back directly to
 * `<workspace>/.pan/records/<issue>.json` — byte-identical to the pre-PAN-2372
 * behavior, and intentionally NOT routed through `getIssueRecordPath` (which
 * would need migration/infra-repo resolution for a project that does not
 * exist). Proven by `record-rehome.test.ts`.
 */
export function getIssueRecordPathForWorkspace(workspacePath: string, issueId: string): string {
  const project = resolveProjectForIssue(issueId);
  if (project) return getIssueRecordPath(project, issueId);
  return join(workspacePath, '.pan', RECORD_DIRNAME, `${issueId.toLowerCase()}.json`);
}

/**
 * Record path for an issue. Lives in the workspace (feature branch) at
 * `.pan/records/<issueId-lowercase>.json` when the workspace can be resolved;
 * otherwise falls back to `<project.path>/.pan/records/<issueId-lowercase>.json`
 * (used in tests and non-worktree contexts).
 */
export function getIssueRecordPath(project: ProjectConfig, issueId: string): string {
  const stateHome = resolveStateReadHomeSync(project);
  const recordsDir = stateHome.migrated
    ? join(stateHome.root, RECORD_DIRNAME)
    : join(getIssueRecordBasePath(project, issueId), '.pan', RECORD_DIRNAME);
  return join(recordsDir, `${issueId.toLowerCase()}.json`);
}

/** Base directory for an issue record: workspace if it exists, else project root. */
export function getIssueRecordBasePath(project: ProjectConfig, issueId: string): string {
  const workspacePath = getIssueWorkspacePath(issueId);
  return workspacePath && existsSync(workspacePath) ? workspacePath : project.path;
}

// ─── Read / write ─────────────────────────────────────────────────────────────

/**
 * Synchronous whole-record writer. Keep this call atomic: async
 * read-modify-write flows must take `withIssueRecordLock` before reading and
 * must not split this write behind an await.
 */
/**
 * PAN-2466 no-loss guard: callers that fail to read the existing record fall
 * back to a fresh template with an EMPTY closeOut, and writing that template
 * destroys accumulated usage/cost history (observed on six records 2026-07-07).
 * At the write door, if the incoming closeOut carries no data but the on-disk
 * record's does, keep the on-disk closeOut. Genuine closeOut updates (any
 * usage/merges/totals content) always win.
 */
function preserveCloseOutSync(path: string, record: PanIssueRecord): PanIssueRecord {
  const incoming = record.closeOut;
  const incomingEmpty =
    !incoming ||
    (Object.keys(incoming.usage?.byStage ?? {}).length === 0 &&
      Object.keys(incoming.usage?.totals ?? {}).length === 0 &&
      (incoming.merges ?? []).length === 0);
  if (!incomingEmpty || !existsSync(path)) return record;
  try {
    const onDisk = JSON.parse(readFileSync(path, 'utf-8')) as PanIssueRecord;
    const disk = onDisk.closeOut;
    const diskHasData =
      disk &&
      (Object.keys(disk.usage?.byStage ?? {}).length > 0 ||
        Object.keys(disk.usage?.totals ?? {}).length > 0 ||
        (disk.merges ?? []).length > 0);
    if (diskHasData) {
      console.warn(`[record] Preserving populated closeOut for ${record.issueId} — incoming write carried an empty closeOut (PAN-2466 guard)`);
      return { ...record, closeOut: disk };
    }
  } catch {
    // Unreadable on-disk record — nothing to preserve.
  }
  return record;
}

/**
 * FR-2 (PAN-2372): before a record write, if the existing file is non-empty and
 * fails JSON.parse, preserve the corrupt bytes as a sidecar rather than
 * silently overwriting them. A truncated/malformed record (the "empty/malformed
 * at char 0" symptom that stranded PAN-2253) used to be quietly replaced by the
 * next write, destroying every accumulated statusOverride. Non-empty + unparseable
 * is the only case sidecarred — an absent or empty file is a normal fresh write.
 */
function preserveCorruptRecordSync(path: string): void {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return; // No existing file — nothing to preserve.
  }
  if (raw.length === 0) return; // Empty file is a normal fresh-write state, not corruption.
  try {
    JSON.parse(raw);
    return; // Existing file parses — the rename below atomically replaces it.
  } catch {
    // Non-empty and unparseable — fall through to sidecar.
  }
  const sidecar = `${path}.corrupt-${Date.now()}`;
  try {
    renameSync(path, sidecar);
    console.warn(`[record] Preserved corrupt record at ${sidecar} (existing file failed JSON.parse before write)`);
  } catch (error) {
    console.warn(`[record] Could not preserve corrupt record at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * FR-1 (PAN-2372): atomic, verified record write. Writes to a same-directory
 * temp file, atomically renames it into place, then read-back verifies the
 * renamed file parses as JSON. A mid-write crash can no longer truncate the
 * record in place (rename is atomic); a write that somehow produces unparseable
 * bytes throws instead of leaving a corrupt record for readers to silently
 * fabricate over. Modeled on writePlanFileAtomic (src/lib/vbrief/dag-cli.ts:101).
 */
function writeRecordFileAtomicSync(path: string, record: PanIssueRecord): void {
  preserveCorruptRecordSync(path);
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf-8');
  renameSync(tmp, path);
  JSON.parse(readFileSync(path, 'utf-8')); // read-back verification; throws if the renamed file is unparseable
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
  const now = new Date().toISOString();
  const next: PanIssueRecord = {
    ...preserveCloseOutSync(path, record),
    issueId: issueId.toUpperCase(),
    schemaVersion: RECORD_SCHEMA_VERSION,
    created: record.created || now,
    updated: now,
  };
  writeRecordFileAtomicSync(path, next);
  return path;
}

/**
 * Workspace-scoped synchronous whole-record writer. Keep this call atomic: async
 * read-modify-write flows must take `withIssueRecordLock` before reading and
 * must not split this write behind an await.
 */
export function writeIssueRecordForWorkspaceSync(
  workspacePath: string,
  issueId: string,
  record: PanIssueRecord,
): string {
  // FR-3 (PAN-2372 WI-2): resolve the owning project so the write lands on the
  // canonical (migration-aware) record path, not a slot-local one. A null result
  // means the issue is unregistered; the path resolver then falls back to the
  // workspace .pan/records/ dir and we do NOT queue a state commit (no owning
  // project to commit on behalf of).
  const resolvedProject = resolveProjectForIssue(issueId);
  const path = getIssueRecordPathForWorkspace(workspacePath, issueId);
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const now = new Date().toISOString();
  const next: PanIssueRecord = {
    ...preserveCloseOutSync(path, record),
    issueId: issueId.toUpperCase(),
    schemaVersion: RECORD_SCHEMA_VERSION,
    created: record.created || now,
    updated: now,
  };
  writeRecordFileAtomicSync(path, next);
  if (resolvedProject) {
    // Re-homed swarm writes must travel to overdeck-state like every canonical
    // write, or a migrated-project record written here would never be committed.
    queueIssueRecordCommit(resolvedProject, issueId, path);
  }
  return path;
}

export async function readIssueRecord(
  project: ProjectConfig,
  issueId: string,
): Promise<PanIssueRecord | null> {
  const path = getIssueRecordPath(project, issueId);
  try {
    const raw = await fsp.readFile(path, 'utf-8');
    return JSON.parse(raw) as PanIssueRecord;
  } catch {
    return null;
  }
}

export function readIssueRecordSync(project: ProjectConfig, issueId: string): PanIssueRecord | null {
  const path = getIssueRecordPath(project, issueId);
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as PanIssueRecord;
  } catch {
    return null;
  }
}

export function readIssueRecordForWorkspaceSync(workspacePath: string, issueId: string): PanIssueRecord | null {
  const path = getIssueRecordPathForWorkspace(workspacePath, issueId);
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as PanIssueRecord;
  } catch {
    return null;
  }
}

// ─── Commit helper ────────────────────────────────────────────────────────────

export function queueIssueRecordCommit(
  project: ProjectConfig,
  issueId: string,
  recordPath: string,
): void {
  const basePath = getIssueRecordBasePath(project, issueId);
  queueAutoCommit({
    projectRoot: basePath,
    repoRoot: basePath,
    paths: [recordPath],
    subject: `chore(records): update ${issueId.toUpperCase()} per-issue record`,
  });
}

// ─── Owner-URI lease (ported from PAN-1908 records.ts) ─────────────────────────

/** Build this node's owner URI: pan://host[:port]. */
export function buildOwnUri(): string {
  const port = process.env.OVERDECK_PORT ? `:${process.env.OVERDECK_PORT}` : '';
  return `pan://${hostname()}${port}`;
}

export interface ClaimResult {
  ok: boolean;
  owner?: string;
}

export async function claimIssueOwner(
  project: ProjectConfig,
  issueId: string,
  ownUri: string = buildOwnUri(),
): Promise<ClaimResult> {
  const record = (await readIssueRecord(project, issueId)) ?? {
    issueId,
    schemaVersion: RECORD_SCHEMA_VERSION,
    pipeline: {
      issueId,
      reviewStatus: 'pending',
      testStatus: 'pending',
      readyForMerge: false,
      updatedAt: new Date().toISOString(),
    },
    closeOut: {
      usage: { byStage: {}, totals: {} },
      merges: [],
      ranOn: hostname(),
    },
  };

  if (record.owner && record.owner !== ownUri) {
    return { ok: false, owner: record.owner };
  }

  record.owner = ownUri;
  const recordPath = writeIssueRecordSync(project, issueId, record);
  queueIssueRecordCommit(project, issueId, recordPath);
  return { ok: true, owner: ownUri };
}

export async function clearIssueOwner(
  project: ProjectConfig,
  issueId: string,
): Promise<void> {
  const record = await readIssueRecord(project, issueId);
  if (!record) return;
  delete record.owner;
  const recordPath = writeIssueRecordSync(project, issueId, record);
  queueIssueRecordCommit(project, issueId, recordPath);
}

// ─── Record update helpers for mutable progress state ─────────────────────────

/** Ensure a base record exists for an issue. */
export async function ensureIssueRecord(
  project: ProjectConfig,
  issueId: string,
): Promise<PanIssueRecord> {
  const existing = await readIssueRecord(project, issueId);
  if (existing) return existing;
  const now = new Date().toISOString();
  return {
    issueId: issueId.toUpperCase(),
    schemaVersion: RECORD_SCHEMA_VERSION,
    created: now,
    updated: now,
    pipeline: {
      issueId: issueId.toUpperCase(),
      reviewStatus: 'pending',
      testStatus: 'pending',
      readyForMerge: false,
      updatedAt: now,
    },
    closeOut: {
      usage: { byStage: {}, totals: {} },
      merges: [],
      ranOn: hostname(),
    },
  };
}

export interface WriteStatusOverrideOptions {
  autoCommit?: boolean;
}

/** Write a single status override into the per-issue record. */
export async function writeStatusOverride(
  project: ProjectConfig,
  issueId: string,
  key: string,
  status: string,
  opts: WriteStatusOverrideOptions = {},
): Promise<void> {
  const existing = await readIssueRecord(project, issueId);
  if (existing?.statusOverrides?.[key] === status) return;
  const record = existing ?? (await ensureIssueRecord(project, issueId));
  record.statusOverrides = { ...(record.statusOverrides ?? {}), [key]: status };
  const recordPath = writeIssueRecordSync(project, issueId, record);
  if (opts.autoCommit !== false) {
    queueIssueRecordCommit(project, issueId, recordPath);
  }
}

/** Synchronous variant for legacy CLI call sites. */
export function writeStatusOverrideSync(
  project: ProjectConfig,
  issueId: string,
  key: string,
  status: string,
  opts: WriteStatusOverrideOptions = {},
): void {
  const existing = readIssueRecordSync(project, issueId);
  if (existing?.statusOverrides?.[key] === status) return;
  const record = existing ?? ensureIssueRecordSync(project, issueId);
  record.statusOverrides = { ...(record.statusOverrides ?? {}), [key]: status };
  const recordPath = writeIssueRecordSync(project, issueId, record);
  if (opts.autoCommit !== false) {
    queueIssueRecordCommit(project, issueId, recordPath);
  }
}

/** Synchronous variant that writes many overrides at once. */
export function writeStatusOverridesSync(
  project: ProjectConfig,
  issueId: string,
  overrides: Record<string, string>,
  opts: WriteStatusOverrideOptions = {},
): void {
  const existing = readIssueRecordSync(project, issueId);
  const nextOverrides = { ...(existing?.statusOverrides ?? {}), ...overrides };
  if (existing && JSON.stringify(existing.statusOverrides) === JSON.stringify(nextOverrides)) return;
  const record = existing ?? ensureIssueRecordSync(project, issueId);
  record.statusOverrides = nextOverrides;
  const recordPath = writeIssueRecordSync(project, issueId, record);
  if (opts.autoCommit !== false) {
    queueIssueRecordCommit(project, issueId, recordPath);
  }
}

/** Synchronous variant of ensureIssueRecord. */
export function ensureIssueRecordSync(project: ProjectConfig, issueId: string): PanIssueRecord {
  const path = getIssueRecordPath(project, issueId);
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as PanIssueRecord;
  } catch {
    const now = new Date().toISOString();
    return {
      issueId: issueId.toUpperCase(),
      schemaVersion: RECORD_SCHEMA_VERSION,
      created: now,
      updated: now,
      pipeline: {
        issueId: issueId.toUpperCase(),
        reviewStatus: 'pending',
        testStatus: 'pending',
        readyForMerge: false,
        updatedAt: now,
      },
      closeOut: {
        usage: { byStage: {}, totals: {} },
        merges: [],
        ranOn: hostname(),
      },
    };
  }
}

/** Append a session entry to the per-issue record. */
export async function appendSessionEntry(
  project: ProjectConfig,
  issueId: string,
  entry: ContinueSessionEntry,
  opts: WriteStatusOverrideOptions = {},
): Promise<void> {
  const record = await ensureIssueRecord(project, issueId);
  record.sessionHistory = [...(record.sessionHistory ?? []), entry];
  const recordPath = writeIssueRecordSync(project, issueId, record);
  if (opts.autoCommit !== false) {
    queueIssueRecordCommit(project, issueId, recordPath);
  }
}

/** Append a feedback entry to the per-issue record. */
export async function appendFeedbackEntry(
  project: ProjectConfig,
  issueId: string,
  entry: ContinueFeedbackEntry,
  opts: WriteStatusOverrideOptions = {},
): Promise<void> {
  const record = await ensureIssueRecord(project, issueId);
  record.feedback = [...(record.feedback ?? []), entry];
  const recordPath = writeIssueRecordSync(project, issueId, record);
  if (opts.autoCommit !== false) {
    queueIssueRecordCommit(project, issueId, recordPath);
  }
}

/** Store harness + model in the per-issue record. */
export async function writeAgentHarnessModel(
  project: ProjectConfig,
  issueId: string,
  harness: RuntimeName,
  model: string,
  opts: WriteStatusOverrideOptions = {},
): Promise<void> {
  const existing = await readIssueRecord(project, issueId);
  if (existing?.harness === harness && existing?.model === model) return;
  const record = existing ?? (await ensureIssueRecord(project, issueId));
  record.harness = harness;
  record.model = model;
  const recordPath = writeIssueRecordSync(project, issueId, record);
  if (opts.autoCommit !== false) {
    queueIssueRecordCommit(project, issueId, recordPath);
  }
}

/** Synchronous variant for legacy CLI spawn paths. */
export function writeAgentHarnessModelSync(
  project: ProjectConfig,
  issueId: string,
  harness: RuntimeName,
  model: string,
  opts: WriteStatusOverrideOptions = {},
): void {
  const existing = readIssueRecordSync(project, issueId);
  if (existing?.harness === harness && existing?.model === model) return;
  const record = existing ?? ensureIssueRecordSync(project, issueId);
  record.harness = harness;
  record.model = model;
  const recordPath = writeIssueRecordSync(project, issueId, record);
  if (opts.autoCommit !== false) {
    queueIssueRecordCommit(project, issueId, recordPath);
  }
}

// ─── Continue read-view ───────────────────────────────────────────────────────

/**
 * ContinueState-shaped projection of the per-issue record. Returned by
 * readRecordContinueViewSync so old continue callers can switch with minimal
 * churn. Returns null when no record file exists.
 */
export interface RecordContinueView {
  decisions: ContinueDecision[];
  hazards: ContinueHazard[];
  resumePoint: ContinueResumePoint | null;
  beadsMapping: ContinueBeadsMapping;
  sessionHistory: ContinueSessionEntry[];
  feedback: ContinueFeedbackEntry[];
  scopeDrift?: ScopeDriftRecord;
}

export function readRecordContinueViewSync(
  project: ProjectConfig,
  issueId: string,
): RecordContinueView | null {
  const record = readIssueRecordSync(project, issueId);
  if (!record) return null;
  return {
    decisions: record.decisions ?? [],
    hazards: record.hazards ?? [],
    resumePoint: record.resumePoint ?? null,
    beadsMapping: record.beadsMapping ?? {},
    sessionHistory: record.sessionHistory ?? [],
    feedback: record.feedback ?? [],
    scopeDrift: record.scopeDrift,
  };
}

// ─── Continue mutation helpers (sync) ────────────────────────────────────────

/** Append a session-history entry to the per-issue record (sync). */
export function appendSessionEntrySync(
  project: ProjectConfig,
  issueId: string,
  entry: ContinueSessionEntry,
): void {
  const record = ensureIssueRecordSync(project, issueId);
  record.sessionHistory = [...(record.sessionHistory ?? []), entry];
  const recordPath = writeIssueRecordSync(project, issueId, record);
  queueIssueRecordCommit(project, issueId, recordPath);
}

/** Append a feedback entry to the per-issue record (sync). */
export function appendFeedbackEntrySync(
  project: ProjectConfig,
  issueId: string,
  entry: ContinueFeedbackEntry,
): void {
  const record = ensureIssueRecordSync(project, issueId);
  record.feedback = [...(record.feedback ?? []), entry];
  const recordPath = writeIssueRecordSync(project, issueId, record);
  queueIssueRecordCommit(project, issueId, recordPath);
}

/** Clear all feedback entries in the per-issue record (sync). */
export function clearRecordFeedbackSync(
  project: ProjectConfig,
  issueId: string,
): void {
  const record = ensureIssueRecordSync(project, issueId);
  record.feedback = [];
  const recordPath = writeIssueRecordSync(project, issueId, record);
  queueIssueRecordCommit(project, issueId, recordPath);
}

/** Record advisory scope prediction drift in the per-issue record (sync). */
export function writeRecordScopeDriftSync(
  project: ProjectConfig,
  issueId: string,
  scopeDrift: ScopeDriftRecord,
): void {
  const record = ensureIssueRecordSync(project, issueId);
  record.scopeDrift = scopeDrift;
  const recordPath = writeIssueRecordSync(project, issueId, record);
  queueIssueRecordCommit(project, issueId, recordPath);
}

/** Write tiered execution override into the per-issue record (sync). Passing null clears the override. */
export function writeRecordTieredExecutionOverrideSync(
  project: ProjectConfig,
  issueId: string,
  override: 'on' | 'off' | null,
): void {
  const record = ensureIssueRecordSync(project, issueId);
  if (override === null) {
    delete record.tieredExecutionOverride;
  } else {
    record.tieredExecutionOverride = override;
  }
  const recordPath = writeIssueRecordSync(project, issueId, record);
  queueIssueRecordCommit(project, issueId, recordPath);
}

/** Write tiered execution override into the per-issue record (async). Passing null clears the override. */
export async function writeRecordTieredExecutionOverride(
  project: ProjectConfig,
  issueId: string,
  override: 'on' | 'off' | null,
): Promise<void> {
  const record = await ensureIssueRecord(project, issueId);
  if (override === null) {
    delete record.tieredExecutionOverride;
  } else {
    record.tieredExecutionOverride = override;
  }
  const recordPath = writeIssueRecordSync(project, issueId, record);
  queueIssueRecordCommit(project, issueId, recordPath);
}

/** Mark the durable pipeline journal as terminal after close-out (sync). */
export function markRecordPipelineClosedOutSync(
  project: ProjectConfig,
  issueId: string,
): void {
  const record = ensureIssueRecordSync(project, issueId);
  const now = new Date().toISOString();
  record.pipeline.closedOut = true;
  record.pipeline.closedOutAt = now;
  record.pipeline.readyForMerge = false;
  record.pipeline.verificationStatus = undefined;
  record.pipeline.mergeStatus = 'merged';
  record.pipeline.updatedAt = now;
  const recordPath = writeIssueRecordSync(project, issueId, record);
  queueIssueRecordCommit(project, issueId, recordPath);
}

// ─── Continue field setters ───────────────────────────────────────────────────

/** Write decisions into the per-issue record (sync). */
export function writeRecordDecisionsSync(
  project: ProjectConfig,
  issueId: string,
  decisions: ContinueDecision[],
  opts: WriteStatusOverrideOptions = {},
): void {
  const record = ensureIssueRecordSync(project, issueId);
  record.decisions = decisions;
  const recordPath = writeIssueRecordSync(project, issueId, record);
  if (opts.autoCommit !== false) {
    queueIssueRecordCommit(project, issueId, recordPath);
  }
}

/** Write decisions into the per-issue record (async). */
export async function writeRecordDecisions(
  project: ProjectConfig,
  issueId: string,
  decisions: ContinueDecision[],
  opts: WriteStatusOverrideOptions = {},
): Promise<void> {
  const record = await ensureIssueRecord(project, issueId);
  record.decisions = decisions;
  const recordPath = writeIssueRecordSync(project, issueId, record);
  if (opts.autoCommit !== false) {
    queueIssueRecordCommit(project, issueId, recordPath);
  }
}

/** Write hazards into the per-issue record (sync). */
export function writeRecordHazardsSync(
  project: ProjectConfig,
  issueId: string,
  hazards: ContinueHazard[],
  opts: WriteStatusOverrideOptions = {},
): void {
  const record = ensureIssueRecordSync(project, issueId);
  record.hazards = hazards;
  const recordPath = writeIssueRecordSync(project, issueId, record);
  if (opts.autoCommit !== false) {
    queueIssueRecordCommit(project, issueId, recordPath);
  }
}

/** Write hazards into the per-issue record (async). */
export async function writeRecordHazards(
  project: ProjectConfig,
  issueId: string,
  hazards: ContinueHazard[],
  opts: WriteStatusOverrideOptions = {},
): Promise<void> {
  const record = await ensureIssueRecord(project, issueId);
  record.hazards = hazards;
  const recordPath = writeIssueRecordSync(project, issueId, record);
  if (opts.autoCommit !== false) {
    queueIssueRecordCommit(project, issueId, recordPath);
  }
}

/** Write resumePoint into the per-issue record (sync). */
export function writeRecordResumePointSync(
  project: ProjectConfig,
  issueId: string,
  resumePoint: ContinueResumePoint | null,
  opts: WriteStatusOverrideOptions = {},
): void {
  const record = ensureIssueRecordSync(project, issueId);
  record.resumePoint = resumePoint;
  const recordPath = writeIssueRecordSync(project, issueId, record);
  if (opts.autoCommit !== false) {
    queueIssueRecordCommit(project, issueId, recordPath);
  }
}

/** Write resumePoint into the per-issue record (async). */
export async function writeRecordResumePoint(
  project: ProjectConfig,
  issueId: string,
  resumePoint: ContinueResumePoint | null,
  opts: WriteStatusOverrideOptions = {},
): Promise<void> {
  const record = await ensureIssueRecord(project, issueId);
  record.resumePoint = resumePoint;
  const recordPath = writeIssueRecordSync(project, issueId, record);
  if (opts.autoCommit !== false) {
    queueIssueRecordCommit(project, issueId, recordPath);
  }
}

/** Write beadsMapping into the per-issue record (sync). */
export function writeRecordBeadsMappingSync(
  project: ProjectConfig,
  issueId: string,
  beadsMapping: ContinueBeadsMapping,
  opts: WriteStatusOverrideOptions = {},
): void {
  const record = ensureIssueRecordSync(project, issueId);
  record.beadsMapping = beadsMapping;
  const recordPath = writeIssueRecordSync(project, issueId, record);
  if (opts.autoCommit !== false) {
    queueIssueRecordCommit(project, issueId, recordPath);
  }
}

/** Write beadsMapping into the per-issue record (async). */
export async function writeRecordBeadsMapping(
  project: ProjectConfig,
  issueId: string,
  beadsMapping: ContinueBeadsMapping,
  opts: WriteStatusOverrideOptions = {},
): Promise<void> {
  const record = await ensureIssueRecord(project, issueId);
  record.beadsMapping = beadsMapping;
  const recordPath = writeIssueRecordSync(project, issueId, record);
  if (opts.autoCommit !== false) {
    queueIssueRecordCommit(project, issueId, recordPath);
  }
}

// ─── Resolve project helper ───────────────────────────────────────────────────

/** Infer a minimal ProjectConfig from a workspace path (tests / fallback).
 *
 * Returns a config whose `path` is the workspace directory itself so that
 * record I/O falls back to `<workspace>/.pan/records/<issue>.json` when the
 * issue cannot be resolved via projects.yaml.
 */
export function getProjectConfigFromWorkspacePath(workspacePath: string): ProjectConfig {
  return { name: 'inferred', path: workspacePath };
}

export function resolveProjectForIssue(issueId: string): ProjectConfig | null {
  const resolved = resolveProjectFromIssueSync(issueId);
  if (!resolved) return null;
  return getProjectSync(resolved.projectKey);
}

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

import { existsSync, mkdirSync, readFileSync, writeFileSync, promises as fsp } from 'node:fs';
import { dirname, join } from 'node:path';
import { hostname } from 'node:os';

import { queueAutoCommit } from './auto-commit.js';
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

export interface PanIssueSwarmRecord {
  failedMergeBlock?: PanIssueSwarmFailedMergeBlock;
  slotAssignments?: PanIssueSwarmSlotAssignment[];
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

  decisions?: ContinueDecision[];
  hazards?: ContinueHazard[];
  resumePoint?: ContinueResumePoint | null;
  beadsMapping?: ContinueBeadsMapping;
  statusOverrides?: Record<string, string>;
  sessionHistory?: ContinueSessionEntry[];
  feedback?: ContinueFeedbackEntry[];
  scopeDrift?: ScopeDriftRecord;
  swarm?: PanIssueSwarmRecord;

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
 * Record path for an issue within a specific workspace directory.
 * Lives at `<workspacePath>/.pan/records/<issueId-lowercase>.json`.
 */
export function getIssueRecordPathForWorkspace(workspacePath: string, issueId: string): string {
  return join(workspacePath, '.pan', RECORD_DIRNAME, `${issueId.toLowerCase()}.json`);
}

/**
 * Record path for an issue. Lives in the workspace (feature branch) at
 * `.pan/records/<issueId-lowercase>.json` when the workspace can be resolved;
 * otherwise falls back to `<project.path>/.pan/records/<issueId-lowercase>.json`
 * (used in tests and non-worktree contexts).
 */
export function getIssueRecordPath(project: ProjectConfig, issueId: string): string {
  return join(getIssueRecordBasePath(project, issueId), '.pan', RECORD_DIRNAME, `${issueId.toLowerCase()}.json`);
}

/** Base directory for an issue record: workspace if it exists, else project root. */
export function getIssueRecordBasePath(project: ProjectConfig, issueId: string): string {
  const workspacePath = getIssueWorkspacePath(issueId);
  return workspacePath && existsSync(workspacePath) ? workspacePath : project.path;
}

// ─── Read / write ─────────────────────────────────────────────────────────────

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
    ...record,
    issueId: issueId.toUpperCase(),
    schemaVersion: RECORD_SCHEMA_VERSION,
    created: record.created || now,
    updated: now,
  };
  writeFileSync(path, JSON.stringify(next, null, 2), 'utf-8');
  return path;
}

export function writeIssueRecordForWorkspaceSync(
  workspacePath: string,
  issueId: string,
  record: PanIssueRecord,
): string {
  const path = getIssueRecordPathForWorkspace(workspacePath, issueId);
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const now = new Date().toISOString();
  const next: PanIssueRecord = {
    ...record,
    issueId: issueId.toUpperCase(),
    schemaVersion: RECORD_SCHEMA_VERSION,
    created: record.created || now,
    updated: now,
  };
  writeFileSync(path, JSON.stringify(next, null, 2), 'utf-8');
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

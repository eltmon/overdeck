/**
 * Continue State Module
 *
 * Replaces STATE.md with a structured `<issueId-lowercase>.vbrief.json` that
 * lives at `<projectRoot>/.pan/continues/<issueId-lowercase>.vbrief.json`.
 *
 * The scope vBRIEF stays clean ("here's what we're building"). The continue
 * file is the living session history: git state, decisions, hazards, resume
 * point, beads mapping, agent model, and a session log. It's written during
 * planning, updated on agent session start/end and on crash recovery, and
 * persists through completion for post-mortems.
 *
 * PAN-967 finished the migration: project-side continue files now live at
 * the canonical `.pan/continues/` path. Legacy `vbrief/<lifecycle>/continue-*`
 * files are read-only fallback for migration purposes only.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { mkdir, rename, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { Data, Effect } from 'effect';

import { getContinuesDir } from '../pan-dir/continues.js';

function uniqueTmpPath(path: string): string {
  return `${path}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`;
}

const activeContinueWriters = new Map<string, string>();
const pendingContinueWrites = new Map<string, Promise<void>>();

function assertContinueWriter(path: string, writerId: string): void {
  const owner = activeContinueWriters.get(path);
  if (owner && owner !== writerId) {
    throw new Error(`Continue-state writer conflict for ${path}: ${owner} already owns the write`);
  }
  activeContinueWriters.set(path, writerId);
}

function releaseContinueWriter(path: string, writerId: string): void {
  if (activeContinueWriters.get(path) === writerId) activeContinueWriters.delete(path);
}

export const CONTINUE_FILENAME_SUFFIX = '.vbrief.json';

/** Snapshot of git state at write time. */
export interface ContinueGitState {
  branch?: string;
  /** Short SHA for human readability. */
  sha?: string;
  /** Whether the working tree had uncommitted changes when written. */
  dirty?: boolean;
}

/** Single decision the agent (or planner) made and wants future agents to know. */
export interface ContinueDecision {
  /** Short identifier — e.g. "D1". */
  id: string;
  /** Free-form summary. */
  summary: string;
  /** ISO 8601 datetime, set on append. */
  recordedAt: string;
}

/** Risk/edge case the work agent should watch out for. */
export interface ContinueHazard {
  id: string;
  summary: string;
  /** Optional mitigation description. */
  mitigation?: string;
}

/** Where work should resume after a crash, restart, or session boundary. */
export interface ContinueResumePoint {
  /** Free-form description of what the next agent should do. */
  description: string;
  /** Optional bead ID the next agent should pick up. */
  beadId?: string;
  /** Optional file paths the next agent should read first. */
  filesToRead?: string[];
}

/** Mapping from plan item / acceptance criterion to bead ID(s). */
export interface ContinueBeadsMapping {
  [planItemId: string]: string[];
}

/** Specialist feedback entry stored on the continue file (Layer 1+). */
export interface ContinueFeedbackEntry {
  /** Sequence number — matches the NNN prefix of the legacy .planning/feedback/ filename. */
  seq: number;
  specialist: 'verification-gate' | 'review-agent' | 'test-agent' | 'inspect-agent' | 'uat-agent' | 'merge-agent';
  /** Outcome label (e.g. "changes-requested", "approved"). */
  outcome: string;
  /** ISO 8601 timestamp when feedback was written. */
  timestamp: string;
  /** Full markdown body of the feedback (frontmatter excluded). */
  markdownBody: string;
}

/** Reason a session ended or restarted. */
export type ContinueSessionReason =
  | 'planning'
  | 'start'
  | 'end'
  | 'resume'
  | 'crash-recovery'
  | 'feedback'
  | 'manual';

/** Single entry in the session history log. */
export interface ContinueSessionEntry {
  /** ISO 8601 datetime, set on append. */
  timestamp: string;
  /** Why this entry was created. */
  reason: ContinueSessionReason;
  /** Optional human-readable note. */
  note?: string;
  /** Agent model in use for this session (e.g. "claude-opus-4-7"). */
  agentModel?: string;
  /** Full text content for entries that capture a document (e.g. planning prompt). */
  content?: string;
  /** If this entry records a crash recovery, details about the crash. */
  crashInfo?: {
    detectedAt?: string;
    /** Free-form description of what we observed. */
    description?: string;
  };
}

/**
 * The continue state document. Structured replacement for STATE.md.
 *
 * The file lives at `<projectRoot>/.pan/continues/<issueId-lowercase>.vbrief.json`
 * and follows the dot-suffix convention so it's discoverable by file-pattern scans.
 */
export interface ContinueState {
  /** Schema version for future evolution. */
  version: '1';
  /** Issue ID this continue file is keyed to (e.g. "PAN-946"). */
  issueId: string;
  /** ISO 8601 datetime, set at first write. */
  created: string;
  /** ISO 8601 datetime, updated on every write. */
  updated: string;
  gitState: ContinueGitState;
  decisions: ContinueDecision[];
  hazards: ContinueHazard[];
  resumePoint: ContinueResumePoint | null;
  beadsMapping: ContinueBeadsMapping;
  /** Agent model for the most recent / current session. */
  agentModel?: string;
  sessionHistory: ContinueSessionEntry[];
  /** Pending specialist feedback for the work agent. Cleared at the start of each review cycle. */
  feedback?: ContinueFeedbackEntry[];
}

// PAN-1517: SwarmRuntime, SwarmSlotRuntime, and SynthesisOutput interfaces
// removed. The swarm runtime is gone — parallelism is now an in-context
// concern owned by the work agent (see roles/work.md "Parallel work via
// subagents"). Continue files written before this change may still carry a
// `swarmRuntime` field; the validator silently ignores unknown fields and the
// type definition is gone so callers can't observe it.

// ─────────────────────────────────────────────────────────────────────────────

/** Build the continue filename for a given issue ID (lowercase, no prefix).
 *
 * Canonical form: `<issueId-lowercase>.vbrief.json` (e.g. `pan-1014.vbrief.json`).
 * All callers normalize to lowercase so both `PAN-1014` and `pan-1014` resolve
 * to the same file — no duplicate files for case-variant issue IDs.
 */
export function continueFilename(issueId: string): string {
  return `${issueId.toLowerCase()}${CONTINUE_FILENAME_SUFFIX}`;
}

/** Build the absolute path for a continue file at the canonical project-side location. */
export function continueFilePath(projectRoot: string, issueId: string): string {
  return join(getContinuesDir(projectRoot), continueFilename(issueId));
}

/**
 * Atomically write the continue state to `<projectRoot>/.pan/continues/<issueId-lowercase>.vbrief.json`
 * using temp-file + rename. Sets `updated` to "now" and `created` if absent.
 */
export function writeContinueStateSync(projectRoot: string, issueId: string, state: ContinueState): void {
  const canonicalIssueId = issueId.toUpperCase();
  const path = continueFilePath(projectRoot, canonicalIssueId);
  const writerId = `continue-sync-${process.pid}`;
  assertContinueWriter(path, writerId);
  try {
    mkdirSync(getContinuesDir(projectRoot), { recursive: true });
    const now = new Date().toISOString();
    const next: ContinueState = {
      ...state,
      issueId: issueId.toUpperCase(),
      version: '1',
      created: state.created || now,
      updated: now,
    };
    const tmp = uniqueTmpPath(path);
    writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8');
    renameSync(tmp, path);
  } finally {
    releaseContinueWriter(path, writerId);
  }
}

/**
 * Read and validate the continue file for an issue. Returns null if the file
 * doesn't exist. Throws if the file exists but is invalid (corrupt JSON or
 * wrong shape) — callers should handle this rather than silently producing
 * a fresh state.
 */
export function readContinueStateSync(projectRoot: string, issueId: string): ContinueState | null {
  const path = continueFilePath(projectRoot, issueId);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in continue file ${path}: ${(err as Error).message}`);
  }
  validateContinueState(parsed, path);
  return parsed as ContinueState;
}

/**
 * Append a session entry to the continue file's `sessionHistory`. Creates a
 * fresh continue state if the file doesn't yet exist. Persists atomically.
 */
export function appendSessionEntrySync(
  projectRoot: string,
  issueId: string,
  entry: Omit<ContinueSessionEntry, 'timestamp'> & { timestamp?: string },
): ContinueState {
  const existing = readContinueStateSync(projectRoot, issueId);
  const now = new Date().toISOString();
  const fullEntry: ContinueSessionEntry = {
    ...entry,
    timestamp: entry.timestamp ?? now,
  };
  const next: ContinueState = existing
    ? { ...existing, sessionHistory: [...existing.sessionHistory, fullEntry] }
    : {
        version: '1',
        issueId: issueId.toUpperCase(),
        created: now,
        updated: now,
        gitState: {},
        decisions: [],
        hazards: [],
        resumePoint: null,
        beadsMapping: {},
        agentModel: entry.agentModel,
        sessionHistory: [fullEntry],
      };
  writeContinueStateSync(projectRoot, issueId, next);
  return next;
}

/**
 * Append a feedback entry to the continue file's `feedback[]`. Creates a fresh
 * continue state if the file doesn't yet exist. Persists atomically.
 */
export function appendFeedbackEntrySync(
  projectRoot: string,
  issueId: string,
  entry: ContinueFeedbackEntry,
): ContinueState {
  const existing = readContinueStateSync(projectRoot, issueId);
  const now = new Date().toISOString();
  const next: ContinueState = existing
    ? { ...existing, feedback: [...(existing.feedback ?? []), entry] }
    : {
        version: '1',
        issueId: issueId.toUpperCase(),
        created: now,
        updated: now,
        gitState: {},
        decisions: [],
        hazards: [],
        resumePoint: null,
        beadsMapping: {},
        feedback: [entry],
        sessionHistory: [],
      };
  writeContinueStateSync(projectRoot, issueId, next);
  return next;
}

/**
 * Clear all feedback entries from the continue file. Returns null if the file
 * doesn't exist. Persists atomically.
 */
export function clearFeedbackSync(projectRoot: string, issueId: string): ContinueState | null {
  const existing = readContinueStateSync(projectRoot, issueId);
  if (!existing) return null;
  const next: ContinueState = { ...existing, feedback: [] };
  writeContinueStateSync(projectRoot, issueId, next);
  return next;
}


async function writeContinueStateToFile(
  dir: string,
  issueId: string,
  stateOrUpdater: ContinueState | ((current: ContinueState | null) => ContinueState),
): Promise<void> {
  const path = continueFilePath(dir, issueId);

  // Serialize concurrent writes for the same path so read-modify-write sequences
  // in the same process don't race and drop mutations (PAN-977 review blocker).
  // When an updater callback is passed, we read the latest on-disk state AFTER
  // awaiting any prior pending write so the mutation merges against the most
  // recently committed document rather than a stale snapshot.
  const previous = pendingContinueWrites.get(path);
  const current = (async () => {
    if (previous) {
      await previous.catch(() => {});
    }
    const writerId = `continue-async-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}`;
    assertContinueWriter(path, writerId);
    try {
      const now = new Date().toISOString();
      let state: ContinueState;
      if (typeof stateOrUpdater === 'function') {
        const existing = await readContinueStateFromFile(dir, issueId);
        state = stateOrUpdater(existing);
      } else {
        state = stateOrUpdater;
      }
      const next: ContinueState = {
        ...state,
        issueId: issueId.toUpperCase(),
        version: '1',
        created: state.created || now,
        updated: now,
      };
      await mkdir(getContinuesDir(dir), { recursive: true });
      const tmp = uniqueTmpPath(path);
      await writeFile(tmp, JSON.stringify(next, null, 2), 'utf-8');
      await rename(tmp, path);
    } finally {
      releaseContinueWriter(path, writerId);
    }
  })();

  pendingContinueWrites.set(path, current);
  try {
    await current;
  } finally {
    if (pendingContinueWrites.get(path) === current) {
      pendingContinueWrites.delete(path);
    }
  }
}

/**
 * Async variant of `readContinueState`. Use this from dashboard server routes.
 */
async function readContinueStateFromFile(dir: string, issueId: string): Promise<ContinueState | null> {
  const path = continueFilePath(dir, issueId);
  if (!existsSync(path)) return null;
  const raw = await readFile(path, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in continue file ${path}: ${(err as Error).message}`);
  }
  validateContinueState(parsed, path);
  return parsed as ContinueState;
}

function validateContinueState(value: unknown, path: string): asserts value is ContinueState {
  if (!value || typeof value !== 'object') {
    throw new Error(`Continue file ${path} is not an object`);
  }
  const v = value as Record<string, unknown>;
  if (v.version !== '1') {
    throw new Error(`Continue file ${path} has unsupported version: ${String(v.version)}`);
  }
  if (typeof v.issueId !== 'string') {
    throw new Error(`Continue file ${path} missing issueId`);
  }
  if (typeof v.created !== 'string' || typeof v.updated !== 'string') {
    throw new Error(`Continue file ${path} missing created/updated timestamps`);
  }
  if (!Array.isArray(v.decisions) || !Array.isArray(v.hazards) || !Array.isArray(v.sessionHistory)) {
    throw new Error(`Continue file ${path} has malformed array fields`);
  }
  if (typeof v.beadsMapping !== 'object' || v.beadsMapping === null) {
    throw new Error(`Continue file ${path} has malformed beadsMapping`);
  }
  // feedback is optional — default to [] for files written before Layer 1
  if (v.feedback === undefined) {
    (v as Record<string, unknown>).feedback = [];
  } else if (!Array.isArray(v.feedback)) {
    throw new Error(`Continue file ${path} has malformed feedback array`);
  }

  // PAN-1517: swarmRuntime validation removed alongside the runtime itself.
  // Legacy `swarmRuntime` fields in pre-PAN-1517 continue files are silently
  // ignored — TypeScript can't see them via the type and no code reads them.
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
//
// Wraps the existing async continue-state APIs in typed Effect channels.
// `*Async` variants own the real fs/promises I/O and the in-process writer
// serialization, so the Effect wrappers simply lift their failures into a
// tagged error. Sync APIs (`writeContinueState`, `readContinueState`,
// `appendSessionEntry`, `appendFeedbackEntry`, `clearFeedback`) remain
// available for CLI callers.

/** Tagged error for continue-state Effect variants. */
export class ContinueStateError extends Data.TaggedError('ContinueStateError')<{
  readonly projectRoot: string;
  readonly issueId: string;
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

const liftContinueError = (
  projectRoot: string,
  issueId: string,
  operation: string,
  cause: unknown,
): ContinueStateError =>
  new ContinueStateError({
    projectRoot,
    issueId,
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });

/** Effect variant of `writeContinueStateToFile`. */
export const writeContinueState = (
  projectRoot: string,
  issueId: string,
  stateOrUpdater: ContinueState | ((current: ContinueState | null) => ContinueState),
): Effect.Effect<void, ContinueStateError> =>
  Effect.tryPromise({
    try: () => writeContinueStateToFile(projectRoot, issueId, stateOrUpdater),
    catch: (cause) => liftContinueError(projectRoot, issueId, 'writeContinueState', cause),
  });

/** Effect variant of `readContinueStateFromFile`. */
export const readContinueState = (
  projectRoot: string,
  issueId: string,
): Effect.Effect<ContinueState | null, ContinueStateError> =>
  Effect.tryPromise({
    try: () => readContinueStateFromFile(projectRoot, issueId),
    catch: (cause) => liftContinueError(projectRoot, issueId, 'readContinueState', cause),
  });

/** Effect variant of `appendSessionEntry`. Uses the sync API under the hood;
 * the failure mode is a writer-conflict throw, not async I/O. */
export const appendSessionEntry = (
  projectRoot: string,
  issueId: string,
  entry: Omit<ContinueSessionEntry, 'timestamp'> & { timestamp?: string },
): Effect.Effect<ContinueState, ContinueStateError> =>
  Effect.try({
    try: () => appendSessionEntrySync(projectRoot, issueId, entry),
    catch: (cause) => liftContinueError(projectRoot, issueId, 'appendSessionEntry', cause),
  });

/** Effect variant of `appendFeedbackEntry`. */
export const appendFeedbackEntry = (
  projectRoot: string,
  issueId: string,
  entry: ContinueFeedbackEntry,
): Effect.Effect<ContinueState, ContinueStateError> =>
  Effect.try({
    try: () => appendFeedbackEntrySync(projectRoot, issueId, entry),
    catch: (cause) => liftContinueError(projectRoot, issueId, 'appendFeedbackEntry', cause),
  });

/** Effect variant of `clearFeedback`. */
export const clearFeedback = (
  projectRoot: string,
  issueId: string,
): Effect.Effect<ContinueState | null, ContinueStateError> =>
  Effect.try({
    try: () => clearFeedbackSync(projectRoot, issueId),
    catch: (cause) => liftContinueError(projectRoot, issueId, 'clearFeedback', cause),
  });


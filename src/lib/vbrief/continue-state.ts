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

import { getContinuesDir } from '../pan-dir/continues.js';

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
  /** Swarm dispatch runtime state. Present only for swarm-mode issues. */
  swarmRuntime?: SwarmRuntime;
}

// ─── Swarm runtime types ─────────────────────────────────────────────────────

/** Runtime state for a single swarm slot. */
export interface SwarmSlotRuntime {
  slotId: number;
  itemId: string;
  itemTitle: string;
  sessionName: string;
  workspace: string;
  status: 'pending' | 'running' | 'merged' | 'failed';
  /** ISO 8601 datetime, set when the slot agent is dispatched. */
  dispatchedAt?: string;
  /** ISO 8601 datetime, set when the slot branch is merged into the feature branch. */
  mergedAt?: string;
}

/** Context update written by a synthesis agent before a convergence-point item is dispatched. */
export interface SynthesisOutput {
  /** Item ID this output targets (the downstream convergence item). */
  targetItemId: string;
  /** ISO 8601 datetime when synthesis was written. */
  writtenAt: string;
  /** Markdown context update the downstream work agent should read before starting. */
  contextUpdate: string;
}

/**
 * Swarm runtime state stored in the continue vBRIEF. Replaces the
 * `~/.panopticon/swarms/{issueId}.json` sidecar from PAN-970.
 */
export interface SwarmRuntime {
  /** Model used for slot agents. */
  model: string;
  /** Current dependency wave being dispatched. */
  currentWave?: number;
  /** Total dependency waves in the plan at dispatch time. */
  totalWaves?: number;
  /** Whether event/polling auto-advance is enabled. */
  autoAdvance?: boolean;
  autoAdvanceFailureCount?: number;
  autoAdvanceRetryAfter?: string;
  lastAutoAdvanceError?: string;
  /** Ready items intentionally held for a later dispatch cycle. */
  deferred?: Array<{ itemId: string; itemTitle: string }>;
  /** All slots dispatched across all dispatch cycles. */
  slots: SwarmSlotRuntime[];
  /** Synthesis agent output keyed by target item ID. */
  synthesisOutputs: Record<string, SynthesisOutput>;
  /** ISO 8601 datetime of first dispatch. */
  createdAt: string;
  /** ISO 8601 datetime of most recent update. */
  updatedAt: string;
}

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
export function writeContinueState(projectRoot: string, issueId: string, state: ContinueState): void {
  const canonicalIssueId = issueId.toUpperCase();
  const path = continueFilePath(projectRoot, canonicalIssueId);
  mkdirSync(getContinuesDir(projectRoot), { recursive: true });
  const now = new Date().toISOString();
  const next: ContinueState = {
    ...state,
    issueId: issueId.toUpperCase(),
    version: '1',
    created: state.created || now,
    updated: now,
  };
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8');
  renameSync(tmp, path);
}

/**
 * Read and validate the continue file for an issue. Returns null if the file
 * doesn't exist. Throws if the file exists but is invalid (corrupt JSON or
 * wrong shape) — callers should handle this rather than silently producing
 * a fresh state.
 */
export function readContinueState(projectRoot: string, issueId: string): ContinueState | null {
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
export function appendSessionEntry(
  projectRoot: string,
  issueId: string,
  entry: Omit<ContinueSessionEntry, 'timestamp'> & { timestamp?: string },
): ContinueState {
  const existing = readContinueState(projectRoot, issueId);
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
  writeContinueState(projectRoot, issueId, next);
  return next;
}

/**
 * Append a feedback entry to the continue file's `feedback[]`. Creates a fresh
 * continue state if the file doesn't yet exist. Persists atomically.
 */
export function appendFeedbackEntry(
  projectRoot: string,
  issueId: string,
  entry: ContinueFeedbackEntry,
): ContinueState {
  const existing = readContinueState(projectRoot, issueId);
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
  writeContinueState(projectRoot, issueId, next);
  return next;
}

/**
 * Clear all feedback entries from the continue file. Returns null if the file
 * doesn't exist. Persists atomically.
 */
export function clearFeedback(projectRoot: string, issueId: string): ContinueState | null {
  const existing = readContinueState(projectRoot, issueId);
  if (!existing) return null;
  const next: ContinueState = { ...existing, feedback: [] };
  writeContinueState(projectRoot, issueId, next);
  return next;
}

/**
 * Async variant of `writeContinueState`. Use this from dashboard server routes
 * (sync FS calls block the event loop).
 */
export async function writeContinueStateAsync(dir: string, issueId: string, state: ContinueState): Promise<void> {
  const path = continueFilePath(dir, issueId);
  const now = new Date().toISOString();
  const next: ContinueState = {
    ...state,
    issueId: issueId.toUpperCase(),
    version: '1',
    created: state.created || now,
    updated: now,
  };
  await mkdir(getContinuesDir(dir), { recursive: true });
  const tmp = path + '.tmp';
  await writeFile(tmp, JSON.stringify(next, null, 2), 'utf-8');
  await rename(tmp, path);
}

/**
 * Async variant of `readContinueState`. Use this from dashboard server routes.
 */
export async function readContinueStateAsync(dir: string, issueId: string): Promise<ContinueState | null> {
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

  if (v.swarmRuntime !== undefined) {
    validateSwarmRuntime(v.swarmRuntime, path);
  }
}

function validateSwarmRuntime(value: unknown, path: string): asserts value is SwarmRuntime {
  if (!value || typeof value !== 'object') {
    throw new Error(`Continue file ${path} has malformed swarmRuntime`);
  }
  const runtime = value as Record<string, unknown>;
  if (typeof runtime.model !== 'string') {
    throw new Error(`Continue file ${path} has malformed swarmRuntime.model`);
  }
  if (!Array.isArray(runtime.slots)) {
    throw new Error(`Continue file ${path} has malformed swarmRuntime.slots`);
  }
  if (!runtime.synthesisOutputs || typeof runtime.synthesisOutputs !== 'object' || Array.isArray(runtime.synthesisOutputs)) {
    throw new Error(`Continue file ${path} has malformed swarmRuntime.synthesisOutputs`);
  }
  if (typeof runtime.createdAt !== 'string' || typeof runtime.updatedAt !== 'string') {
    throw new Error(`Continue file ${path} has malformed swarmRuntime timestamps`);
  }
  for (const slot of runtime.slots) {
    if (!slot || typeof slot !== 'object') {
      throw new Error(`Continue file ${path} has malformed swarmRuntime slot`);
    }
    const s = slot as Record<string, unknown>;
    if (typeof s.slotId !== 'number' || typeof s.itemId !== 'string' || typeof s.itemTitle !== 'string' ||
        typeof s.sessionName !== 'string' || typeof s.workspace !== 'string' || typeof s.status !== 'string') {
      throw new Error(`Continue file ${path} has malformed swarmRuntime slot fields`);
    }
  }
  for (const output of Object.values(runtime.synthesisOutputs as Record<string, unknown>)) {
    if (!output || typeof output !== 'object') {
      throw new Error(`Continue file ${path} has malformed swarmRuntime synthesis output`);
    }
    const o = output as Record<string, unknown>;
    if (typeof o.targetItemId !== 'string' || typeof o.writtenAt !== 'string' || typeof o.contextUpdate !== 'string') {
      throw new Error(`Continue file ${path} has malformed swarmRuntime synthesis output fields`);
    }
  }
}


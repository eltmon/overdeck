/**
 * Continue state: the per-issue plan companion file (PAN-3917).
 *
 * Lives at `<planHome>/.pan/continues/<ISSUE>.xbrief.json` in the repo the plan
 * describes, and is committed on the feature branch by the agent that changes
 * it. It is the ONLY home for xBRIEF item status and item claims — there is no
 * record, no status-override map on a state branch, and nothing derivable is
 * stored here.
 *
 * `markItemDone` refuses to record a completion that git cannot corroborate:
 * a commit on the current branch must carry the `Item: <id>` trailer, and the
 * branch must not be ahead of its upstream.
 */

import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { XBriefDifficulty } from './types.js';

const execFileAsync = promisify(execFile);

export const CONTINUE_FILENAME_SUFFIX = '.xbrief.json';

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
  /** Optional xBRIEF item ID the next agent should pick up. */
  itemId?: string;
  /** Optional file paths the next agent should read first. */
  filesToRead?: string[];
}

/** Specialist feedback entry stored on the continue file (Layer 1+). */
export interface ContinueFeedbackEntry {
  /** Sequence number — matches the NNN prefix of the legacy .planning/feedback/ filename. */
  seq: number;
  specialist: 'verification-gate' | 'review-agent' | 'test-agent' | 'inspect-agent' | 'uat-agent' | 'merge-agent' | 'ci-monitor';
  /** Outcome label (e.g. "changes-requested", "approved"). */
  outcome: string;
  /** ISO 8601 timestamp when feedback was written. */
  timestamp: string;
  /** Full markdown body of the feedback (frontmatter excluded). */
  markdownBody: string;
}

/** Scope prediction drift recorded when actual changed files differ from xBRIEF metadata.files_scope. */
export interface ScopeDriftRecord {
  /** Files changed by the branch that did not match any declared files_scope entry. */
  outsideDeclaredScope: string[];
  /** Declared files_scope entries that matched no changed file. */
  declaredScopeUntouched: string[];
  /** The declared scope union used for comparison. */
  declaredScope: string[];
  /** Actual changed files compared against the declared scope. */
  actualChangedFiles: string[];
  /** ISO 8601 datetime when the drift comparison was recorded. */
  recordedAt: string;
}

export interface TierPromotionHistoryEntry {
  at: string;
  from: XBriefDifficulty;
  to: XBriefDifficulty;
  reason: string;
}

export interface TierOverride {
  effectiveDifficulty: XBriefDifficulty;
  promotions: number;
  history: TierPromotionHistoryEntry[];
}

export type TierOverridesMap = Record<string, TierOverride>;

/**
 * Retry attempts at the current effective difficulty (PAN-3858). Recorded by
 * the escalation handlers when an escalation decides to retry at the same
 * difficulty; cleared by a promotion. An entry whose difficulty no longer matches the item's effective
 * difficulty is treated as zero attempts.
 */
export interface TierRetryEntry {
  difficulty: XBriefDifficulty;
  attempts: number;
}

export type TierRetriesMap = Record<string, TierRetryEntry>;

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

/** Per-item progress: the task source of truth for an xBRIEF checklist. */
export interface ContinueItemState {
  /** xBRIEF item status, e.g. 'pending' | 'in_progress' | 'completed'. */
  status?: string;
  /** Agent id holding the claim, if any. */
  claimedBy?: string;
  /** ISO 8601 datetime the claim was taken. */
  claimedAt?: string;
  /** ISO 8601 datetime the item was verified done. */
  doneAt?: string;
}

/** Item id (or `itemId.subItemId`) → its progress. */
export type ContinueItemsMap = Record<string, ContinueItemState>;

/**
 * The continue state document. Structured replacement for STATE.md.
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
  /** Agent model for the most recent / current session. */
  agentModel?: string;
  sessionHistory: ContinueSessionEntry[];
  /** Pending specialist feedback for the work agent. Cleared at the start of each review cycle. */
  feedback?: ContinueFeedbackEntry[];
  /** Advisory scope prediction drift recorded at pan done. */
  scopeDrift?: ScopeDriftRecord;
  /** Effective difficulty overrides for tiered execution promotions. */
  tierOverrides?: TierOverridesMap;
  /** Per-item status and claims — the only home for xBRIEF item progress. */
  items?: ContinueItemsMap;
}

// ─── Durable I/O ──────────────────────────────────────────────────────────────

/** `<planHome>/.pan/continues/<ISSUE>.xbrief.json`. */
export function continueStatePath(planHome: string, issueId: string): string {
  return join(planHome, '.pan', 'continues', `${issueId.toUpperCase()}${CONTINUE_FILENAME_SUFFIX}`);
}

export function readContinueState(planHome: string, issueId: string): ContinueState | null {
  try {
    return JSON.parse(readFileSync(continueStatePath(planHome, issueId), 'utf-8')) as ContinueState;
  } catch {
    return null;
  }
}

function emptyState(issueId: string, now: string): ContinueState {
  return {
    version: '1',
    issueId: issueId.toUpperCase(),
    created: now,
    updated: now,
    gitState: {},
    decisions: [],
    hazards: [],
    resumePoint: null,
    sessionHistory: [],
  };
}

export function writeContinueState(planHome: string, issueId: string, state: ContinueState): void {
  const path = continueStatePath(planHome, issueId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...state, updated: new Date().toISOString() }, null, 2)}\n`, 'utf-8');
}

/** Read-modify-write on the continue file; creates it when absent. */
export function updateContinueState(
  planHome: string,
  issueId: string,
  mutate: (state: ContinueState) => ContinueState,
): ContinueState {
  const now = new Date().toISOString();
  const current = readContinueState(planHome, issueId) ?? emptyState(issueId, now);
  const next = mutate(current);
  writeContinueState(planHome, issueId, next);
  return next;
}

/** Flat `itemId` / `itemId.subItemId` → status map, for overlaying onto a spec. */
export function readItemStatuses(planHome: string, issueId: string): Record<string, string> {
  const items = readContinueState(planHome, issueId)?.items ?? {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(items)) {
    if (value?.status) out[key] = value.status;
  }
  return out;
}

/** Async twin of {@link readItemStatuses} for request paths. */
export async function readItemStatusesAsync(
  planHome: string,
  issueId: string,
): Promise<Record<string, string>> {
  let state: ContinueState | null = null;
  try {
    state = JSON.parse(await readFile(continueStatePath(planHome, issueId), 'utf-8')) as ContinueState;
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(state.items ?? {})) {
    if (value?.status) out[key] = value.status;
  }
  return out;
}

/** Set an item's (or sub-item's) status without any git verification. */
export function setItemStatus(
  planHome: string,
  issueId: string,
  itemKey: string,
  status: string,
): void {
  updateContinueState(planHome, issueId, (state) => ({
    ...state,
    items: { ...(state.items ?? {}), [itemKey]: { ...(state.items?.[itemKey] ?? {}), status } },
  }));
}

/** Record a claim on an item. Returns the stored claim. */
export function claimItem(
  planHome: string,
  issueId: string,
  itemId: string,
  agentId: string,
): ContinueItemState {
  const claimedAt = new Date().toISOString();
  const next = updateContinueState(planHome, issueId, (state) => ({
    ...state,
    items: {
      ...(state.items ?? {}),
      [itemId]: {
        ...(state.items?.[itemId] ?? {}),
        status: state.items?.[itemId]?.status ?? 'in_progress',
        claimedBy: agentId,
        claimedAt,
      },
    },
  }));
  return next.items![itemId];
}

export interface MarkItemDoneOptions {
  /** Trailer line a commit on the current branch must carry, e.g. `Item: w1-plan-home`. */
  requireTrailer: string;
  /** When true, the branch must not be ahead of its upstream. */
  requirePushed: boolean;
  /**
   * Repository roots to search for the corroborating commit. A polyrepo
   * workspace has one per repo and the item's work may live in any of them;
   * the plan home alone is the default.
   */
  repoRoots?: readonly string[];
}

export class ItemNotVerifiable extends Error {}

/** Escape a literal string for use inside a POSIX extended regular expression. */
function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

/**
 * The trailer search is line-anchored with `--grep -E` rather than git's
 * `%(trailers)`: git only treats the LAST paragraph as a trailer block, and the
 * commit convention puts `Item:` in a paragraph of its own above
 * `Co-Authored-By:`, where `%(trailers:key=Item)` finds nothing.
 */
async function hasTrailerCommit(repoRoot: string, trailer: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['log', '-n', '1', '--format=%H', '-E', `--grep=^${escapeRegExp(trailer)}[[:space:]]*$`],
      { cwd: repoRoot },
    );
    return stdout.trim().length > 0;
  } catch {
    // Not a git checkout, or an empty one: it corroborates nothing.
    return false;
  }
}

/** Commits on the current branch that the upstream has not seen yet. */
async function unpushedCommitCount(repoRoot: string): Promise<number> {
  let upstream: string;
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', '@{upstream}'], { cwd: repoRoot });
    upstream = stdout.trim();
  } catch {
    throw new ItemNotVerifiable(`the branch in ${repoRoot} has no upstream — push it before completing the item`);
  }
  const { stdout } = await execFileAsync('git', ['rev-list', '--count', `${upstream}..HEAD`], { cwd: repoRoot });
  return Number.parseInt(stdout.trim(), 10) || 0;
}

/**
 * Record an item as done, but only once git corroborates it: a commit in one of
 * the issue's repositories carries the `Item: <id>` trailer, and (when
 * required) THAT repository's branch is not ahead of its upstream. A polyrepo
 * issue carries its work in whichever repo the item touched, so every repo root
 * is searched; the continue file is written in the plan home either way. Throws
 * {@link ItemNotVerifiable} otherwise and writes nothing.
 */
export async function markItemDone(
  planHome: string,
  issueId: string,
  itemId: string,
  options: MarkItemDoneOptions,
): Promise<ContinueItemState> {
  const repoRoots = options.repoRoots?.length ? [...new Set(options.repoRoots)] : [planHome];
  let corroborating: string | null = null;
  for (const root of repoRoots) {
    if (await hasTrailerCommit(root, options.requireTrailer)) {
      corroborating = root;
      break;
    }
  }
  if (!corroborating) {
    throw new ItemNotVerifiable(
      `no commit in ${repoRoots.join(', ')} carries the trailer "${options.requireTrailer}" `
      + `— commit the work for ${itemId} first`,
    );
  }
  if (options.requirePushed) {
    const ahead = await unpushedCommitCount(corroborating);
    if (ahead > 0) {
      throw new ItemNotVerifiable(
        `the branch in ${corroborating} is ${ahead} commit(s) ahead of its upstream — push before completing ${itemId}`,
      );
    }
  }
  const doneAt = new Date().toISOString();
  const next = updateContinueState(planHome, issueId, (state) => ({
    ...state,
    items: {
      ...(state.items ?? {}),
      [itemId]: { ...(state.items?.[itemId] ?? {}), status: 'completed', doneAt },
    },
  }));
  return next.items![itemId];
}

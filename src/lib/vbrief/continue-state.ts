/**
 * Continue State Types (PAN-1919: fs-I/O retired to record.ts)
 *
 * This file is types-only. All durable read/write of continue state goes through
 * src/lib/pan-dir/record.ts. These interfaces remain here because several callers
 * import them as type annotations and the structural shape must stay stable.
 */

import type { VBriefDifficulty } from './types.js';

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
  specialist: 'verification-gate' | 'review-agent' | 'test-agent' | 'inspect-agent' | 'uat-agent' | 'merge-agent' | 'ci-monitor';
  /** Outcome label (e.g. "changes-requested", "approved"). */
  outcome: string;
  /** ISO 8601 timestamp when feedback was written. */
  timestamp: string;
  /** Full markdown body of the feedback (frontmatter excluded). */
  markdownBody: string;
}

/** Scope prediction drift recorded when actual changed files differ from vBRIEF metadata.files_scope. */
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
  from: VBriefDifficulty;
  to: VBriefDifficulty;
  reason: string;
}

export interface TierOverride {
  effectiveDifficulty: VBriefDifficulty;
  promotions: number;
  history: TierPromotionHistoryEntry[];
}

export type TierOverridesMap = Record<string, TierOverride>;

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
 * PAN-1919: durable state now lives in the per-issue record at
 * `.pan/records/<issue>.json`. This type is kept for structural compatibility
 * with callers that cast RecordContinueView → ContinueState.
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
  /** Advisory scope prediction drift recorded at pan done. */
  scopeDrift?: ScopeDriftRecord;
  /** Effective difficulty overrides for tiered execution promotions. */
  tierOverrides?: TierOverridesMap;
}

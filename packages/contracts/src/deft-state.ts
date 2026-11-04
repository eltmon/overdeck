/**
 * Deft Directive state for one issue, as the dashboard reads it (PAN-4849).
 *
 * The server builds `DeftIssueState` from the Directive files in the issue's
 * worktree (`src/lib/deft/state-reader.ts`); `DeftIssueSummary` is the
 * batched per-issue row the board and tree read.
 */

export type DeftScopeFolder = 'proposed' | 'pending' | 'active' | 'completed' | 'cancelled';

export interface DeftScopeItem {
  id: string;
  title: string;
  status: string;
  evidence?: { kind: string; pointer: string; recordedAt?: string; recordedBy?: string };
  disposition?: { disposition: string; reason?: string; provenanceKind?: string; actor?: string; recordedAt?: string };
}

export interface DeftScope {
  /** Repo-relative, e.g. `xbrief/active/x.xbrief.json`. */
  path: string;
  folder: DeftScopeFolder;
  planId: string;
  title: string;
  status: string;
  items: DeftScopeItem[];
  swarm?: { dependsOn: string[]; conflictGroup?: string; fileScope: string[] };
  handoffState?: string;
  deliveryDisposition?: string;
  prNumber?: number;
}

export type DeftEscalationType = 'cmd_approval' | 'design_decision' | 'approval' | 'resource' | 'external' | 'question';

export interface DeftEscalation {
  id: string;
  agentId: string;
  type: DeftEscalationType;
  title: string;
  body: string;
  createdAt: string;
  slaHours: number;
  dueAt: string;
  overdue: boolean;
  status: 'open' | 'resolved';
  dangerous: boolean;
  resolution?: { decision: string; resolvedAt: string; resolvedBy: string; note?: string; answer?: string };
}

export interface DeftHeartbeat {
  agentId: string;
  parentId: string;
  lastHeartbeatAt: string;
  lastMessage: string;
  phase: string;
  terminalState?: string;
  prNumber?: number;
  waitKind?: string;
}

export interface DeftDecisionRecord {
  id: string;
  decision: string;
  whyWinner: string;
  confidence: string;
  timestamp: string;
  activeScopeRefs: string[];
}

export interface DeftApprovedScope {
  planId: string;
  xbriefRelPath: string;
  approvedAt: string;
  fileScope: string[];
  humanApproval?: { kind: string; actor: string };
}

export interface DeftPolicy {
  raw: Record<string, unknown>;
  requireHumanMerge: boolean | 'unknown';
  reviewers: string[] | null;
  minGreptileConfidence: number;
}

export interface DeftSpecDrift {
  unresolved: Array<{ scopeId: string; reason: string; specImpact: string }>;
}

export interface DeftFinishLoopEntry {
  ts: string;
  phase: string;
  iteration: number;
  haltReason: string | null;
  message: string;
  prNumber: number | null;
}

export interface DeftGateRun {
  ts: string;
  target: string;
  exitCode: number;
  gates: Array<{ id: string; status: 'run' | 'skipped' | 'failed'; exitCode?: number; cause?: string }>;
}

export interface DeftCleanRecord {
  prNumber: number;
  headSha: string;
  cleanedAt: string;
}

export interface DeftIssueState {
  issueId: string;
  pipeline: 'deft';
  mode: 'temporary-install' | 'directive-project' | 'not-installed';
  scopes: DeftScope[];
  escalations: DeftEscalation[];
  heartbeats: DeftHeartbeat[];
  decisions: DeftDecisionRecord[];
  approvedScopes: DeftApprovedScope[];
  policy: DeftPolicy;
  specDrift: DeftSpecDrift;
  installDrift: string[];
  liftConflicts: string[];
  /** Last 50 lines, file order. */
  finishLoop: DeftFinishLoopEntry[];
  /** Last 50 `check_invocation` events. */
  gateRuns: DeftGateRun[];
  /** `greptile.json` or `.greptile/config.json` exists at the worktree root. */
  reviewerConfigPresent: boolean;
  cleanRecords: DeftCleanRecord[];
  /** `<repo-relative path>: <message>` for every file the reader skipped. */
  errors: string[];
}

export interface DeftIssueSummary {
  issueId: string;
  scopeCounts: Partial<Record<DeftScopeFolder, number>>;
  specDriftUnresolved: number;
  installDrift: number;
  handoffState: string | null;
  openEscalations: number;
}

/** One exit-predicate field of Deft's review cycle. */
export type DeftExitField = 'met' | 'unmet' | 'unknown';
/** Deft's own verdict names (`pr-watch/constants.ts`). */
export type DeftReviewVerdict = 'CLEAN' | 'NEW_P0_P1' | 'PENDING' | 'NO_REVIEWER_INSTALLED';

export interface DeftSeverityCounts {
  p0: number;
  p1: number;
  p2: number;
}

export interface DeftReviewRound {
  /** 1-based. */
  index: number;
  findings: DeftSeverityCounts;
  commentCount: number;
  fixCommit: { sha: string; subject: string; committedAt: string } | null;
  startedAt: string | null;
}

/** Deft's review cycle for one PR, reconstructed from PR data (PAN-4849 WI-20). */
export interface DeftReviewCycle {
  issueId: string;
  prNumber: number | null;
  headSha: string | null;
  reviewer: {
    present: boolean;
    name: 'greptile' | null;
    source: 'policy' | 'comment' | 'check_run' | 'config' | 'none';
    unsupported: string[];
  };
  verdict: DeftReviewVerdict;
  exit: {
    checkRun: DeftExitField;
    headSha: DeftExitField;
    lastReviewedCommit: DeftExitField;
    confidence: DeftExitField;
    noBlocking: DeftExitField;
    confidenceScore: number | null;
    minConfidence: number;
    lastReviewedSha: string | null;
    p0p1Remaining: number | null;
  };
  rounds: DeftReviewRound[];
  roundsReconstructed: true;
  lease: {
    owner: string;
    monitorAgentId: string;
    headSha: string | null;
    startedAt: string;
    expiresAt: string;
    endedAt: string | null;
    active: boolean;
  } | null;
  /** `pr-watch-*` heartbeats and those in phase polling or fixing. */
  heartbeats: DeftHeartbeat[];
  cleanRecords: DeftCleanRecord[];
  errors: string[];
}

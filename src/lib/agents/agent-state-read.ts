/**
 * Pure, dependency-light reads of on-disk agent state
 * (`~/.overdeck/agents/<id>/state.json`), plus the `AgentState` type itself.
 *
 * Split out of agent-state.ts (PAN-3917 circular-deps fixup, lint:circular).
 * agent-state.ts's WRITE side imports
 * `registry/feature-registry-population.ts`, which chains through
 * `memory/providers/*` → `costs/events.ts` → `overdeck/cost-sync.ts` →
 * `agents/tier-metrics.ts` → `agents/delivery.ts` → `agents.ts` — a cycle
 * that was already accepted debt before this split. Two new call sites
 * introduced by the PAN-3917 cut (`terminal-backends/tmux.ts` computing pane
 * tokens, `agents/queries.ts` after its old `overdeck/agent-state-sync.ts`
 * target was deleted) only need a READ, but importing all of agent-state.ts
 * for one would pull in that whole write-side chain and close a *new* cycle
 * back to whichever module imported them. This leaf has no path back into
 * that chain, so importing it cannot cycle.
 *
 * agent-state.ts re-exports everything here, so its many existing consumers
 * are unaffected — this is a structural split, not an API change.
 */
import { existsSync, readFileSync, readdirSync } from 'fs';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import type { RuntimeName } from '../runtimes/types.js';
import type { TerminalBackendName } from '../terminal-backends/types.js';
import { getOverdeckHome } from '../paths.js';
import { normalizeAgentId } from './identity.js';
import { isRole, type Role } from './role.js';

/**
 * Why an agent transitioned to `stopped` (PAN-3324).
 *
 * `'operator'` means a human asked for the stop — `pan kill`, `pan pause`, a
 * dashboard stop/pause action, or an explicit flywheel stop/pause/abort. Only
 * that cause sets `stoppedByUser`, and therefore only that cause engages the
 * operator-stop gate that suppresses autonomous re-drive.
 *
 * `'system'` covers every machinery-initiated stop: memory shedding, health
 * force-kills, stalled-review-parent reaping, corruption recovery, close-out,
 * and reconciliation of a process the OOM killer already took. These stops are
 * transient resource or liveness events, so autonomous recovery must stay
 * eligible. It is the default precisely so a caller that omits the cause can
 * never accidentally manufacture a permanent stall.
 */
export type AgentStopCause = 'operator' | 'system';

export interface AgentState {
  id: string;
  issueId: string;
  workspace: string;
  /**
   * The projects/workspaces registry row this agent belongs to (PAN-1990
   * AC-1/FR-4). Resolved from `issueId` at spawn time when not set
   * explicitly — undefined only when no workspace row exists for the issue
   * yet.
   */
  workspaceId?: string;
  /** Coding-agent harness this agent runs under (PAN-636). */
  harness?: RuntimeName;
  /** Unified role primitive (PAN-1048). */
  role: Role;
  /** Parent work agent that owns a swarm's gated orchestration loop. */
  foreman?: boolean;
  model: string;
  /**
   * The exact spawn key fed to the weighted-distribution model picker at spawn
   * (`${role}:${issueId}`), persisted so the dashboard MODEL inspector (PAN-2053)
   * can show the faithful FNV-1a derivation without re-guessing the key's form.
   * Undefined for scalar-role agents and for agents spawned before PAN-2053.
   */
  modelSpawnKey?: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  startedAt: string;
  lastActivity?: string;
  lastResumeAt?: string;
  /**
   * Tri-state kickoff delivery signal for work-agent lifecycle monitoring:
   * undefined = legacy/pre-feature agent or non-applicable role;
   * false = spawned but kickoff delivery not yet confirmed;
   * true = kickoff delivery confirmed.
   */
  kickoffDelivered?: boolean;
  stoppedAt?: string;
  /** True when the agent was stopped with `cause: 'operator'` — `pan kill`,
   *  `pan pause`, or a dashboard stop/pause action. Cleared on resume. Read by
   *  deacon's autoResumeStoppedWorkAgents to distinguish a deliberate operator
   *  stop from a crash/orphan. PAN-3324: machinery-initiated stops (memory
   *  shedding, health force-kills, stalled-parent reaping, OOM reconciliation)
   *  pass `cause: 'system'` and must never set this — doing so latches the
   *  operator-stop gate and permanently suppresses autonomous recovery. */
  stoppedByUser?: boolean;
  stoppedByPause?: boolean;
  paused?: boolean;
  pausedReason?: string;
  pausedAt?: string;
  /**
   * PAN-3911: `'operator'` when the operator set this pause (`pan pause`, the
   * dashboard Pause button). Machine pauses (memory shed, post-merge, Fly
   * migration, escalations, scheduler yields) leave it unset, so only an
   * operator pause of the issue's work agent reads as an issue pause
   * (`getIssuePause`). Cleared with the pause.
   */
  pausedBy?: 'operator';
  /**
   * PAN-3911: review and test agents of this issue that the operator's issue
   * pause stopped. `pan unpause` reads it to re-request the review (or re-run
   * the tests) through the normal dispatch door. Cleared with the pause.
   */
  pauseStoppedAgents?: string[];
  /**
   * PAN-2507: true when this work agent was paused by the preemptive scheduler
   * (yielded to free capacity for an advancing dispatch), as distinct from an
   * operator pause. Reuses `paused: true` so every existing no-resume gate
   * protects the yielded agent; this flag lets the deacon resume yielded agents
   * oldest-first and lets `pan unpause` self-clear the yield attribution.
   */
  yieldedByScheduler?: boolean;
  /** PAN-2507: ISO timestamp of the yield (oldest-first resume ordering). */
  yieldedAt?: string;
  /**
   * PAN-2507: ISO timestamp of the most recent resume-from-yield. Enforces the
   * re-yield cooldown (an agent just resumed from a yield may not be re-yielded
   * until `yield_cooldown_secs` elapse). Survives unpause (it is a cooldown
   * tracker, not a pause field).
   */
  lastYieldResumeAt?: string;
  troubled?: boolean;
  troubledAt?: string;
  consecutiveFailures?: number;
  firstFailureInRunAt?: string;
  lastFailureAt?: string;
  lastFailureReason?: string;
  lastFailureNextRetryAt?: string;
  branch?: string; // Git branch name for this agent
  costSoFar?: number;
  sessionId?: string; // For resuming sessions after handoff

  // Work type system (PAN-118). 'retained-transcripts' is the tombstone phase
  // (PAN-3465): removeAgent keeps the row for transcript linkage after the
  // state dir is retired — such rows are not live agents.
  phase?: 'exploration' | 'implementation' | 'testing' | 'documentation' | 'review-response' | 'planning' | 'synthesis' | 'retained-transcripts';
  workType?: string; // Current work type ID

  /**
   * Whether this work agent was launched with the experimental Claude Code
   * Channels prompt-delivery path enabled. Set at launch time after the
   * eligibility check; never mutated after. Read by deliverAgentMessage to
   * decide whether to attempt the bridge socket before falling back to
   * sendKeysAsync. Absent or false means tmux-only delivery (current default).
   */
  channelsEnabled?: boolean;
  /** True when this work agent was launched through the PTY supervisor wrapper. */
  supervisorEnabled?: boolean;
  /**
   * Terminal backend the agent's pane lives on, and the backend-native pane
   * handle, written as soon as the pane exists (PAN-3917 W12). A spawn that
   * fails AFTER the pane is created must still be addressable — without these
   * a later stop has nothing to close, and a failed launch left `starting` with
   * no record of where its pane was.
   */
  backend?: TerminalBackendName;
  paneId?: string;
  /**
   * Backend-native terminal handle of that pane (Herdr `term_…`). Herdr's
   * `terminal attach` takes it for every agent, including pane-bound harnesses
   * that have no Herdr agent record (PAN-3928). Absent on pre-PAN-3928 agents.
   */
  terminalId?: string;
  /**
   * Delivery method for agent messages. 'auto' tries supervisor, then channels,
   * then tmux; explicit socket methods are strict (throw on failure); 'tmux'
   * bypasses socket transports entirely.
   */
  deliveryMethod?: 'auto' | 'supervisor' | 'channels' | 'tmux';

  /**
   * Short HEAD sha (8 chars) of the workspace at the moment this role run was
   * spawned. Used by the reactive scheduler's activeRoleRunExists() to detect a
   * stale/zombie role session: if the workspace HEAD has advanced past this
   * marker, the existing session ran against old code and must not block a
   * fresh re-dispatch for the new HEAD. Set for non-work roles in spawnRun.
   */
  roleRunHead?: string;

  /** Flywheel run that spawned this agent, if any. Absent for operator-started agents (PAN-1812). */
  flywheelRunId?: string;
  /** Origin token identifying the command or autonomous path that started this agent. */
  startedBy?: string;

  /** True when a planning session was launched with `pan plan --auto`. */
  auto?: boolean;

  /** Review-convoy metadata for server-side reviewer lifecycle monitoring. */
  reviewSubRole?: string;
  reviewRunId?: string;
  reviewOutputPath?: string;
  reviewSynthesisAgentId?: string;
  reviewDeadlineAt?: string;
  /**
   * #3853: the operator asked for the review parent's current run (a forced
   * re-review). Rewritten on every dispatch, so an automatic cycle clears it.
   */
  reviewOperatorRequested?: boolean;
  reviewMonitorSignaled?: 'ready' | 'failed' | 'timeout';
  /** Number of times Deacon has respawned this convoy reviewer (PAN-1806). */
  reviewRetryAttempt?: number;
  /** Path to the run's context manifest, used by missing-reviewer recovery. */
  reviewContextManifestPath?: string;
  hostOverride?: boolean;

  /** Inspect sub-role for inspect-* agents (PAN-1834). */
  inspectSubRole?: string;

  /** Registered swarm slot index for per-item work agents. */
  slotIndex?: number;
  /** xBRIEF item id explicitly assigned to this registered swarm slot. */
  slotItemId?: string;
  /** Conversation or agent that spawned this worker (PAN-3920). */
  parentId?: string;
}

/**
 * The one answer to "did the operator set this pause?" (PAN-3911): a pause
 * written by `pan pause` or the dashboard Pause button, which stamp
 * `pausedBy: 'operator'`. Machine pauses (memory shed, post-merge, Fly
 * migration, escalations) and scheduler yields never stamp it, and a machine
 * pause written over an operator pause keeps it. `getIssuePause` and the
 * feedback ladder's `classifyPause` both read this.
 */
export function isOperatorPause(state: Pick<AgentState, 'paused' | 'pausedBy'>): boolean {
  return state.paused === true && state.pausedBy === 'operator';
}

export function getAgentDir(agentId: string): string {
  return join(getOverdeckHome(), 'agents', agentId);
}

export function getAgentStateFilePath(agentId: string): string {
  return join(getOverdeckHome(), 'agents', agentId, 'state.json');
}

export function cleanAgentState(raw: AgentState): AgentState {
  return {
    id: raw.id,
    issueId: raw.issueId,
    workspace: raw.workspace,
    harness: raw.harness,
    role: raw.role,
    model: raw.model,
    status: raw.status,
    startedAt: raw.startedAt,
    lastActivity: raw.lastActivity,
    lastResumeAt: raw.lastResumeAt,
    kickoffDelivered: raw.kickoffDelivered,
    stoppedAt: raw.stoppedAt,
    stoppedByUser: raw.stoppedByUser,
    stoppedByPause: raw.stoppedByPause,
    paused: raw.paused,
    pausedReason: raw.pausedReason,
    pausedAt: raw.pausedAt,
    pausedBy: raw.pausedBy,
    pauseStoppedAgents: raw.pauseStoppedAgents,
    yieldedByScheduler: raw.yieldedByScheduler,
    yieldedAt: raw.yieldedAt,
    lastYieldResumeAt: raw.lastYieldResumeAt,
    troubled: raw.troubled,
    troubledAt: raw.troubledAt,
    consecutiveFailures: raw.consecutiveFailures,
    firstFailureInRunAt: raw.firstFailureInRunAt,
    lastFailureAt: raw.lastFailureAt,
    lastFailureReason: raw.lastFailureReason,
    lastFailureNextRetryAt: raw.lastFailureNextRetryAt,
    branch: raw.branch,
    costSoFar: raw.costSoFar,
    sessionId: raw.sessionId,
    roleRunHead: raw.roleRunHead,
    flywheelRunId: raw.flywheelRunId,
    startedBy: raw.startedBy,
    channelsEnabled: raw.channelsEnabled,
    supervisorEnabled: raw.supervisorEnabled,
    backend: raw.backend,
    paneId: raw.paneId,
    terminalId: raw.terminalId,
    deliveryMethod: raw.deliveryMethod,
    reviewSubRole: raw.reviewSubRole,
    reviewRunId: raw.reviewRunId,
    reviewOutputPath: raw.reviewOutputPath,
    reviewSynthesisAgentId: raw.reviewSynthesisAgentId,
    reviewDeadlineAt: raw.reviewDeadlineAt,
    reviewOperatorRequested: raw.reviewOperatorRequested,
    reviewMonitorSignaled: raw.reviewMonitorSignaled,
    reviewRetryAttempt: raw.reviewRetryAttempt,
    reviewContextManifestPath: raw.reviewContextManifestPath,
    hostOverride: raw.hostOverride,
    inspectSubRole: raw.inspectSubRole,
    slotIndex: raw.slotIndex,
    slotItemId: raw.slotItemId,
    parentId: raw.parentId,
  };
}

function parseAgentState(content: string, normalizedId: string): AgentState | null {
  try {
    const state = JSON.parse(content) as Partial<AgentState>;
    if (!isRole(state.role)) {
      // Roleless states are invisible to getAgentStateSync; cleanup is handled
      // by warnOnBareNumericIssueIds / dropLegacyAgentStatesMissingRoleAsync.
      return null;
    }
    if (!state.id) state.id = normalizedId;
    return cleanAgentState(state as AgentState);
  } catch {
    return null;
  }
}

/**
 * Read one agent's `state.json`. Returns null when the file is absent, unparsable, or
 * roleless; throws only when reading an existing file fails (e.g. EACCES).
 */
export function getAgentState(agentId: string): AgentState | null {
  const normalizedId = normalizeAgentId(agentId);
  const stateFile = getAgentStateFilePath(normalizedId);
  if (!existsSync(stateFile)) return null;
  return parseAgentState(readFileSync(stateFile, 'utf8'), normalizedId);
}

/**
 * Every agent's state, scanned directly from each `~/.overdeck/agents/<id>/state.json`
 * (PAN-3917: the SQLite mirror is gone — the per-agent JSON file is the only
 * copy). Roleless/unparsable entries are skipped, matching getAgentStateSync.
 */
export function listAgentStatesSync(): AgentState[] {
  let entries: string[];
  try {
    // getOverdeckHome() reads process.env.OVERDECK_HOME at call time; a
    // module-frozen dir constant would resolve before a test (or a later env
    // change) can override it, so this always resolves dynamically to match
    // getAgentStateSync/saveAgentStateSync — a scan taken after OVERDECK_HOME
    // changes must not silently see the wrong (or no) directory.
    entries = readdirSync(join(getOverdeckHome(), 'agents'));
  } catch {
    return [];
  }
  const states: AgentState[] = [];
  for (const name of entries) {
    const state = getAgentState(name);
    if (state) states.push(state);
  }
  return states;
}

/**
 * Async form of {@link listAgentStatesSync} for request paths (PAN-3920).
 * `skip` drops directory names before any read (e.g. `conv-*`), and a
 * `state.json` removed mid-scan (agent GC) is skipped rather than thrown.
 */
export async function listAgentStatesAsync(options: { skip?: (name: string) => boolean } = {}): Promise<AgentState[]> {
  let entries: string[];
  try {
    entries = await readdir(join(getOverdeckHome(), 'agents'));
  } catch {
    return [];
  }
  const states = await Promise.all(entries
    .filter((name) => !options.skip?.(name))
    .map(async (name) => {
      const normalizedId = normalizeAgentId(name);
      try {
        return parseAgentState(await readFile(getAgentStateFilePath(normalizedId), 'utf8'), normalizedId);
      } catch {
        return null;
      }
    }));
  return states.filter((state): state is AgentState => state !== null);
}

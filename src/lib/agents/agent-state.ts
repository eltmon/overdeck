import { readdir, writeFile as writeFileAsync, mkdir as mkdirAsync } from 'fs/promises';
import { join } from 'path';
import { Effect } from 'effect';
import type { RuntimeName } from '../runtimes/types.js';
import { AGENTS_DIR, getOverdeckHome } from '../paths.js';
import { FsError } from '../errors.js';
import { emitActivityEntrySync } from '../activity-logger.js';
import { resolveAutoResumeConfigForIssue } from '../cloister/auto-resume-config.js';
import { getRollbackAgentStatePath, readRollbackAgentStateSync, writeRollbackAgentStateSync } from '../overdeck/agent-rollback-state.js';
import { getOverdeckAgentStateSync, saveOverdeckAgentStateSync, listOverdeckAgentStatesSync } from '../overdeck/agent-state-sync.js';
import { readAgentHarnessModelRecordSync, writeAgentHarnessModelRecordSync } from '../overdeck/agent-record-sync.js';
import { logAgentLifecycleSync } from '../persistent-logger.js';
import { recordFeatureRegistryLifecycle } from '../registry/feature-registry-population.js';
import { appendAgentPlaneLifecycle } from '../pan-dir/agents.js';
import { normalizeAgentId } from './identity.js';
import { removeAgentStateDir } from './state-dir-removal.js';
import { registerPipelineTelemetryAgentReader } from '../telemetry/pipeline-agent-reader.js';
import { isRole } from './role.js';
import type { Role } from './role.js';

export type { Role } from './role.js';

export const SESSION_EXITED_BEFORE_KICKOFF = 'session-exited-before-kickoff';

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
   * AC-1/FR-4). Resolved from `issueId` at persistence time
   * (agent-state-sync.ts) when not set explicitly — undefined only when no
   * workspace row exists for the issue yet.
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
}

const toAgentFsError = (operation: string, path: string, cause: unknown): FsError =>
  new FsError({ operation, path, cause });

export function getAgentDir(agentId: string): string {
  return join(getOverdeckHome(), 'agents', agentId);
}

export function getAgentStateFilePath(agentId: string): string {
  return getRollbackAgentStatePath(agentId);
}

/**
 * PAN-1985: wipe agent state directories for an issue, optionally scoped to
 * a role prefix. Used by the restart-fresh and review-restart paths to clean
 * state before respawning — the new agent then reads `.pan/continue.json`,
 * the xBRIEF, the beads, and the branch to pick up where the prior run left
 * off. Refuses to run against an empty or unsafe id.
 *
 * - `rolePrefix` omitted: wipes only the work agent dir (`agent-<id>`).
 *   Specialist dirs (review, test, ship, etc.) are left alone.
 * - `rolePrefix` set (e.g. 'review'): wipes the role parent dir
 *   (`agent-<id>-<prefix>`) AND any sub-roles (`agent-<id>-<prefix>-<anything>`),
 *   leaving the work agent dir alone.
 *
 * Refuses to operate on the root `AGENTS_DIR` itself or on paths that escape
 * it; the `validateAgentId` guard below enforces a conservative id grammar.
 */
export async function wipeAgentStateDirs(
  issueId: string,
  opts: { rolePrefix?: string } = {},
): Promise<{ removed: string[]; path: string }> {
  if (!issueId || !/^[A-Za-z]+-\d+$/.test(issueId)) {
    throw new Error(`wipeAgentStateDirs: invalid issueId "${issueId}"`);
  }
  if (opts.rolePrefix !== undefined && !/^[a-z][a-z0-9-]*$/.test(opts.rolePrefix)) {
    throw new Error(`wipeAgentStateDirs: invalid rolePrefix "${opts.rolePrefix}"`);
  }
  const issueLower = issueId.toLowerCase();
  const dirPath = join(AGENTS_DIR, `agent-${issueLower}${opts.rolePrefix ? `-${opts.rolePrefix}` : ''}`);
  let entries: string[];
  try {
    entries = await readdir(AGENTS_DIR);
  } catch {
    return { removed: [], path: dirPath };
  }
  let targets: string[];
  if (opts.rolePrefix) {
    const base = `agent-${issueLower}-${opts.rolePrefix}`;
    targets = entries.filter((name) => name === base || name.startsWith(`${base}-`));
  } else {
    const work = `agent-${issueLower}`;
    targets = entries.filter((name) => name === work);
  }
  for (const name of targets) {
    try {
      await removeAgentStateDir(join(AGENTS_DIR, name));
    } catch { /* non-fatal — best-effort wipe */ }
  }
  return { removed: targets, path: dirPath };
}

export { isRole } from './role.js';

function cleanAgentState(raw: AgentState): AgentState {
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
    deliveryMethod: raw.deliveryMethod,
    reviewSubRole: raw.reviewSubRole,
    reviewRunId: raw.reviewRunId,
    reviewOutputPath: raw.reviewOutputPath,
    reviewSynthesisAgentId: raw.reviewSynthesisAgentId,
    reviewDeadlineAt: raw.reviewDeadlineAt,
    reviewMonitorSignaled: raw.reviewMonitorSignaled,
    reviewRetryAttempt: raw.reviewRetryAttempt,
    reviewContextManifestPath: raw.reviewContextManifestPath,
    hostOverride: raw.hostOverride,
    inspectSubRole: raw.inspectSubRole,
    slotIndex: raw.slotIndex,
    slotItemId: raw.slotItemId,
  };
}

function parseAgentState(content: string, normalizedId: string): AgentState | null {
  try {
    const state = JSON.parse(content) as Partial<AgentState>;
    if (!isRole(state.role)) {
      // Roleless states are invisible to getAgentState; cleanup is handled
      // by warnOnBareNumericIssueIds / dropLegacyAgentStatesMissingRoleAsync.
      return null;
    }
    if (!state.id) state.id = normalizedId;
    return cleanAgentState(state as AgentState);
  } catch {
    return null;
  }
}

export function getAgentStateSync(agentId: string): AgentState | null {
  const normalizedId = normalizeAgentId(agentId);

  const overdeckState = getOverdeckAgentStateSync(normalizedId);
  if (overdeckState) return cleanAgentState(overdeckState);

  const state = readRollbackAgentStateSync(normalizedId, parseAgentState);
  if (!state) return null;

  // PAN-1919: harness/model are no longer sourced from state.json. Merge from
  // the per-issue git-tracked record so cross-machine pickup works.
  if (state.issueId) {
    const record = readAgentHarnessModelRecordSync(state.issueId);
    if (record?.harness) state.harness = record.harness;
    if (record?.model) state.model = record.model;
  }

  return state;
}

registerPipelineTelemetryAgentReader(getAgentStateSync);

export const getAgentState = (agentId: string): Effect.Effect<AgentState | null, FsError> => {
  return Effect.try({
    try: () => getAgentStateSync(agentId),
    catch: (cause) => toAgentFsError('read', `agents-db:${agentId}`, cause),
  });
};

function prepareAgentStateForSave(state: AgentState): AgentState {
  if (state.status === 'running' || state.status === 'starting') {
    delete state.stoppedAt;
  } else if (state.status === 'stopped' && !state.stoppedAt) {
    state.stoppedAt = new Date().toISOString();
  }
  return state;
}

async function recordDurableStoppedTransition(
  state: AgentState,
  oldStatus: AgentState['status'] | undefined,
): Promise<void> {
  if (state.status !== 'stopped' || oldStatus === 'stopped') return;
  try {
    await appendAgentPlaneLifecycle(state, {
      at: state.stoppedAt ?? new Date().toISOString(),
      event: 'stopped',
    });
  } catch (error) {
    console.warn(
      `[agents] Could not append durable stopped lifecycle for ${state.id}: `
      + `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function writeAgentStateJsonSync(state: AgentState): void {
  writeRollbackAgentStateSync(state, (clean) => JSON.stringify(cleanAgentState(clean), null, 2));
}

export function saveAgentStateSync(state: AgentState): void {
  // Detect status transition for audit trail
  const oldState = getAgentStateSync(state.id);
  const oldStatus = oldState?.status;

  prepareAgentStateForSave(state);

  saveOverdeckAgentStateSync(state);
  writeAgentStateJsonSync(state);

  // PAN-1919: mirror harness/model into the per-issue git-tracked record so
  // they travel with the branch. Done synchronously at save time; auto-commit
  // is suppressed here because spawn paths explicitly queue the commit.
  if (state.issueId && state.harness && state.model) {
    try {
      writeAgentHarnessModelRecordSync(state.issueId, state.harness, state.model);
    } catch (err) {
      console.warn(`[agents] Failed to mirror harness/model to record for ${state.issueId}: ${(err as Error).message}`);
    }
  }

  void recordDurableStoppedTransition(state, oldStatus);
  if (oldStatus && oldStatus !== state.status) {
    logAgentLifecycleSync(state.id, `status changed: ${oldStatus} → ${state.status} (saveAgentState)`);
  }
}

/**
 * Persist observed harness activity through the agent-state write door without
 * re-running lifecycle side effects such as harness/model record mirroring.
 */
export function recordAgentActivitySync(
  agentId: string,
  activity: { at?: string; costSoFar?: number },
): boolean {
  const state = getAgentStateSync(agentId);
  if (!state) return false;

  state.lastActivity = activity.at ?? new Date().toISOString();
  if (activity.costSoFar !== undefined && Number.isFinite(activity.costSoFar)) {
    state.costSoFar = activity.costSoFar;
  }
  // An activity write is telemetry — it must never take down the caller. On
  // 2026-08-13 an unhandled SQLITE_BUSY here crashed the PAN-3668 review
  // orchestrator's app-server host mid-synthesis. The JSON mirror still runs
  // when the DB write fails.
  try {
    saveOverdeckAgentStateSync(state);
  } catch (err) {
    console.warn(`[agents] activity DB write failed for ${agentId} (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }
  writeAgentStateJsonSync(state);
  return true;
}

export const saveAgentState = (state: AgentState): Effect.Effect<void, FsError> => {
  const dir = getAgentDir(state.id);
  const stateFile = getRollbackAgentStatePath(state.id);

  return Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => mkdirAsync(dir, { recursive: true }),
      catch: (cause) => toAgentFsError('mkdir', dir, cause),
    });

    const oldState = yield* getAgentState(state.id);
    const oldStatus = oldState?.status;

    if (state.status === 'running' || state.status === 'starting') {
      delete state.stoppedAt;
    } else if (state.status === 'stopped' && !state.stoppedAt) {
      state.stoppedAt = new Date().toISOString();
    }

    yield* Effect.try({
      try: () => saveOverdeckAgentStateSync(state),
      catch: (cause) => toAgentFsError('write', `agents-db:${state.id}`, cause),
    });

    yield* Effect.tryPromise({
      try: () => writeFileAsync(stateFile, JSON.stringify(cleanAgentState(state), null, 2)),
      catch: (cause) => toAgentFsError('write', stateFile, cause),
    });
    recordFeatureRegistryAgentState(state);

    // PAN-1919: mirror harness/model into the per-issue git-tracked record.
    if (state.harness && state.model) {
      yield* Effect.try({
        try: () => writeAgentHarnessModelRecordSync(state.issueId, state.harness!, state.model!),
        catch: (cause) => toAgentFsError('write', `record:${state.issueId}`, cause),
      });
    }

    yield* Effect.promise(() => recordDurableStoppedTransition(state, oldStatus));
    if (oldStatus && oldStatus !== state.status) {
      logAgentLifecycleSync(state.id, `status changed: ${oldStatus} → ${state.status} (saveAgentStateProgram)`);
    }
  });
};

function recordFeatureRegistryAgentState(state: AgentState): void {
  const status = state.status === 'starting' || state.status === 'running' ? 'active' : 'deferred';
  void recordFeatureRegistryLifecycle({
    issueId: state.issueId,
    workspacePath: state.workspace,
    agentId: state.id,
    status,
  });
}

function clearFailureTrackingFields(state: AgentState): void {
  state.consecutiveFailures = 0;
  delete state.firstFailureInRunAt;
  delete state.lastFailureAt;
  delete state.lastFailureReason;
  delete state.lastFailureNextRetryAt;
}

/**
 * Marker prefix used by the flywheel orchestrator when pausing an agent solely
 * to free a governor work slot. Pauses for this reason must never leave the
 * agent troubled (PAN-1812).
 */
export const GOVERNOR_SLOT_PAUSE_REASON_PREFIX = '[governor-slot]';

function isGovernorSlotPauseReason(reason: string | undefined): boolean {
  return reason !== undefined && reason.startsWith(GOVERNOR_SLOT_PAUSE_REASON_PREFIX);
}

/** Sets the persistent manual pause gate used before stopping or suppressing resume. */
function applyAgentPaused(state: AgentState, reason?: string, stoppedByPause = false): void {
  if (!state.paused) {
    state.pausedAt = new Date().toISOString();
  }
  state.paused = true;
  if (stoppedByPause) {
    state.stoppedByPause = true;
  }
  if (reason === undefined) {
    delete state.pausedReason;
  } else {
    state.pausedReason = reason;
  }

  // PAN-1812: a governor slot pause is a resource-hygiene action, not a fault.
  // Clear any existing troubled gate so the agent remains resumable when a slot
  // frees.
  if (isGovernorSlotPauseReason(reason)) {
    delete state.troubled;
    delete state.troubledAt;
  }
}

/** Sets the persistent manual pause gate used before stopping or suppressing resume. */
export function setAgentPausedSync(agentId: string, reason?: string, stoppedByPause = false): boolean {
  const state = getAgentStateSync(agentId);
  if (!state) return false;

  applyAgentPaused(state, reason, stoppedByPause);
  saveAgentStateSync(state);
  return true;
}

export const setAgentPaused = (
  agentId: string,
  reason?: string,
  stoppedByPause = false,
): Effect.Effect<AgentState | null, FsError> =>
  Effect.gen(function* () {
    const state = yield* getAgentState(agentId);
    if (!state) return null;

    applyAgentPaused(state, reason, stoppedByPause);
    yield* saveAgentState(state);
    return state;
  });

/**
 * PAN-2507: pause an agent as a scheduler YIELD (distinct from an operator
 * pause). Reuses the pause write path so every no-resume gate protects the
 * yielded agent, and stamps the yield attribution used for oldest-first resume.
 */
function applyAgentYielded(state: AgentState, reason: string): void {
  applyAgentPaused(state, reason, true);
  state.yieldedByScheduler = true;
  state.yieldedAt = new Date().toISOString();
}

/** PAN-2507: set the yield gate (pause + scheduler attribution) in one write. */
export function setAgentYieldedSync(agentId: string, reason: string): boolean {
  const state = getAgentStateSync(agentId);
  if (!state) return false;
  applyAgentYielded(state, reason);
  saveAgentStateSync(state);
  return true;
}

/**
 * PAN-2507: clear a scheduler yield ahead of a resume — drops the pause + yield
 * attribution (so `resumeAgent`'s pause gate passes) and stamps
 * `lastYieldResumeAt` to arm the re-yield cooldown, in a single write.
 */
export function clearYieldForResumeSync(agentId: string): boolean {
  const state = getAgentStateSync(agentId);
  if (!state) return false;
  applyAgentUnpaused(state);
  state.lastYieldResumeAt = new Date().toISOString();
  saveAgentStateSync(state);
  return true;
}

function applyAgentUnpaused(state: AgentState): void {
  if (state.stoppedByPause === true) {
    delete state.stoppedByUser;
  }
  delete state.stoppedByPause;
  delete state.paused;
  delete state.pausedReason;
  delete state.pausedAt;
  // PAN-2507 (FR-5): clearing a pause also clears the scheduler-yield
  // attribution, so an operator `pan unpause` on a yielded agent self-clears
  // the yield. `lastYieldResumeAt` is deliberately preserved — it is a
  // re-yield cooldown tracker, not a pause field.
  delete state.yieldedByScheduler;
  delete state.yieldedAt;
}

function isAgentPauseClear(state: AgentState): boolean {
  return !state.paused && state.pausedReason === undefined && state.pausedAt === undefined
    && state.yieldedByScheduler === undefined && state.yieldedAt === undefined;
}

/** Clears the persistent manual pause gate without spawning the agent. */
export function clearAgentPausedSync(agentId: string): boolean {
  const state = getAgentStateSync(agentId);
  if (!state) return false;
  if (isAgentPauseClear(state)) return true;

  applyAgentUnpaused(state);
  saveAgentStateSync(state);
  return true;
}

export const clearAgentPaused = (agentId: string): Effect.Effect<AgentState | null, FsError> =>
  Effect.gen(function* () {
    const state = yield* getAgentState(agentId);
    if (!state) return null;
    if (isAgentPauseClear(state)) return state;

    applyAgentUnpaused(state);
    yield* saveAgentState(state);
    return state;
  });

/** Marks an agent as troubled after repeated resume failures. */
export function markAgentTroubled(agentId: string): boolean {
  const state = getAgentStateSync(agentId);
  if (!state) return false;

  if (!state.troubled) {
    state.troubledAt = new Date().toISOString();
  }
  state.troubled = true;
  saveAgentStateSync(state);
  return true;
}

function isAgentTroubledClear(state: AgentState): boolean {
  return !state.troubled && state.troubledAt === undefined && (state.consecutiveFailures ?? 0) === 0 && state.firstFailureInRunAt === undefined && state.lastFailureAt === undefined && state.lastFailureReason === undefined && state.lastFailureNextRetryAt === undefined;
}

function applyAgentUntroubled(state: AgentState): void {
  delete state.troubled;
  delete state.troubledAt;
  clearFailureTrackingFields(state);
}

/** Clears the troubled gate and its accumulated failure state. */
export function clearAgentTroubledSync(agentId: string): boolean {
  const state = getAgentStateSync(agentId);
  if (!state) return false;
  if (isAgentTroubledClear(state)) return true;

  applyAgentUntroubled(state);
  saveAgentStateSync(state);
  return true;
}

export const clearAgentTroubled = (agentId: string): Effect.Effect<AgentState | null, FsError> =>
  Effect.gen(function* () {
    const state = yield* getAgentState(agentId);
    if (!state) return null;
    if (isAgentTroubledClear(state)) return state;

    applyAgentUntroubled(state);
    yield* saveAgentState(state);
    return state;
  });

/**
 * Clear operator-gate residue (stoppedByUser, paused, troubled) on STOPPED
 * agent rows whose issueId is in `issueIds` — used by close-out and the
 * terminal-issue residue patrol so a terminal issue's preserved agent rows
 * stop reappearing in the operator-gate parked orbit (PAN-3727). Running/
 * starting agents and scheduler yields are never touched: a yield is a live
 * scheduling decision, not operator residue, and a live agent's gates are not
 * this issue's to clear.
 *
 * Batched (one `listOverdeckAgentStatesSync()` scan for every issueId in the
 * set) so the recurring residue patrol does not perform one full agent-table
 * scan per terminal issue (review finding, PAN-3727) — cost scales with the
 * agent table once per patrol run, not with the number of terminal issues.
 */
export function clearAgentOperatorGatesForIssuesSync(issueIds: ReadonlySet<string>): Map<string, string[]> {
  const mutated = new Map<string, string[]>();
  if (issueIds.size === 0) return mutated;

  for (const state of listOverdeckAgentStatesSync()) {
    if (state.status !== 'stopped') continue;
    const normalized = state.issueId?.toUpperCase();
    if (!normalized || !issueIds.has(normalized)) continue;

    let changed = false;
    if (state.stoppedByUser) {
      delete state.stoppedByUser;
      changed = true;
    }
    if (state.paused === true && state.yieldedByScheduler !== true) {
      applyAgentUnpaused(state);
      changed = true;
    }
    if (state.troubled === true) {
      applyAgentUntroubled(state);
      changed = true;
    }
    if (changed) {
      saveAgentStateSync(state);
      const ids = mutated.get(normalized) ?? [];
      ids.push(state.id);
      mutated.set(normalized, ids);
    }
  }
  return mutated;
}

/** Single-issue convenience wrapper over {@link clearAgentOperatorGatesForIssuesSync}. */
export function clearAgentOperatorGatesForIssueSync(issueId: string): string[] {
  const normalized = issueId.toUpperCase();
  return clearAgentOperatorGatesForIssuesSync(new Set([normalized])).get(normalized) ?? [];
}

function applyAgentFailure(state: AgentState, reason: string): void {
  const config = resolveAutoResumeConfigForIssue(state.issueId);
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const firstFailureMs = Date.parse(state.firstFailureInRunAt ?? '');
  const hasValidFirstFailure = Number.isFinite(firstFailureMs);
  const windowElapsed = hasValidFirstFailure
    && nowMs - firstFailureMs > config.troubledWindowMs;

  if (windowElapsed || !hasValidFirstFailure) {
    state.consecutiveFailures = 1;
    state.firstFailureInRunAt = now;
  } else {
    state.consecutiveFailures = (state.consecutiveFailures ?? 0) + 1;
  }

  const backoffSeconds = config.failureBackoffSchedule[
    Math.min(state.consecutiveFailures - 1, config.failureBackoffSchedule.length - 1)
  ];
  state.lastFailureAt = now;
  state.lastFailureReason = reason;
  state.lastFailureNextRetryAt = new Date(nowMs + backoffSeconds * 1000).toISOString();

  const firstFailureInRunMs = Date.parse(state.firstFailureInRunAt ?? '');
  const shouldMarkTroubled = state.consecutiveFailures >= config.maxConsecutiveFailures
    && Number.isFinite(firstFailureInRunMs)
    && nowMs - firstFailureInRunMs <= config.troubledWindowMs;

  if (shouldMarkTroubled) {
    if (!state.troubled) {
      state.troubledAt = now;
    }
    state.troubled = true;
  }
}

/** Records one failed resume/crash observation for later backoff and troubled gating. */
export function recordAgentFailureSync(agentId: string, reason: string): boolean {
  const state = getAgentStateSync(agentId);
  if (!state) return false;

  applyAgentFailure(state, reason);
  saveAgentStateSync(state);
  return true;
}

export const recordAgentFailure = (agentId: string, reason: string): Effect.Effect<AgentState | null, FsError> =>
  Effect.gen(function* () {
    const state = yield* getAgentState(agentId);
    if (!state) return null;

    applyAgentFailure(state, reason);
    yield* saveAgentState(state);
    return state;
  });

/** Resets failure tracking after an agent reaches running state. */
export function resetAgentFailureCount(agentId: string): boolean {
  const state = getAgentStateSync(agentId);
  if (!state) return false;
  if ((state.consecutiveFailures ?? 0) === 0 && state.firstFailureInRunAt === undefined && state.lastFailureAt === undefined && state.lastFailureReason === undefined && state.lastFailureNextRetryAt === undefined) return true;

  clearFailureTrackingFields(state);
  saveAgentStateSync(state);
  return true;
}

/** Reports whether callers should block start, resume, auto-resume, or message delivery on the manual pause gate. */
export function isAgentPaused(agentId: string): boolean {
  return getAgentStateSync(agentId)?.paused === true;
}

/** Reports whether callers should block start, resume, auto-resume, or message delivery on the troubled gate. */
export function isAgentTroubled(agentId: string): boolean {
  return getAgentStateSync(agentId)?.troubled === true;
}

export async function recordStartupSessionExit(state: AgentState, issueId: string, source: Role | 'work-agent'): Promise<never> {
  await Effect.runPromise(recordAgentFailure(state.id, SESSION_EXITED_BEFORE_KICKOFF));
  const failedState = await Effect.runPromise(getAgentState(state.id));
  if (failedState) {
    failedState.status = 'stopped';
    failedState.stoppedAt = new Date().toISOString();
    failedState.kickoffDelivered = false;
    failedState.lastFailureReason = SESSION_EXITED_BEFORE_KICKOFF;
    await Effect.runPromise(saveAgentState(failedState));
  }
  state.status = 'stopped';
  state.stoppedAt = new Date().toISOString();
  state.kickoffDelivered = false;
  state.lastFailureReason = SESSION_EXITED_BEFORE_KICKOFF;
  emitActivityEntrySync({
    source,
    level: 'error',
    message: `${state.id}: session exited before kickoff could be delivered`,
    issueId,
  });
  throw new Error(`Agent ${state.id} exited before kickoff could be delivered`);
}

export type ResumeGateBlock =
  | { gate: 'paused'; reason: string; pausedReason?: string; yieldedByScheduler?: boolean }
  | { gate: 'troubled'; reason: string; troubledAt?: string }
  | { gate: 'stopped-by-user'; reason: string }
  | { gate: 'failure-backoff'; reason: string; consecutiveFailures: number };

export type ResumeIntent = 'autonomous' | 'operator-start' | 'message-delivery' | 'merge-preparation';

/** PAN-2668: messageAgent options — owesRework marks the message as pipeline
 *  feedback requiring rework (failed verification/review), which may re-drive
 *  a stopped-by-user agent that has a completed handoff. */
export interface MessageAgentRedriveOptions {
  owesRework?: boolean;
  /**
   * Idempotency key threaded to the delivery door (PAN-2997). Keyed live
   * deliveries are deduplicated by the crash-independent delivery component
   * (supervisor key set / tmux session option), so a dashboard crash and
   * recovery can never inject the same keyed message twice.
   */
  dedupKey?: string;
}

export interface ResumeGateContext {
  hasCompletedHandoff?: boolean;
  owesRework?: boolean;
}

export type ResumeGateDecision =
  | { decision: 'proceed'; clearStoppedByUser?: true; clearYield?: true; overrideFailureBackoff?: true; warning?: string }
  | { decision: 'block'; reason: string; needsYou?: true }
  | { decision: 'queue-message'; reason: string };

/** Pure classification only. Call decideResumeGate before acting on the classified gate. */
export function getAgentResumeGateBlockReason(
  state: Pick<AgentState, 'paused' | 'pausedReason' | 'yieldedByScheduler' | 'troubled' | 'troubledAt' | 'stoppedByUser' | 'consecutiveFailures'>,
): ResumeGateBlock | undefined {
  if (state.paused === true) {
    return {
      gate: 'paused',
      reason: state.pausedReason ? `agent is paused (${state.pausedReason})` : 'agent is paused',
      pausedReason: state.pausedReason,
      yieldedByScheduler: state.yieldedByScheduler,
    };
  }
  if (state.troubled === true) {
    const failures = state.consecutiveFailures ?? 0;
    return {
      gate: 'troubled',
      reason: `agent is troubled (${failures} failure${failures === 1 ? '' : 's'})`,
      troubledAt: state.troubledAt,
    };
  }
  if (state.stoppedByUser === true) return { gate: 'stopped-by-user', reason: 'agent was stopped by the operator' };
  const failures = state.consecutiveFailures ?? 0;
  if (failures > 0) return {
    gate: 'failure-backoff',
    reason: `agent is in failure backoff (${failures} failure${failures === 1 ? '' : 's'})`,
    consecutiveFailures: failures,
  };
  return undefined;
}

/** Intent-aware policy over a classified gate. This function never mutates agent state. */
export function decideResumeGate(
  block: ResumeGateBlock | undefined,
  intent: ResumeIntent,
  context: ResumeGateContext = {},
): ResumeGateDecision {
  if (!block) return { decision: 'proceed' };
  if (intent === 'message-delivery') {
    // PAN-2668: pipeline feedback that owes rework is a re-drive, not a casual
    // message. The same completed-handoff exception as the autonomous intent
    // applies — otherwise verification/review feedback for an operator-stopped
    // agent is silently mailed to a queue nothing will ever drain.
    if (block.gate === 'stopped-by-user' && context.hasCompletedHandoff === true && context.owesRework === true) {
      return { decision: 'proceed', clearStoppedByUser: true };
    }
    return { decision: 'queue-message', reason: block.reason };
  }

  // PAN-3120: clicking MERGE is an explicit operator action on this issue, and
  // the polyrepo/rebase path NEEDS the work agent. A scheduler yield is a
  // resource pause the system chose on its own (self-clearing by design), so it
  // must never be what stops a merge the operator asked for. An operator's own
  // pause, or a troubled agent, still blocks — those are decisions/faults a
  // human should see rather than have silently overridden.
  if (intent === 'merge-preparation') {
    if (block.gate === 'paused') {
      if (block.yieldedByScheduler === true) return { decision: 'proceed', clearYield: true };
      return { decision: 'block', reason: `${block.reason}; run pan unpause before merging`, needsYou: true };
    }
    if (block.gate === 'troubled') {
      return { decision: 'block', reason: `${block.reason}; run pan untroubled after investigating the crash`, needsYou: true };
    }
    if (block.gate === 'stopped-by-user') return { decision: 'proceed', clearStoppedByUser: true };
    return { decision: 'proceed', overrideFailureBackoff: true, warning: `Merge preparation overrides ${block.reason}` };
  }

  if (intent === 'operator-start') {
    if (block.gate === 'paused') return { decision: 'block', reason: `${block.reason}; run pan unpause first` };
    if (block.gate === 'troubled') return { decision: 'block', reason: `${block.reason}; run pan untroubled first` };
    if (block.gate === 'stopped-by-user') return { decision: 'proceed', clearStoppedByUser: true };
    return {
      decision: 'proceed',
      overrideFailureBackoff: true,
      warning: `Operator start overrides ${block.reason}`,
    };
  }

  if (block.gate === 'stopped-by-user') {
    if (context.hasCompletedHandoff === true && context.owesRework === true) {
      return { decision: 'proceed', clearStoppedByUser: true };
    }
    return { decision: 'block', reason: block.reason, needsYou: true };
  }
  return { decision: 'block', reason: block.reason };
}

function assertAgentCanTransitionToRunning(state: AgentState): void {
  const decision = decideResumeGate(getAgentResumeGateBlockReason(state), 'operator-start');
  if (decision.decision === 'block') {
    throw new Error(`Cannot run ${state.id}: ${decision.reason}. Clear the gate before resuming.`);
  }
}

export function markAgentRunning(state: AgentState, options?: { preserveFailureTracking?: boolean }): void {
  assertAgentCanTransitionToRunning(state);
  const oldStatus = state.status;
  state.status = 'running';
  // Codex activity comes from app-server notifications or rollout JSONL. A
  // synthetic spawn timestamp becomes permanently stale in the TUI fallback.
  if (state.harness !== 'codex') state.lastActivity = new Date().toISOString();
  if (options?.preserveFailureTracking !== true) {
    clearFailureTrackingFields(state);
  }
  delete state.stoppedAt;
  // Clear user-stop intent so a later crash/orphan can be auto-resumed. Without
  // this the flag is sticky across the stop→resume→crash sequence and autoResume
  // would permanently skip the agent on any subsequent orphan recovery.
  delete state.stoppedByUser;
  logAgentLifecycleSync(state.id, `status changed: ${oldStatus} → running (markAgentRunning)`);
}

function markAgentStopped(state: AgentState, cause: AgentStopCause): void {
  const oldStatus = state.status;
  state.status = 'stopped';
  state.stoppedAt = new Date().toISOString();
  if (cause === 'operator') {
    state.stoppedByUser = true;
  } else {
    // PAN-3324: a crash, OOM kill, or machinery-initiated stop is not operator
    // intent. Recording it as one engages the operator-stop gate, which turns a
    // transient resource event into a permanent stall no patrol can recover.
    delete state.stoppedByUser;
  }
  logAgentLifecycleSync(state.id, `status changed: ${oldStatus} → stopped (markAgentStopped, cause=${cause})`);
}

export function markAgentStoppedState(state: AgentState, cause: AgentStopCause = 'system'): AgentState {
  if (!state.id) {
    state.id = normalizeAgentId(state.issueId);
  }
  markAgentStopped(state, cause);
  return state;
}

export function markAgentRunningState(state: AgentState): AgentState {
  if (!state.id) {
    state.id = normalizeAgentId(state.issueId);
  }
  markAgentRunning(state);
  return state;
}

/** Test-only internals. Do not import outside of test files. */
export const __testInternals = { markAgentRunning, markAgentStopped };

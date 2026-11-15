/**
 * resumeCrashedWorkAgents (PAN-5354): the deacon-lite routine that resumes a
 * work agent whose harness died with no recorded stop (host crash, an OOM of
 * the terminal-backend unit, power loss).
 *
 * `reconcileAgentLiveness` confirms such a death and reports it to the
 * dashboard's read model, but since PAN-3917 deleted the `agent.heartbeat_dead`
 * handler and boot auto-resume, nothing acted on the report: the agent stayed
 * dead until a conversation noticed. This routine is that consumer. It takes
 * its candidates from the existing crash door (`detectCrashedAgents`) and
 * resumes through the existing resume door (`resumeAgent`), the same path as
 * `pan resume`. The stall sweeper stays report-only (operator directive,
 * stall-sweeper.ts).
 *
 * A candidate is resumed only when every guard holds:
 *
 * 1. `detectCrashedAgents` returns it with `role === 'work'`, and the selected
 *    backend's inventory does not list it. A null inventory is not a death.
 * 2. It was confirmed dead on two consecutive ticks (`CRASH_CONFIRM_GAP_MS`
 *    apart or more), so a pane that is mid-restart is left alone.
 * 3. No deliberate stop is recorded for its launch generation
 *    (`readRecordedAgentStopAt`, read WITHOUT the `reports` option so
 *    deacon-lite's own death report never counts as a stop). An operator
 *    suspend (Command Deck Pause) closes the pane and leaves state.json at
 *    `running`; the suspend route records its stop for exactly this reason
 *    (`buildSuspendedAgentEvents`).
 * 4. The `autonomous` resume gate proceeds: paused, troubled, stopped-by-user
 *    and failure-backoff agents are never resumed. `resumeAgent` itself gates
 *    with the `operator-start` intent, which overrides stopped-by-user, so this
 *    pre-check is the only thing that enforces the autonomous policy.
 * 5. Its issue is open and not merged (`isIssueClosed`,
 *    `shouldSkipDispatchAsMerged`).
 * 6. The deacon is not globally paused and the boot is not `--no-resume`
 *    (`OVERDECK_NO_RESUME=1`), both read at fire time.
 * 7. The memory governor admits (`assessMemoryPressure().band === 'ok'`).
 *    A governor that cannot answer does not admit.
 *
 * Pacing: at most one resume attempt per tick and at most one per
 * `CRASH_RESUME_MIN_INTERVAL_MS`, oldest `lastActivity` first. Each launch
 * generation gets one automatic attempt; a failed attempt raises one Needs-you
 * item naming the agent and the reason, and is never retried. A guard that
 * cannot be read skips the agent for this tick without spending the attempt.
 *
 * Every returned line is written to deacon.log by `runDeaconLite`. Lines that
 * describe a steady state (a gate hold, a memory hold) are emitted once per
 * change, never once per tick (the PAN-4300 lesson).
 *
 * All state is in memory, like the rest of deacon-lite. Across a deacon child
 * restart the streak restarts, so a resume waits one more tick. The
 * one-attempt record is lost too: an agent whose attempt failed early (its
 * `state.json` still reads `running`) gets one more attempt, and one more
 * Needs-you item, after each deacon child restart.
 */
import { getAgentState, type AgentState } from '../agents/agent-state-read.js';
import { decideResumeGate, getAgentResumeGateBlockReason } from '../agents/agent-state.js';
import { listAgentStates } from '../agents.js';
import { isNoResumeValueEnabled } from '../boot-no-resume.js';
import { isDeaconGloballyPaused } from '../overdeck/control-settings.js';
import { readRecordedAgentStopAt } from '../overdeck/event-reads.js';

/**
 * Two dead verdicts this far apart count as two consecutive ticks. Ticks start
 * 60 s apart, but this routine runs after three others of variable length, so
 * the gap between its own runs can fall a little short of 60 s. 45 s still
 * needs a second scheduled tick and rejects a manual patrol run right after one.
 */
export const CRASH_CONFIRM_GAP_MS = 45_000;
/** At most one automatic resume attempt per tick, even when a manual patrol runs between ticks (same jitter allowance). */
export const CRASH_RESUME_MIN_INTERVAL_MS = 45_000;

const ROUTINE = 'resumeCrashedWorkAgents';

interface InventoryLike {
  backend: string;
  panes: ReadonlyArray<{ agentId: string }>;
}

export interface CrashedWorkResumeDeps {
  isDeaconPaused: () => boolean;
  isNoResumeBoot: () => boolean;
  liveAgentInventory: () => Promise<InventoryLike | null>;
  listRunningAgents: () => AgentState[];
  detectCrashedAgents: (agents: AgentState[]) => Promise<AgentState[]>;
  readAgentState: (agentId: string) => AgentState | null;
  readRecordedStopAt: (agent: AgentState) => number | null;
  isIssueClosed: (issueId: string) => Promise<boolean>;
  isIssueMerged: (issueId: string) => Promise<{ skip: boolean; reason: string }>;
  /** `admits: false` holds every candidate for a later tick. */
  memoryAdmits: () => Promise<{ admits: boolean; detail: string }>;
  resumeAgent: (agentId: string) => Promise<{ success: boolean; error?: string }>;
  surfaceNeedsYou: (issueId: string, reason: string, details?: Record<string, unknown>) => Promise<void>;
}

// The crash, resume, tracker, merge and memory doors load lazily: their module
// graphs stay out of deacon-lite's static imports.
const defaultDeps: CrashedWorkResumeDeps = {
  isDeaconPaused: () => isDeaconGloballyPaused(),
  isNoResumeBoot: () => isNoResumeValueEnabled(process.env.OVERDECK_NO_RESUME),
  liveAgentInventory: async () => (await import('../terminal-backends/inventory.js')).liveAgentInventory(),
  listRunningAgents: () => listAgentStates({ status: 'running' }),
  detectCrashedAgents: async (agents) => (await import('../agents/recovery.js')).detectCrashedAgents(agents),
  readAgentState: (agentId) => getAgentState(agentId),
  // No `reports` option: deacon-lite's own death report must not count as a stop.
  readRecordedStopAt: (agent) => readRecordedAgentStopAt(agent),
  isIssueClosed: async (issueId) => (await import('./issue-closed.js')).isIssueClosed(issueId),
  isIssueMerged: async (issueId) => (await import('./merge-verification.js')).shouldSkipDispatchAsMerged(issueId),
  memoryAdmits: async () => {
    const { assessMemoryPressure } = await import('./memory-governor.js');
    const verdict = await assessMemoryPressure();
    return {
      admits: verdict.band === 'ok',
      detail: `band ${verdict.band}, ${Math.round(verdict.availableBytes / 1048576)} MiB available`,
    };
  },
  resumeAgent: async (agentId) => (await import('../agents/resume.js')).resumeAgent(agentId, undefined, { resumeCause: 'system' }),
  surfaceNeedsYou: async (issueId, reason, details) => {
    const { surfaceIssueFeedbackNeedsYou } = await import('./feedback-target.js');
    await surfaceIssueFeedbackNeedsYou(issueId, reason, details);
  },
};

// ============================================================================
// In-memory state
// ============================================================================

/** First dead verdict of the current streak, per agent and launch generation. */
const deadSince = new Map<string, { generation: string; at: number }>();
/** Launch generations already given their one automatic attempt, per agent. */
const attemptedGenerations = new Map<string, Set<string>>();
/** A generation settled without an attempt (stop recorded, issue closed or merged): never re-checked. */
const settledGeneration = new Map<string, string>();
/** The last gate hold reported per agent, so a hold is logged once per change. */
const reportedGateHold = new Map<string, string>();
let lastAttemptAt: number | null = null;
let memoryHoldReported = false;

export function __resetCrashedWorkResumeStateForTests(): void {
  deadSince.clear();
  attemptedGenerations.clear();
  settledGeneration.clear();
  reportedGateHold.clear();
  lastAttemptAt = null;
  memoryHoldReported = false;
}

function launchGeneration(agent: Pick<AgentState, 'startedAt' | 'lastResumeAt'>): string {
  return `${agent.startedAt}|${agent.lastResumeAt ?? ''}`;
}

function lastActivityMs(agent: AgentState): number {
  const ms = Date.parse(agent.lastActivity ?? '');
  // No activity stamp sorts first: it is treated as the oldest.
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function pruneTo(ids: Set<string>, map: Map<string, unknown>): void {
  for (const id of map.keys()) {
    if (!ids.has(id)) map.delete(id);
  }
}

// ============================================================================
// The routine
// ============================================================================

export async function resumeCrashedWorkAgents(
  now = Date.now(),
  overrides: Partial<CrashedWorkResumeDeps> = {},
): Promise<string[]> {
  const deps: CrashedWorkResumeDeps = { ...defaultDeps, ...overrides };
  const actions: string[] = [];
  try {
    await runOnce(now, deps, actions);
  } catch (err) {
    // Never throw: a throw here would abort every routine after it in the tick.
    console.error(`[deacon-lite] ${ROUTINE} failed:`, err);
  }
  return actions;
}

async function runOnce(now: number, deps: CrashedWorkResumeDeps, actions: string[]): Promise<void> {
  if (deps.isDeaconPaused()) return;
  if (deps.isNoResumeBoot()) return;

  let inventory: InventoryLike | null;
  try {
    inventory = await deps.liveAgentInventory();
  } catch {
    inventory = null;
  }
  if (inventory === null) {
    // Indeterminate: no death is confirmed this tick, so every streak breaks.
    deadSince.clear();
    return;
  }
  const liveIds = new Set(inventory.panes.map((pane) => pane.agentId));

  const running = deps.listRunningAgents();
  const runningIds = new Set(running.map((agent) => agent.id));
  pruneTo(runningIds, deadSince);
  pruneTo(runningIds, attemptedGenerations);
  pruneTo(runningIds, settledGeneration);
  pruneTo(runningIds, reportedGateHold);

  const absent = running.filter((agent) => agent.role === 'work' && !liveIds.has(agent.id));
  let crashed: AgentState[] = [];
  if (absent.length > 0) {
    try {
      crashed = (await deps.detectCrashedAgents(absent))
        .filter((agent) => agent.role === 'work' && !liveIds.has(agent.id));
    } catch (err) {
      console.error(`[deacon-lite] ${ROUTINE}: crash detection failed:`, err);
      deadSince.clear();
      return;
    }
  }
  const crashedIds = new Set(crashed.map((agent) => agent.id));
  // Alive or indeterminate this tick: the streak is no longer consecutive.
  pruneTo(crashedIds, deadSince);

  const candidates: AgentState[] = [];
  for (const agent of crashed) {
    const generation = launchGeneration(agent);
    if (attemptedGenerations.get(agent.id)?.has(generation)) continue;
    if (settledGeneration.get(agent.id) === generation) continue;

    const streak = deadSince.get(agent.id);
    if (!streak || streak.generation !== generation) {
      deadSince.set(agent.id, { generation, at: now });
      actions.push(`${ROUTINE}: ${agent.id} is confirmed dead (absent from the ${inventory.backend} inventory); resuming it if it is still dead on the next tick`);
      continue;
    }
    if (now - streak.at < CRASH_CONFIRM_GAP_MS) continue;

    let stoppedAt: number | null;
    try {
      stoppedAt = deps.readRecordedStopAt(agent);
    } catch (err) {
      console.error(`[deacon-lite] ${ROUTINE}: could not read the lifecycle events of ${agent.id}:`, err);
      continue;
    }
    if (stoppedAt !== null) {
      settledGeneration.set(agent.id, generation);
      actions.push(`${ROUTINE}: ${agent.id} not resumed: its stop is recorded at ${new Date(stoppedAt).toISOString()}`);
      continue;
    }

    const gate = decideResumeGate(getAgentResumeGateBlockReason(agent), 'autonomous');
    if (gate.decision !== 'proceed') {
      const hold = `${generation}|${gate.reason}`;
      if (reportedGateHold.get(agent.id) !== hold) {
        reportedGateHold.set(agent.id, hold);
        actions.push(`${ROUTINE}: ${agent.id} not resumed: ${gate.reason}`);
        // Only stopped-by-user carries needsYou under the autonomous intent;
        // a paused or troubled agent is a decision the operator already made.
        if (gate.decision === 'block' && gate.needsYou && agent.issueId) {
          await surfaceNeedsYouSafely(deps, agent.issueId, `work agent ${agent.id} crashed and was not resumed automatically: ${gate.reason}. Run pan resume ${agent.id} to resume it.`, agent.id);
        }
      }
      continue;
    }
    reportedGateHold.delete(agent.id);
    candidates.push(agent);
  }

  if (candidates.length === 0) return;
  if (lastAttemptAt !== null && now - lastAttemptAt < CRASH_RESUME_MIN_INTERVAL_MS) return;

  candidates.sort((a, b) => lastActivityMs(a) - lastActivityMs(b));

  let memory: { admits: boolean; detail: string };
  try {
    memory = await deps.memoryAdmits();
  } catch (err) {
    memory = { admits: false, detail: `memory governor could not answer: ${errorMessage(err)}` };
  }
  if (!memory.admits) {
    if (!memoryHoldReported) {
      memoryHoldReported = true;
      actions.push(`${ROUTINE}: holding ${candidates.length} crashed work agent(s): the memory governor does not admit (${memory.detail})`);
    }
    return;
  }
  memoryHoldReported = false;

  for (const agent of candidates) {
    const generation = launchGeneration(agent);
    const issueId = agent.issueId;
    if (!issueId) {
      settledGeneration.set(agent.id, generation);
      actions.push(`${ROUTINE}: ${agent.id} not resumed: its state names no issue`);
      continue;
    }
    if (await deps.isIssueClosed(issueId)) {
      settledGeneration.set(agent.id, generation);
      actions.push(`${ROUTINE}: ${agent.id} not resumed: ${issueId} is closed`);
      continue;
    }
    const merged = await deps.isIssueMerged(issueId);
    if (merged.skip) {
      settledGeneration.set(agent.id, generation);
      actions.push(`${ROUTINE}: ${agent.id} not resumed: ${issueId} is merged (${merged.reason})`);
      continue;
    }

    // Spend the one attempt before calling, so a resume that hangs past the
    // next tick is never started twice.
    const attempted = attemptedGenerations.get(agent.id) ?? new Set<string>();
    attempted.add(generation);
    attemptedGenerations.set(agent.id, attempted);
    lastAttemptAt = now;
    deadSince.delete(agent.id);

    let result: { success: boolean; error?: string };
    try {
      result = await deps.resumeAgent(agent.id);
    } catch (err) {
      result = { success: false, error: errorMessage(err) };
    }

    if (result.success) {
      actions.push(`${ROUTINE}: resumed ${agent.id}`);
      return;
    }

    // A failure that got far enough to stamp a new generation must not earn a
    // second attempt either.
    try {
      const fresh = deps.readAgentState(agent.id);
      if (fresh) attempted.add(launchGeneration(fresh));
    } catch { /* the original generation is already recorded */ }
    const reason = result.error ?? 'resumeAgent reported failure without a reason';
    actions.push(`${ROUTINE}: resume of ${agent.id} failed (${reason}); raised a Needs-you item`);
    await surfaceNeedsYouSafely(
      deps,
      issueId,
      `work agent ${agent.id} crashed and its automatic resume failed: ${reason}. Fix the cause, then run pan resume ${agent.id}.`,
      agent.id,
    );
    return;
  }
}

async function surfaceNeedsYouSafely(
  deps: CrashedWorkResumeDeps,
  issueId: string,
  reason: string,
  agentId: string,
): Promise<void> {
  try {
    await deps.surfaceNeedsYou(issueId, reason, { agentId, source: ROUTINE });
  } catch (err) {
    console.error(`[deacon-lite] ${ROUTINE}: could not raise Needs-you for ${agentId}:`, err);
  }
}

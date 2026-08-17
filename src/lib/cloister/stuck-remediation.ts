import { Effect } from 'effect';
import {
  getAgentRuntimeStateSync,
  listRunningAgentsSync,
  markAgentTroubled,
  messageAgent,
  resumeAgent,
  type AgentState,
} from '../agents.js';
import { countPendingAskUserQuestionsForAgent } from '../agent-enrichment.js';
import { logDeaconEventSync } from '../persistent-logger.js';
import { getReviewStatusSync, type ReviewStatus } from '../review-status.js';
import { capturePaneSync, detectTerminalApiErrorSync, sessionExistsSync, killSession, killSessionSync, listPaneValuesSync, sendEscapeKeyAsync } from '../tmux.js';
import { loadCloisterConfigSync, DEFAULT_CLOISTER_CONFIG, type StuckRemediationConfig } from './config.js';
import { getAgentEffectiveLastActivityMs, getAgentWorkActivityMs, isAgentIdleForNudge } from './agent-idle.js';
import { describeAgentDeath } from './agent-death.js';
import { getFlywheelActiveRunId, isFlywheelGloballyPaused } from '../overdeck/control-settings.js';
import {
  clearStuckRemediationState,
  readStuckRemediationState,
  writeStuckRemediationState,
  type StuckRemediationState,
} from './stuck-remediation-state.js';
import { readWorkspacePlanSync } from '../xbrief/io.js';
import { getDispatchableItems } from '../xbrief/dag.js';
import { recordRecoveryFailure } from './recovery-trip.js';
import { readAgentBackgroundTaskWedgeEvidence } from './planning-wedge.js';

export interface StuckRemediationOptions {
  now?: number;
}

function issueIdForAgent(agent: AgentState): string {
  return agent.issueId || agent.id.replace(/^agent-/, '').toUpperCase();
}

export function shouldSkipReviewStatus(status: ReviewStatus | null): boolean {
  if (!status) return false;
  if (status.stuck || status.deaconIgnored || status.mergeStatus === 'merged' || status.readyForMerge) return true;
  if (status.reviewStatus === 'blocked' || status.reviewStatus === 'failed') return true;
  if (status.verificationStatus === 'failed' || status.testStatus === 'failed') return true;
  // PAN-2581: the pipeline OWNS the issue while review/test advance it — review in
  // flight, a passed review awaiting test, or an un-serviced durable review request
  // (`pan done` already ran; dispatch owns the next step). Warm-idle is the work
  // agent's intended state here (PAN-2579). Poking it told it to re-run `pan done`,
  // which re-armed review and clobbered landed verdicts (PAN-399 burned $63 on this).
  if (status.reviewStatus === 'reviewing' || status.reviewStatus === 'passed') return true;
  return status.reviewStatus === 'pending' && !!status.reviewRequestedAt;
}

/**
 * PAN-2581 (FR-2, residual): phase gate for the health-check poke loop
 * (service.ts pokeAgent → pokeAgentWithEscalation → idle-alive pause), the
 * SECOND independent idleness consumer besides stuck-remediation. A warm-idle
 * work agent on a pipeline-owned issue — and a warm-idle review/test agent
 * after its verdict — must never be poked ("are you stuck?") or idle-alive
 * paused: the poke spends tokens re-explaining the wait, and the pause
 * manufactures the paused-delivery-target deadlock PAN-2461 exists to undo.
 * A genuinely stalled mid-review parent is covered by the PAN-2584 liveness
 * deadline, not pokes. Owed-rework agents (review blocked/failed, tests
 * failed) are ALSO skipped here by design: shouldSkipReviewStatus returns
 * true for those because the PAN-2519 wedged-rework path owns their
 * escalation — the health-check poke loop must not double-drive them.
 * Roles outside work/review/test (plan, strike, flywheel, sequencer) keep
 * their existing idleness semantics.
 */
export function shouldSkipIdlePokeForAgent(
  agent: Pick<AgentState, 'id' | 'issueId' | 'role'> | null,
  readStatus: (issueId: string) => ReviewStatus | null = getReviewStatusSync,
): boolean {
  if (!agent) return false;
  if (agent.role !== 'work' && agent.role !== 'review' && agent.role !== 'test') return false;
  const issueId = (agent.issueId
    || agent.id.replace(/^agent-/, '').replace(/-(review|test|ship)(-.*)?$/, '').replace(/-slot-\d+$/, '')
  ).toUpperCase();
  return shouldSkipReviewStatus(readStatus(issueId));
}

// PAN-2519: the rework subset of shouldSkipReviewStatus — a work agent that OWES
// a fix (review blocked/failed, verification failed, tests failed) and is NOT
// already done/ignored (merged, readyForMerge, stuck, deaconIgnored). These are
// exactly the agents the idle-escalation path skips (via shouldSkipReviewStatus)
// AND the PAN-2209 dead-end respawn skips (session still exists) — so a
// wedged-but-alive rework agent falls through both and stalls invisibly.
function hasPendingRework(status: ReviewStatus | null): boolean {
  if (!status) return false;
  if (status.stuck || status.deaconIgnored || status.mergeStatus === 'merged' || status.readyForMerge) return false;
  return (
    status.reviewStatus === 'blocked' ||
    status.reviewStatus === 'failed' ||
    status.verificationStatus === 'failed' ||
    status.testStatus === 'failed'
  );
}

// Mirror of the deacon dead-end circuit breaker (deacon.ts: autoRequeueCount >= 25
// halts respawn). Below the ceiling we kill a wedged rework agent so PAN-2209
// respawns it fresh; at/above it, respawn would be refused, so we park it as
// troubled instead — leaving a live operator signal rather than a dead session.
const STUCK_KILL_REQUEUE_CEILING = 25;

// A wedged-but-alive work agent holding pending rework: kill its session so the
// deacon's PAN-2209 dead-end path respawns a fresh agent whose kickoff prompt
// drains .pan/feedback. Returns true when it handled the agent (caller returns).
async function evaluateWedgedReworkAgent(
  agent: AgentState,
  config: StuckRemediationConfig,
  now: number,
  actions: string[],
): Promise<boolean> {
  const agentId = agent.id;
  if (agent.role !== 'work' || !agent.workspace) return false;

  const issueId = issueIdForAgent(agent);
  const status = getReviewStatusSync(issueId);
  if (!hasPendingRework(status)) return false;

  const lastActivityMs = getAgentEffectiveLastActivityMs(agentId);
  if (lastActivityMs === null || !Number.isFinite(lastActivityMs)) return false;

  const stuckState = readStuckRemediationState(agentId);
  if (stuckState) {
    const firstStuckMs = new Date(stuckState.firstStuckAt).getTime();
    if (Number.isFinite(firstStuckMs) && lastActivityMs > firstStuckMs) {
      // The agent resumed activity since we flagged it — clear and let the
      // normal path re-evaluate on a future tick.
      clearStuckRemediationState(agentId);
      return false;
    }
  }

  const idleMinutes = Math.floor((now - lastActivityMs) / 60_000);
  const lastStage = stuckState?.lastStage ?? 0;
  // One action per stuck episode (lastStage < 3). A successful respawn advances
  // activity and clears state above, so the next wedge is a fresh episode.
  if (idleMinutes < config.stage3_minutes || lastStage >= 3) return false;

  const firstStuck = firstStuckAt(new Date(lastActivityMs).toISOString(), stuckState);
  const requeues = status?.autoRequeueCount ?? 0;

  if (requeues >= STUCK_KILL_REQUEUE_CEILING) {
    // Chronic re-death: the deacon breaker would refuse another respawn, so
    // parking as troubled surfaces it for an operator instead of a dead session.
    markAgentTroubled(agentId);
    writeStuckRemediationState(agentId, stageState(3, now, firstStuck));
    logAction(actions, transitionAction(3, issueId, idleMinutes, 'rework-wedge-troubled'));
    await surfaceStuckNeedsYou(agent, issueId, firstStuck, actions);
    return true;
  }

  killSessionSync(agentId);
  writeStuckRemediationState(agentId, stageState(3, now, firstStuck));
  logAction(actions, transitionAction(3, issueId, idleMinutes, 'killed-for-respawn'));
  return true;
}

function shouldCheckReadyBeadsForAgent(agent: AgentState, now: number): boolean {
  const agentId = agent.id;
  if (!agentId) return false;
  if (agent.status !== 'running') return false;
  if (agent.role !== 'work') return false;
  if (!agent.workspace) return false;
  const completedAt = (agent as AgentState & { completedAt?: string }).completedAt;
  if (agent.paused || agent.troubled || completedAt) return false;
  if (!sessionExistsSync(agentId)) return false;
  if (shouldSkipReviewStatus(getReviewStatusSync(issueIdForAgent(agent)))) return false;
  return isAgentIdleForNudge(agentId, 5 * 60 * 1000, now);
}

function firstStuckAt(runtimeLastActivity: string, stuckState: StuckRemediationState | null): string {
  return stuckState?.firstStuckAt ?? runtimeLastActivity;
}

function stageState(
  stage: 1 | 2 | 3,
  now: number,
  firstStuck: string,
  prev?: StuckRemediationState | null,
): StuckRemediationState {
  // Carry the flywheel respawn-cap accounting (respawnCount/lastRespawnAt) across
  // stage transitions — otherwise a stage1/stage2 write between relaunches would
  // reset the cap and the wedge-relaunch loop could never escalate (PAN-2160).
  return {
    lastStage: stage,
    lastStageAt: new Date(now).toISOString(),
    firstStuckAt: firstStuck,
    ...(prev?.respawnCount !== undefined ? { respawnCount: prev.respawnCount } : {}),
    ...(prev?.lastRespawnAt !== undefined ? { lastRespawnAt: prev.lastRespawnAt } : {}),
  };
}

function transitionAction(stage: 1 | 2 | 3, issueId: string, idleMinutes: number, action: string): string {
  return `[deacon] stuck-remediation stage=${stage} issue=${issueId} idleMin=${idleMinutes} action=${action}`;
}

function logAction(actions: string[], action: string): void {
  actions.push(action);
  console.log(action);
  logDeaconEventSync(action);
}

async function surfaceStuckNeedsYou(agent: AgentState, issueId: string, generation: string, actions: string[]): Promise<void> {
  if (!agent.workspace) return;
  const failure = await recordRecoveryFailure(agent.workspace, issueId, 'stuck-remediation', generation, 1);
  if (failure.emitNeedsYou) logAction(actions, `[deacon] needs-you ${issueId}: stuck remediation exhausted`);
}

async function evaluateAgent(
  agent: AgentState,
  config: StuckRemediationConfig,
  now: number,
  actions: string[],
): Promise<void> {
  const agentId = agent.id;
  if (!agentId) return;
  if (agent.status !== 'running') return;
  const completedAt = (agent as AgentState & { completedAt?: string }).completedAt;
  if (agent.paused || agent.troubled || completedAt) return;

  // PAN-2108: evaluate the flywheel orchestrator BEFORE the session-exists guard.
  // Its recovery must be able to fresh-launch even when the session has fully
  // vanished (not just gone zombie); evaluateFlywheelOrchestrator does its own
  // liveness check.
  if (agent.role === 'flywheel') {
    await evaluateFlywheelOrchestrator(agent, config, now, actions);
    return;
  }
  if (!sessionExistsSync(agentId)) return;
  if (agent.role === 'plan') {
    await evaluatePlanningAgent(agent, config, now, actions);
    return;
  }
  // PAN-2519: catch wedged-but-alive work agents that OWE a rework fix before the
  // ready-beads gate skips them (shouldSkipReviewStatus is true for rework state).
  // These are invisible to both idle-escalation (skipped here) and PAN-2209
  // respawn (session still exists); killing the session bridges them to respawn.
  if (await evaluateWedgedReworkAgent(agent, config, now, actions)) return;
  if (!shouldCheckReadyBeadsForAgent(agent, now)) return;
  if (!agent.workspace) return;

  const issueId = issueIdForAgent(agent);
  const plan = readWorkspacePlanSync(agent.workspace);
  if (!plan) return;
  if (getDispatchableItems(plan, new Set()).length > 0) return;

  const lastActivityMs = getAgentEffectiveLastActivityMs(agentId);
  if (lastActivityMs === null) return;
  if (!Number.isFinite(lastActivityMs)) return;
  const lastActivity = new Date(lastActivityMs).toISOString();

  const stuckState = readStuckRemediationState(agentId);
  if (stuckState) {
    const firstStuckMs = new Date(stuckState.firstStuckAt).getTime();
    if (Number.isFinite(firstStuckMs) && lastActivityMs > firstStuckMs) {
      clearStuckRemediationState(agentId);
      return;
    }
  }

  const idleMinutes = Math.floor((now - lastActivityMs) / 60_000);
  const lastStage = stuckState?.lastStage ?? 0;
  const firstStuck = firstStuckAt(lastActivity, stuckState);

  const terminalProviderError = detectTerminalApiErrorSync(capturePaneSync(agentId, 80));
  if (terminalProviderError) {
    markAgentTroubled(agentId);
    writeStuckRemediationState(agentId, stageState(3, now, firstStuck));
    logAction(actions, `${agentId} provider-terminal: ${terminalProviderError.summary}`);
    await surfaceStuckNeedsYou(agent, issueId, firstStuck, actions);
    return;
  }

  if (idleMinutes >= config.stage3_minutes && lastStage < 3) {
    markAgentTroubled(agentId);
    writeStuckRemediationState(agentId, stageState(3, now, firstStuck));
    logAction(actions, transitionAction(3, issueId, idleMinutes, 'marked-troubled'));
    await surfaceStuckNeedsYou(agent, issueId, firstStuck, actions);
    return;
  }

  if (idleMinutes >= config.stage2_minutes && lastStage < 2) {
    const message = `Resuming after auto-detected stall (${idleMinutes} min idle). Review your last work and decide whether to continue or signal done with \`pan done ${issueId}\`.`;
    const result = await resumeAgent(agentId, message);
    if (result.success) {
      writeStuckRemediationState(agentId, stageState(2, now, firstStuck));
      logAction(actions, transitionAction(2, issueId, idleMinutes, 'resumed'));
    } else {
      // PAN-2108: surface WHY (exit code + output tail) instead of an opaque
      // "resume-failed" — a resume usually fails because the process died.
      const action = `${transitionAction(2, issueId, idleMinutes, 'resume-failed')} — death: ${describeAgentDeath(agentId)}`;
      console.warn(action);
      logDeaconEventSync(action);
    }
    return;
  }

  if (idleMinutes >= config.stage1_minutes && lastStage < 1) {
    const message = `You appear stuck — no tool calls for ${idleMinutes} min. If your implementation is complete, run \`pan done ${issueId}\`. Otherwise reply with a one-line summary of what you're waiting on, then continue.`;
    await messageAgent(agentId, message);
    writeStuckRemediationState(agentId, stageState(1, now, firstStuck));
    logAction(actions, transitionAction(1, issueId, idleMinutes, 'poked'));
  }
}

/**
 * PAN-3677: remediation decision for a planning session with no pending
 * AskUserQuestion. Pure — side effects live in evaluatePlanningAgent.
 *
 * The wedge this catches: a planning session whose turn never ends because the
 * provider call hung (observed on k3[1m] planning sessions right after
 * background Explore children reached a terminal state — all-finished AND
 * mixed failed/finished). The detector combines three signals: the runtime
 * mirror still says 'active' (the Stop hook never fired — the turn never
 * ended), work-product activity (hook events, transcript writes) has been
 * silent past the stage threshold, AND the session transcript positively
 * proves background children were in flight this turn with every child
 * terminal (planning-wedge.ts).
 *
 * Guards against interrupting healthy turns:
 *  - mirror 'idle' means the Stop hook fired — the agent is at its prompt
 *    (operator's turn in a manual session). Never interrupt.
 *  - `wedgeProven` requires the transcript itself to prove background children
 *    were in flight AND every child is terminal (parseBackgroundTaskWedge). A
 *    silent 'active' turn without that proof is a healthy long
 *    reasoning/provider turn — never interrupt it.
 *  - work activity fresher than stage1_minutes means real work is flowing
 *    (tool calls, transcript writes) — never interrupt, even though the pane
 *    repaint alone would look identical. The detector never consults tmux
 *    window_activity: the spinner/task panel repaints every second during a
 *    hung call and would mask the wedge (see getAgentWorkActivityMs).
 *
 * The ladder is bounded by construction: interrupt → kill+resume → troubled.
 * No stage waits on anything after every child is terminal.
 */
export type PlanningWedgeDecision =
  | { kind: 'none' }
  | { kind: 'interrupt-nudge'; idleMinutes: number }
  | { kind: 'kill-resume'; idleMinutes: number }
  | { kind: 'troubled'; idleMinutes: number };

export function decidePlanningWedgeRemediation(opts: {
  mirrorState: string | null;
  pendingQuestions: number;
  /** Positive transcript proof (parseBackgroundTaskWedge): background children were in flight AND every one is terminal. */
  wedgeProven: boolean;
  workActivityMs: number | null;
  lastStage: number;
  now: number;
  config: StuckRemediationConfig;
}): PlanningWedgeDecision {
  const { mirrorState, pendingQuestions, wedgeProven, workActivityMs, lastStage, now, config } = opts;
  // A pending AskUserQuestion is the operator's slot (auto sessions get the
  // default-choice nudge elsewhere) — never treat it as a wedge.
  if (pendingQuestions > 0) return { kind: 'none' };
  // Only a stale-'active' mirror is a mid-turn wedge. 'idle' means the Stop
  // hook fired (turn ended, agent at its prompt); 'suspended'/'stopped'/
  // 'waiting-on-human' are owned by other paths; null means the mirror never
  // came up and we cannot tell wedge from healthy.
  if (mirrorState !== 'active') return { kind: 'none' };
  // The positive signature: without transcript proof that background children
  // were in flight and ALL of them are terminal, a silent 'active' turn is a
  // healthy long reasoning/provider turn — never interrupt it.
  if (!wedgeProven) return { kind: 'none' };
  if (workActivityMs === null || !Number.isFinite(workActivityMs)) return { kind: 'none' };
  const idleMinutes = Math.floor((now - workActivityMs) / 60_000);
  if (idleMinutes >= config.stage3_minutes) {
    if (lastStage >= 3) return { kind: 'none' };
    return { kind: 'troubled', idleMinutes };
  }
  if (idleMinutes >= config.stage2_minutes) {
    if (lastStage >= 2) return { kind: 'none' };
    return { kind: 'kill-resume', idleMinutes };
  }
  if (idleMinutes >= config.stage1_minutes) {
    if (lastStage >= 1) return { kind: 'none' };
    return { kind: 'interrupt-nudge', idleMinutes };
  }
  return { kind: 'none' };
}

/**
 * Episode-clear rule for the planning wedge path, keyed on WORK activity only
 * (never pane repaints — the spinner would "clear" a still-wedged episode and
 * re-fire stage 1 every tick): work flowing after the episode opened means the
 * recovery worked.
 */
export function shouldClearPlanningWedgeEpisode(
  stuckState: StuckRemediationState | null,
  workActivityMs: number,
): boolean {
  if (!stuckState) return false;
  const firstStuckMs = new Date(stuckState.firstStuckAt).getTime();
  return Number.isFinite(firstStuckMs) && workActivityMs > firstStuckMs;
}

/** Side-effecting doors the wedge executor needs — injected for tests. */
export interface PlanningWedgeEffectDeps {
  sendEscape: (agentId: string) => Promise<void>;
  message: (agentId: string, msg: string) => Promise<unknown>;
  /** Async tmux kill (Effect-based `killSession` from tmux.ts) — never the sync variant from server-reachable code. */
  killSession: (agentId: string) => Promise<void>;
  resume: (agentId: string, msg: string) => Promise<{ success: boolean; error?: string }>;
  markTroubled: (agentId: string) => void;
  writeState: (agentId: string, state: StuckRemediationState) => void;
  surfaceNeedsYou: () => Promise<void>;
  log: (msg: string) => void;
}

/**
 * Execute one wedge-ladder decision. Ordering is the contract: stage 1 sends
 * Escape BEFORE queueing its single nudge (the interrupt returns the prompt;
 * the nudge — and any queued operator messages — are processed after). Stage 2
 * kills the session and plain-resumes the SAME saved session id, so the
 * transcript (and every explorer's findings) survives — unlike the
 * compact-respawn path that lost conversation-only survey notes in the manual
 * MIN-889 recovery.
 */
export async function executePlanningWedgeDecision(
  agentId: string,
  issueId: string,
  decision: Exclude<PlanningWedgeDecision, { kind: 'none' }>,
  firstStuck: string,
  now: number,
  deps: PlanningWedgeEffectDeps,
): Promise<void> {
  if (decision.kind === 'interrupt-nudge') {
    // Escape cancels the in-flight (hung) provider call. The harness returns to
    // its prompt and processes queued operator messages; the nudge below then
    // tells the planner how to continue without re-entering the blocking wait.
    try {
      await deps.sendEscape(agentId);
    } catch (err) {
      console.error(`[deacon] Failed to interrupt wedged planning session ${agentId}:`, err);
      return;
    }
    const message =
      `Your previous turn stalled for ${decision.idleMinutes} min with no progress and was interrupted (a hung provider call). ` +
      `Process any queued operator messages first. Then collect background-task results NON-blocking (TaskOutput with block:false) — ` +
      `every child that reached a terminal state already has its result or error available; do NOT re-enter a blocking wait. ` +
      `Continue planning now: write the PRD/xBRIEF artifacts and proceed to your instructed stopping point.`;
    // The Escape already landed — the interrupt happened whether or not the
    // nudge arrives. Record stage 1 either way: skipping the state write on a
    // delivery failure would let every patrol re-Escape an already-unwedged
    // session forever.
    let deliveryError: string | null = null;
    try {
      await deps.message(agentId, message);
    } catch (err) {
      deliveryError = err instanceof Error ? err.message : String(err);
    }
    deps.writeState(agentId, stageState(1, now, firstStuck));
    deps.log(deliveryError
      ? `${transitionAction(1, issueId, decision.idleMinutes, 'interrupted-wedged-turn')} — nudge delivery failed: ${deliveryError}`
      : transitionAction(1, issueId, decision.idleMinutes, 'interrupted-wedged-turn'));
    return;
  }

  if (decision.kind === 'kill-resume') {
    try {
      await deps.killSession(agentId);
    } catch {
      /* best effort — the resume below fails cleanly if the session lingers */
    }
    const message =
      `Resuming after an automated stall recovery (${decision.idleMinutes} min with no progress). ` +
      `Your transcript is intact — continue planning from where you left off. ` +
      `Collect background-task results NON-blocking (TaskOutput with block:false) and proceed.`;
    const result = await deps.resume(agentId, message);
    if (result.success) {
      deps.writeState(agentId, stageState(2, now, firstStuck));
      deps.log(transitionAction(2, issueId, decision.idleMinutes, 'kill-resumed-wedged-planning'));
    } else {
      deps.markTroubled(agentId);
      deps.writeState(agentId, stageState(3, now, firstStuck));
      deps.log(`${transitionAction(3, issueId, decision.idleMinutes, 'kill-resume-failed-troubled')} — ${result.error ?? 'unknown'}`);
      await deps.surfaceNeedsYou();
    }
    return;
  }

  // troubled
  deps.markTroubled(agentId);
  deps.writeState(agentId, stageState(3, now, firstStuck));
  deps.log(transitionAction(3, issueId, decision.idleMinutes, 'wedged-planning-troubled'));
  await deps.surfaceNeedsYou();
}

async function evaluatePlanningAgent(
  agent: AgentState,
  config: StuckRemediationConfig,
  now: number,
  actions: string[],
): Promise<void> {
  const agentId = agent.id;
  const issueId = issueIdForAgent(agent);
  const pendingQuestions = await Effect.runPromise(countPendingAskUserQuestionsForAgent(agentId));

  // An unanswered AskUserQuestion parks the session on the operator. Manual
  // sessions wait by design; --auto sessions get the default-choice nudge.
  if (pendingQuestions > 0) {
    if (!isAgentIdleForNudge(agentId, 5 * 60 * 1000, now)) return;
    if (agent.auto !== true) return;
    const lastActivityMs = getAgentEffectiveLastActivityMs(agentId);
    if (lastActivityMs === null || !Number.isFinite(lastActivityMs)) return;
    const lastActivity = new Date(lastActivityMs).toISOString();
    const stuckState = readStuckRemediationState(agentId);
    if (stuckState) {
      const firstStuckMs = new Date(stuckState.firstStuckAt).getTime();
      if (Number.isFinite(firstStuckMs) && lastActivityMs > firstStuckMs) {
        clearStuckRemediationState(agentId);
        return;
      }
    }
    const idleMinutes = Math.floor((now - lastActivityMs) / 60_000);
    const lastStage = stuckState?.lastStage ?? 0;
    if (idleMinutes < config.stage1_minutes || lastStage >= 1) return;
    const message =
      `This planning session was launched with \`pan plan ${issueId} --auto\`, so do not wait for operator input. ` +
      `Proceed with the most defensible default from the issue/PRD/comments, record the choice in \`plan.autoDecisions[]\` with rationale, and continue to \`pan plan finalize\`. ` +
      `Only halt for a genuine contradiction between authoritative inputs.`;
    await messageAgent(agentId, message);
    writeStuckRemediationState(agentId, stageState(1, now, firstStuckAt(lastActivity, stuckState)));
    logAction(actions, transitionAction(1, issueId, idleMinutes, 'auto-planning-default'));
    return;
  }

  // PAN-3677: mid-turn wedge. Every signal here is WORK activity (hook mirror +
  // transcript heartbeat), never tmux window_activity — Claude Code repaints
  // its spinner/task panel every second during a hung provider call, so the
  // pane looks alive while no work flows. Keying on the pane would (a) hide
  // the wedge entirely and (b) instantly "clear" the episode state,
  // re-firing stage 1 every tick.
  const workActivityMs = getAgentWorkActivityMs(agentId);
  if (workActivityMs === null || !Number.isFinite(workActivityMs)) return;

  const stuckState = readStuckRemediationState(agentId);
  if (shouldClearPlanningWedgeEpisode(stuckState, workActivityMs)) {
    clearStuckRemediationState(agentId);
    return;
  }

  const mirrorState = getAgentRuntimeStateSync(agentId)?.state ?? null;
  if (mirrorState !== 'active') return;
  const idleMinutesGate = Math.floor((now - workActivityMs) / 60_000);
  if (idleMinutesGate < config.stage1_minutes) return;

  // The positive signature (readAgentBackgroundTaskWedgeEvidence): the
  // transcript of the CURRENT turn must prove background children were in
  // flight and EVERY child is terminal. Without it, a silent 'active' turn is
  // a healthy long reasoning/provider turn and is never interrupted.
  const wedgeProven = agent.workspace
    ? readAgentBackgroundTaskWedgeEvidence(agentId, agent.workspace)?.wedged === true
    : false;

  const decision = decidePlanningWedgeRemediation({
    mirrorState,
    pendingQuestions,
    wedgeProven,
    workActivityMs,
    lastStage: stuckState?.lastStage ?? 0,
    now,
    config,
  });
  if (decision.kind === 'none') return;

  await executePlanningWedgeDecision(agentId, issueId, decision, firstStuckAt(new Date(workActivityMs).toISOString(), stuckState), now, {
    sendEscape: (id) => sendEscapeKeyAsync(id),
    message: (id, msg) => messageAgent(id, msg),
    killSession: (id) => Effect.runPromise(killSession(id)),
    resume: (id, msg) => resumeAgent(id, msg),
    markTroubled: (id) => markAgentTroubled(id),
    writeState: (id, state) => writeStuckRemediationState(id, state),
    surfaceNeedsYou: () => surfaceStuckNeedsYou(agent, issueId, firstStuckAt(new Date(workActivityMs).toISOString(), stuckState), actions),
    log: (msg) => logAction(actions, msg),
  });
}

// The flywheel orchestrator is a singleton with role 'flywheel'. It ticks
// sub-minute by design (each tick produces a FlywheelStatus snapshot via
// `pan flywheel emit-status`), so a long silence indicates a stuck model call
// or a dropped tick loop — not the natural between-task idleness work agents
// exhibit.
//
// PAN-2108: the orchestrator may run on the ohmypi (omp) harness (no
// ScheduleWakeup tool); when its process DIES (RUN-30: silent crash mid-run)
// the runtime mirror goes stale-but-"active", so a dead orchestrator must
// self-heal: kill the zombie session and fresh-launch the run.
//
// PAN-2160: the orchestrator is the pipeline's last stand, so NEITHER death NOR
// a wedged (alive-but-silent) tick loop may ever PARK it. Both recover the same
// way — relaunch (capped); only a genuine crash/wedge loop past the cap escalates
// to paused+troubled (operator needed). Two work-agent gates that used to wrongly
// kill the orchestrator are removed:
//   1. OVERDECK_NO_RESUME is NOT honored here — it gates *work-agent*
//      resurrection, not the controller. The operator stops the flywheel with
//      `pan flywheel stop` (clears the active run ⇒ `noop` below), or halts
//      everything with `pan admin cloister freeze` (suspends the whole patrol, so
//      this code never runs). That separation is the real kill-switch.
//   2. The terminal idle stage relaunches instead of pause+troubled — a wedged
//      orchestrator must be restarted, not parked (RUN-36 was parked at
//      idleMin=205 and the entire pipeline stalled).
const FLYWHEEL_RESPAWN_WINDOW_MS = 30 * 60 * 1000;
const FLYWHEEL_MAX_RESPAWNS = 3;
const FLYWHEEL_ORCHESTRATOR_AGENT_ID = 'flywheel-orchestrator';

export type FlywheelRemediationDecision =
  | { kind: 'noop' }
  | { kind: 'relaunch'; respawnCount: number }
  | { kind: 'escalate'; respawnCount: number };

/**
 * Pure decision for recovering a dead or wedged flywheel orchestrator (no I/O —
 * side effects live in remediateFlywheelOrchestrator). The respawn cap
 * (FLYWHEEL_MAX_RESPAWNS within FLYWHEEL_RESPAWN_WINDOW_MS) stops an infinite
 * relaunch loop: past the cap, escalate to paused+troubled. `hasActiveRun` false
 * ⇒ the operator stopped the flywheel deliberately ⇒ do not resurrect.
 */
export function decideFlywheelRemediation(opts: {
  hasActiveRun: boolean;
  prev: StuckRemediationState | null;
  now: number;
}): FlywheelRemediationDecision {
  if (!opts.hasActiveRun) return { kind: 'noop' };
  const lastRespawnMs = opts.prev?.lastRespawnAt ? new Date(opts.prev.lastRespawnAt).getTime() : 0;
  const withinWindow = Number.isFinite(lastRespawnMs) && opts.now - lastRespawnMs < FLYWHEEL_RESPAWN_WINDOW_MS;
  const respawnCount = withinWindow ? opts.prev?.respawnCount ?? 0 : 0;
  if (respawnCount >= FLYWHEEL_MAX_RESPAWNS) return { kind: 'escalate', respawnCount };
  return { kind: 'relaunch', respawnCount: respawnCount + 1 };
}

/** True when the orchestrator's process is actually gone (session missing or dead pane). */
function isFlywheelOrchestratorDead(agentId: string): boolean {
  if (!sessionExistsSync(agentId)) return true;
  return listPaneValuesSync(agentId, '#{pane_dead}').some((v) => v === '1');
}

/**
 * Recover a dead or wedged flywheel orchestrator: relaunch (capped) or, past the
 * cap, pause+trouble. `reason` describes why recovery fired (death vs wedge) for
 * the deacon log. NO_RESUME is intentionally NOT consulted (see header comment) —
 * the operator gate is the active run (`pan flywheel stop`) / patrol freeze.
 */
async function remediateFlywheelOrchestrator(
  agentId: string,
  now: number,
  actions: string[],
  reason: string,
): Promise<void> {
  const decision = decideFlywheelRemediation({
    hasActiveRun: Boolean(getFlywheelActiveRunId()),
    prev: readStuckRemediationState(agentId),
    now,
  });
  if (decision.kind === 'noop') return;

  const { resumeFlywheel, pauseFlywheel } = await import('./flywheel.js');
  const prev = readStuckRemediationState(agentId);
  const nowIso = new Date(now).toISOString();

  if (decision.kind === 'escalate') {
    await pauseFlywheel();
    markAgentTroubled(agentId);
    writeStuckRemediationState(agentId, {
      lastStage: 3,
      lastStageAt: nowIso,
      firstStuckAt: prev?.firstStuckAt ?? nowIso,
      respawnCount: decision.respawnCount,
      lastRespawnAt: prev?.lastRespawnAt,
    });
    logAction(
      actions,
      `[deacon] FLYWHEEL orchestrator ${reason} and exceeded ${FLYWHEEL_MAX_RESPAWNS} relaunches in ${FLYWHEEL_RESPAWN_WINDOW_MS / 60_000}min — paused + troubled; operator needed`,
    );
    return;
  }

  // Clear the dead/zombie/wedged tmux session so the fresh new-session won't
  // collide ("duplicate session" — the failure that defeated recovery in RUN-30).
  try {
    killSessionSync(agentId);
  } catch {
    /* best effort — session may already be gone */
  }

  try {
    await resumeFlywheel({ resumeCause: 'system' });
    writeStuckRemediationState(agentId, {
      lastStage: 0,
      lastStageAt: nowIso,
      firstStuckAt: nowIso,
      respawnCount: decision.respawnCount,
      lastRespawnAt: nowIso,
    });
    logAction(
      actions,
      `[deacon] FLYWHEEL orchestrator ${reason} — fresh-launched (relaunch ${decision.respawnCount}/${FLYWHEEL_MAX_RESPAWNS})`,
    );
  } catch (error) {
    logAction(
      actions,
      `[deacon] FLYWHEEL orchestrator ${reason} — relaunch FAILED: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function evaluateFlywheelOrchestrator(
  agent: AgentState,
  config: StuckRemediationConfig,
  now: number,
  actions: string[],
): Promise<void> {
  const agentId = agent.id;

  // Dead process ≠ idle agent. Check real liveness via tmux first — the runtime
  // mirror lies (stays "active") when omp dies without updating it (RUN-30).
  if (isFlywheelOrchestratorDead(agentId)) {
    await remediateFlywheelOrchestrator(agentId, now, actions, `DIED (${describeAgentDeath(agentId)})`);
    return;
  }

  if (!isAgentIdleForNudge(agentId, 5 * 60 * 1000, now)) return;

  const runtime = getAgentRuntimeStateSync(agentId);
  if (!runtime?.lastActivity) return;

  const lastActivityMs = new Date(runtime.lastActivity).getTime();
  if (!Number.isFinite(lastActivityMs)) return;

  const stuckState = readStuckRemediationState(agentId);
  if (stuckState) {
    const firstStuckMs = new Date(stuckState.firstStuckAt).getTime();
    if (Number.isFinite(firstStuckMs) && lastActivityMs > firstStuckMs) {
      clearStuckRemediationState(agentId);
      return;
    }
  }

  const idleMinutes = Math.floor((now - lastActivityMs) / 60_000);
  const lastStage = stuckState?.lastStage ?? 0;
  const firstStuck = firstStuckAt(runtime.lastActivity, stuckState);

  // PAN-2160: the terminal idle stage RELAUNCHES the wedged orchestrator (capped),
  // it never pause+troubles it. RUN-36 was parked here at idleMin=205 and the
  // whole pipeline stalled.
  if (idleMinutes >= config.flywheel_stage3_minutes && lastStage < 3) {
    await remediateFlywheelOrchestrator(agentId, now, actions, `wedged (idle ${idleMinutes}min)`);
    return;
  }

  if (idleMinutes >= config.flywheel_stage2_minutes && lastStage < 2) {
    const message = `Stage 2: idle ${idleMinutes} min — run a FULL flywheel tick NOW: inventory -> diagnose -> suggest -> launch ready work -> \`pan flywheel emit-status\`. Then call ScheduleWakeup(delaySeconds:1000) to arm the next tick. Do NOT ask the operator a question, do NOT wait, and do NOT just emit a stale status or pause.`;
    await messageAgent(agentId, message);
    writeStuckRemediationState(agentId, stageState(2, now, firstStuck, stuckState));
    logAction(actions, transitionAction(2, 'FLYWHEEL', idleMinutes, 'escalated-nudge'));
    return;
  }

  if (idleMinutes >= config.flywheel_stage1_minutes && lastStage < 1) {
    const message = `You appear stuck — ${idleMinutes} min since your last tick. Run a FULL flywheel tick NOW: inventory -> diagnose -> suggest -> launch ready work -> \`pan flywheel emit-status\`. Then call ScheduleWakeup(delaySeconds:1000) to arm the next tick. Do NOT ask the operator a question, do NOT wait, and do NOT just emit a stale status or pause.`;
    await messageAgent(agentId, message);
    writeStuckRemediationState(agentId, stageState(1, now, firstStuck, stuckState));
    logAction(actions, transitionAction(1, 'FLYWHEEL', idleMinutes, 'poked'));
  }
}

async function reconcileActiveFlywheelWithoutRunningAgent(now: number, actions: string[]): Promise<void> {
  if (!getFlywheelActiveRunId()) return;
  if (isFlywheelGloballyPaused()) return;
  if (sessionExistsSync(FLYWHEEL_ORCHESTRATOR_AGENT_ID)) return;

  await remediateFlywheelOrchestrator(
    FLYWHEEL_ORCHESTRATOR_AGENT_ID,
    now,
    actions,
    `DIED (${describeAgentDeath(FLYWHEEL_ORCHESTRATOR_AGENT_ID)})`,
  );
}

export async function checkStuckAgentRemediation(opts: StuckRemediationOptions = {}): Promise<string[]> {
  const config = loadCloisterConfigSync().stuck_remediation ?? DEFAULT_CLOISTER_CONFIG.stuck_remediation!;
  if (!config.enabled) return [];

  const actions: string[] = [];
  const now = opts.now ?? Date.now();
  const runningAgents = listRunningAgentsSync();
  let sawFlywheelOrchestrator = false;

  for (const agent of runningAgents) {
    if (agent.id === FLYWHEEL_ORCHESTRATOR_AGENT_ID || agent.role === 'flywheel') {
      sawFlywheelOrchestrator = true;
    }
    try {
      await evaluateAgent(agent, config, now, actions);
    } catch (error) {
      const agentId = agent.id || '(unknown)';
      const message = `[deacon] stuck-remediation agent=${agentId} error=${error instanceof Error ? error.message : String(error)}`;
      console.error(message, error);
      logDeaconEventSync(message);
    }
  }

  if (!sawFlywheelOrchestrator) {
    try {
      await reconcileActiveFlywheelWithoutRunningAgent(now, actions);
    } catch (error) {
      const message = `[deacon] stuck-remediation agent=${FLYWHEEL_ORCHESTRATOR_AGENT_ID} error=${error instanceof Error ? error.message : String(error)}`;
      console.error(message, error);
      logDeaconEventSync(message);
    }
  }

  return actions;
}

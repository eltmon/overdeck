import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  getAgentRuntimeStateSync,
  listRunningAgentsSync,
  markAgentTroubled,
  messageAgent,
  resumeAgent,
  type AgentState,
} from '../agents.js';
import { logDeaconEventSync } from '../persistent-logger.js';
import { getReviewStatusSync, type ReviewStatus } from '../review-status.js';
import { sessionExistsSync, killSessionSync, listPaneValuesSync } from '../tmux.js';
import { loadCloisterConfigSync, DEFAULT_CLOISTER_CONFIG, type StuckRemediationConfig } from './config.js';
import { isAgentIdleForNudge } from './agent-idle.js';
import { describeAgentDeath } from './agent-death.js';
import { getFlywheelActiveRunId, isFlywheelGloballyPaused } from '../overdeck/control-settings.js';
import {
  clearStuckRemediationState,
  readStuckRemediationState,
  writeStuckRemediationState,
  type StuckRemediationState,
} from './stuck-remediation-state.js';

const execFileAsync = promisify(execFile);

export interface StuckRemediationOptions {
  now?: number;
}

function issueIdForAgent(agent: AgentState): string {
  return agent.issueId || agent.id.replace(/^agent-/, '').toUpperCase();
}

function shouldSkipReviewStatus(status: ReviewStatus | null): boolean {
  if (!status) return false;
  if (status.stuck || status.deaconIgnored || status.mergeStatus === 'merged' || status.readyForMerge) return true;
  if (status.reviewStatus === 'blocked' || status.reviewStatus === 'failed') return true;
  return status.verificationStatus === 'failed' || status.testStatus === 'failed';
}

async function hasReadyBeads(agent: AgentState, issueLabel: string): Promise<boolean> {
  const { stdout } = await execFileAsync('bd', ['ready', '-l', issueLabel], {
    cwd: agent.workspace,
    encoding: 'utf-8',
    timeout: 10_000,
  });
  return String(stdout)
    .split('\n')
    .some((line) => /^[○◐]\s+workspace-/i.test(line.trim()));
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
  if (agent.role !== 'work') return;

  const issueId = issueIdForAgent(agent);
  const reviewStatus = getReviewStatusSync(issueId);
  if (shouldSkipReviewStatus(reviewStatus)) return;
  if (!isAgentIdleForNudge(agentId, 5 * 60 * 1000, now)) return;
  if (await hasReadyBeads(agent, issueId.toLowerCase())) return;

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

  if (idleMinutes >= config.stage3_minutes && lastStage < 3) {
    markAgentTroubled(agentId);
    writeStuckRemediationState(agentId, stageState(3, now, firstStuck));
    logAction(actions, transitionAction(3, issueId, idleMinutes, 'marked-troubled'));
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
    await resumeFlywheel();
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

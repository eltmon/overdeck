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
import { getNoResumeMode } from './no-resume-mode.js';
import { describeAgentDeath } from './agent-death.js';
import { getFlywheelActiveRunId } from '../overdeck/control-settings.js';
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

function stageState(stage: 1 | 2 | 3, now: number, firstStuck: string): StuckRemediationState {
  return {
    lastStage: stage,
    lastStageAt: new Date(now).toISOString(),
    firstStuckAt: firstStuck,
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
// `pan flywheel emit-status`), so a long silence indicates a stuck model
// call or a dropped tick loop — not the natural between-task idleness that
// work agents exhibit. Stage 2 escalates to pauseFlywheel() instead of
// resumeAgent(): pausing preserves run state for human inspection and
// matches what an operator would do manually on noticing a stall.
// PAN-2108: the flywheel orchestrator runs on the ohmypi (omp) harness, which
// has no ScheduleWakeup tool to self-perpetuate and is driven by deacon nudges.
// When its omp process DIES (RUN-30: silent crash mid-run), the runtime mirror
// goes stale-but-"active", so the idle-nudge path keeps nudging a corpse and the
// generic resume can't revive a dead omp — the flywheel stops permanently. The
// orchestrator is the pipeline's last stand, so a dead orchestrator must
// self-heal: kill the zombie session and fresh-launch the run, capped so a
// crash loop escalates to paused+troubled instead of respawning forever.
const FLYWHEEL_RESPAWN_WINDOW_MS = 30 * 60 * 1000;
const FLYWHEEL_MAX_RESPAWNS = 3;

/** True when the orchestrator's process is actually gone (session missing or dead pane). */
function isFlywheelOrchestratorDead(agentId: string): boolean {
  if (!sessionExistsSync(agentId)) return true;
  return listPaneValuesSync(agentId, '#{pane_dead}').some((v) => v === '1');
}

async function recoverDeadFlywheelOrchestrator(
  agentId: string,
  now: number,
  actions: string[],
): Promise<void> {
  const reason = describeAgentDeath(agentId);

  // Respect the boot kill-switch — an operator who booted --no-resume does not
  // want the deacon resurrecting agents. Surface the death so it's diagnosable.
  if (getNoResumeMode().active) {
    logAction(actions, `[deacon] FLYWHEEL orchestrator DIED (${reason}) — OVERDECK_NO_RESUME=1, not auto-relaunching`);
    return;
  }

  const { resumeFlywheel, pauseFlywheel } = await import('./flywheel.js');

  // No active run ⇒ the operator stopped the flywheel deliberately; do not resurrect.
  if (!getFlywheelActiveRunId()) return;

  const prev = readStuckRemediationState(agentId);
  const lastRespawnMs = prev?.lastRespawnAt ? new Date(prev.lastRespawnAt).getTime() : 0;
  const withinWindow = Number.isFinite(lastRespawnMs) && now - lastRespawnMs < FLYWHEEL_RESPAWN_WINDOW_MS;
  const respawnCount = withinWindow ? prev?.respawnCount ?? 0 : 0;
  const nowIso = new Date(now).toISOString();

  if (respawnCount >= FLYWHEEL_MAX_RESPAWNS) {
    await pauseFlywheel();
    markAgentTroubled(agentId);
    writeStuckRemediationState(agentId, {
      lastStage: 3,
      lastStageAt: nowIso,
      firstStuckAt: prev?.firstStuckAt ?? nowIso,
      respawnCount,
      lastRespawnAt: prev?.lastRespawnAt,
    });
    logAction(
      actions,
      `[deacon] FLYWHEEL orchestrator DIED (${reason}) and exceeded ${FLYWHEEL_MAX_RESPAWNS} relaunches in ${FLYWHEEL_RESPAWN_WINDOW_MS / 60_000}min — paused + troubled; operator needed`,
    );
    return;
  }

  // Clear the dead/zombie tmux session so the fresh new-session won't collide
  // ("duplicate session" — the exact failure that defeated recovery in RUN-30).
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
      respawnCount: respawnCount + 1,
      lastRespawnAt: nowIso,
    });
    logAction(
      actions,
      `[deacon] FLYWHEEL orchestrator DIED (${reason}) — fresh-launched (relaunch ${respawnCount + 1}/${FLYWHEEL_MAX_RESPAWNS})`,
    );
  } catch (error) {
    logAction(
      actions,
      `[deacon] FLYWHEEL orchestrator DIED (${reason}) — relaunch FAILED: ${error instanceof Error ? error.message : String(error)}`,
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
    await recoverDeadFlywheelOrchestrator(agentId, now, actions);
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

  if (idleMinutes >= config.stage3_minutes && lastStage < 3) {
    const { pauseFlywheel } = await import('./flywheel.js');
    await pauseFlywheel();
    markAgentTroubled(agentId);
    writeStuckRemediationState(agentId, stageState(3, now, firstStuck));
    logAction(actions, transitionAction(3, 'FLYWHEEL', idleMinutes, 'paused-and-troubled'));
    return;
  }

  if (idleMinutes >= config.stage2_minutes && lastStage < 2) {
    const message = `Stage 2: idle ${idleMinutes} min — flywheel ticks should be sub-minute. Emit a status snapshot via \`pan flywheel emit-status\` or run \`pan flywheel pause\` to hand off cleanly.`;
    await messageAgent(agentId, message);
    writeStuckRemediationState(agentId, stageState(2, now, firstStuck));
    logAction(actions, transitionAction(2, 'FLYWHEEL', idleMinutes, 'escalated-nudge'));
    return;
  }

  if (idleMinutes >= config.stage1_minutes && lastStage < 1) {
    const message = `You appear stuck — ${idleMinutes} min since last tick. Flywheel ticks should complete in under a minute. Emit a current status via \`pan flywheel emit-status --file <path>\`, or run \`pan flywheel pause\` if you're done.`;
    await messageAgent(agentId, message);
    writeStuckRemediationState(agentId, stageState(1, now, firstStuck));
    logAction(actions, transitionAction(1, 'FLYWHEEL', idleMinutes, 'poked'));
  }
}

export async function checkStuckAgentRemediation(opts: StuckRemediationOptions = {}): Promise<string[]> {
  const config = loadCloisterConfigSync().stuck_remediation ?? DEFAULT_CLOISTER_CONFIG.stuck_remediation!;
  if (!config.enabled) return [];

  const actions: string[] = [];
  const now = opts.now ?? Date.now();

  for (const agent of listRunningAgentsSync()) {
    try {
      await evaluateAgent(agent, config, now, actions);
    } catch (error) {
      const agentId = agent.id || '(unknown)';
      const message = `[deacon] stuck-remediation agent=${agentId} error=${error instanceof Error ? error.message : String(error)}`;
      console.error(message, error);
      logDeaconEventSync(message);
    }
  }

  return actions;
}

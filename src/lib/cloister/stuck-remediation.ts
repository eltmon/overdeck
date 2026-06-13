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
import { sessionExistsSync } from '../tmux.js';
import { sessionFilePath } from '../paths.js';
import { loadCloisterConfigSync, DEFAULT_CLOISTER_CONFIG, type StuckRemediationConfig } from './config.js';
import { isAgentIdleForNudge } from './agent-idle.js';
import {
  clearStuckRemediationState,
  readStuckRemediationState,
  writeStuckRemediationState,
  type StuckRemediationState,
} from './stuck-remediation-state.js';

const execFileAsync = promisify(execFile);

/**
 * PAN-1865: context-usage threshold at which a stuck work agent is treated as
 * context-ceiling-wedged rather than a generic stall. Normal nudges/resumes
 * re-send the same oversized context, so we escalate to out-of-band compact
 * recovery (resumeAgent({compact:true})) instead.
 *
 * Deliberately higher than the proactive /compact high-water mark so this path
 * only fires for agents that have already pinned themselves near the hard
 * ceiling.
 */
const CONTEXT_OVERFLOW_RECOVERY_THRESHOLD_PERCENT = 95;

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

async function getAgentContextUsage(agent: AgentState): Promise<{ percentUsed: number } | null> {
  const runtimeState = getAgentRuntimeStateSync(agent.id);
  const sessionId = agent.sessionId ?? runtimeState?.claudeSessionId;
  if (!agent.workspace || !sessionId || !agent.model) return null;

  try {
    const { computeContextUsage } = await import('../../dashboard/server/services/conversation-service.js');
    return await computeContextUsage(sessionFilePath(agent.workspace, sessionId), agent.model);
  } catch {
    return null;
  }
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
  if (!sessionExistsSync(agentId)) return;
  const completedAt = (agent as AgentState & { completedAt?: string }).completedAt;
  if (agent.paused || agent.troubled || completedAt) return;

  if (agent.role === 'flywheel') {
    await evaluateFlywheelOrchestrator(agent, config, now, actions);
    return;
  }
  if (agent.role !== 'work') return;

  const issueId = issueIdForAgent(agent);
  const reviewStatus = getReviewStatusSync(issueId);
  if (shouldSkipReviewStatus(reviewStatus)) return;
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
  let lastStage = stuckState?.lastStage ?? 0;
  const firstStuck = firstStuckAt(runtime.lastActivity, stuckState);

  // PAN-1865: a work agent pinned near the context ceiling is not a normal
  // stall — nudging or normal-resuming just re-sends the same oversized
  // context. Try out-of-band compaction + fresh-session reseed before any
  // further escalation. A context-wedged agent must not be hidden by the
  // "has ready beads" heuristic; it cannot make progress regardless of beads.
  let contextOverflowWedged = false;
  if (idleMinutes >= config.stage2_minutes && lastStage < 2) {
    const contextUsage = await getAgentContextUsage(agent);
    if (contextUsage && contextUsage.percentUsed >= CONTEXT_OVERFLOW_RECOVERY_THRESHOLD_PERCENT) {
      const result = await resumeAgent(agentId, undefined, { compact: true });
      if (result.success) {
        clearStuckRemediationState(agentId);
        logAction(
          actions,
          `[deacon] stuck-remediation context-overflow issue=${issueId} idleMin=${idleMinutes} action=compact-recovered (${Math.round(contextUsage.percentUsed)}%)`,
        );
        return;
      }
      // Compact attempt failed. Advance to stage 2 so we do not retry every
      // patrol cycle, and bypass the ready-beads guard so the agent still
      // escalates to stage 3 (marked-troubled) if it stays wedged. Update the
      // in-memory stage so the subsequent stage-2 block does not immediately
      // run a normal resume.
      contextOverflowWedged = true;
      writeStuckRemediationState(agentId, stageState(2, now, firstStuck));
      lastStage = 2;
    }
  }

  if (!contextOverflowWedged && await hasReadyBeads(agent, issueId.toLowerCase())) return;

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
      const action = transitionAction(2, issueId, idleMinutes, 'resume-failed');
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
async function evaluateFlywheelOrchestrator(
  agent: AgentState,
  config: StuckRemediationConfig,
  now: number,
  actions: string[],
): Promise<void> {
  const agentId = agent.id;
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

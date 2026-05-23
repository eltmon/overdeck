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
import { loadCloisterConfigSync, DEFAULT_CLOISTER_CONFIG, type StuckRemediationConfig } from './config.js';
import { isAgentIdleForNudge } from './agent-idle.js';
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
  if (agent.role !== 'work' || agent.status !== 'running') return;
  if (!sessionExistsSync(agentId)) return;
  const completedAt = (agent as AgentState & { completedAt?: string }).completedAt;
  if (agent.paused || agent.troubled || completedAt) return;

  const issueId = issueIdForAgent(agent);
  const reviewStatus = getReviewStatusSync(issueId);
  if (shouldSkipReviewStatus(reviewStatus)) return;
  if (!isAgentIdleForNudge(agentId)) return;
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

import type { AgentState } from '../agents.js';
import { spawnRun, stopAgentAsync } from '../agents.js';
import {
  getFlywheelActiveRunId,
  setFlywheelActiveRunId,
  setFlywheelGloballyPaused,
} from '../database/app-settings.js';

export const FLYWHEEL_ORCHESTRATOR_AGENT_ID = 'flywheel-orchestrator';

export interface FlywheelLifecycleOptions {
  runId?: string;
  workspace?: string;
  prompt?: string;
  model?: string;
  harness?: 'claude-code' | 'pi';
  env?: NodeJS.ProcessEnv;
}

export interface FlywheelPauseResult {
  activeRunId: string | null;
}

export interface FlywheelResumeResult {
  activeRunId: string;
  agent: AgentState;
}

function defaultFlywheelRunId(): string {
  return `RUN-${Date.now()}`;
}

function defaultFlywheelPrompt(runId: string): string {
  return `FLYWHEEL ORCHESTRATOR TASK for ${runId}:

Run the Fix-All Flywheel loop. Keep status snapshots current, coordinate Panopticon roles through the normal pipeline surfaces, and wait for explicit lifecycle instructions when the run is paused or complete.`;
}

export function isFlywheelDevcontainerRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  const disabledDeacon = env.PANOPTICON_DISABLE_DEACON?.toLowerCase();
  if (disabledDeacon === '1' || disabledDeacon === 'true') return true;

  const hostname = env.HOSTNAME?.toLowerCase() ?? '';
  return hostname.includes('devcontainer') || hostname.startsWith('api-feature-') || hostname.startsWith('workspace-');
}

async function spawnFlywheelAgent(runId: string, options: FlywheelLifecycleOptions = {}): Promise<AgentState> {
  return spawnRun(runId, 'plan', {
    agentId: FLYWHEEL_ORCHESTRATOR_AGENT_ID,
    workspace: options.workspace ?? process.cwd(),
    prompt: options.prompt ?? defaultFlywheelPrompt(runId),
    model: options.model,
    harness: options.harness,
    allowHost: true,
    registerConversation: true,
  });
}

export async function spawnFlywheel(options: FlywheelLifecycleOptions = {}): Promise<AgentState> {
  if (isFlywheelDevcontainerRuntime(options.env)) {
    throw new Error('Refusing to spawn flywheel-orchestrator inside a workspace devcontainer');
  }

  const activeRunId = getFlywheelActiveRunId();
  if (activeRunId) {
    throw new Error(`Flywheel run ${activeRunId} is already active; pause, resume, or report it before starting another run`);
  }

  const runId = options.runId ?? defaultFlywheelRunId();
  const agent = await spawnFlywheelAgent(runId, options);
  setFlywheelActiveRunId(runId);
  setFlywheelGloballyPaused(false);
  return agent;
}

export async function pauseFlywheel(): Promise<FlywheelPauseResult> {
  const activeRunId = getFlywheelActiveRunId();
  setFlywheelGloballyPaused(true);
  await stopAgentAsync(FLYWHEEL_ORCHESTRATOR_AGENT_ID);
  return { activeRunId };
}

export async function resumeFlywheel(options: FlywheelLifecycleOptions = {}): Promise<FlywheelResumeResult> {
  if (isFlywheelDevcontainerRuntime(options.env)) {
    throw new Error('Refusing to resume flywheel-orchestrator inside a workspace devcontainer');
  }

  const activeRunId = getFlywheelActiveRunId();
  if (!activeRunId) {
    throw new Error('No active flywheel run to resume');
  }

  setFlywheelGloballyPaused(false);
  const agent = await spawnFlywheelAgent(activeRunId, options);
  return { activeRunId, agent };
}

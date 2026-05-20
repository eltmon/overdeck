import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Schema } from 'effect';
import { FlywheelRunId } from '@panctl/contracts';
import type { AgentState } from '../agents.js';
import type { FlywheelScope, RoleEffort } from '../config-yaml.js';
import { getAgentDir, spawnRun, stopAgentAsync } from '../agents.js';
import {
  getFlywheelActiveRunId,
  setFlywheelActiveRunId,
  setFlywheelGloballyPaused,
} from '../database/app-settings.js';
import { resolveLiveFlywheelRunId } from '../../dashboard/server/services/flywheel-run-state.js';

export const FLYWHEEL_ORCHESTRATOR_AGENT_ID = 'flywheel-orchestrator';

const decodeFlywheelRunId = Schema.decodeUnknownSync(FlywheelRunId);

export interface FlywheelLifecycleOptions {
  runId?: FlywheelRunId;
  workspace?: string;
  briefPath?: string;
  prompt?: string;
  model?: string;
  harness?: 'claude-code' | 'pi';
  effort?: RoleEffort;
  maxAgents?: number;
  scope?: FlywheelScope;
  env?: NodeJS.ProcessEnv;
  resumeSessionId?: string;
}

export interface FlywheelPauseResult {
  activeRunId: string | null;
}

export interface FlywheelResumeResult {
  activeRunId: string;
  agent: AgentState;
}

function parseRunId(runId: string): FlywheelRunId {
  return decodeFlywheelRunId(runId);
}

function defaultFlywheelRunId(): FlywheelRunId {
  return parseRunId(`RUN-${Date.now()}`);
}

function defaultFlywheelPrompt(runId: string, options: FlywheelLifecycleOptions, briefContent?: string): string {
  const configLines = [
    options.harness ? `Harness: ${options.harness}` : undefined,
    options.effort ? `Effort: ${options.effort}` : undefined,
    options.maxAgents ? `Max concurrent agents: ${options.maxAgents}` : undefined,
    options.scope ? `Scope: ${options.scope}` : undefined,
  ].filter(Boolean).join('\n');
  const configSection = configLines ? `\n\nRun configuration:\n${configLines}` : '';
  const briefSection = options.briefPath
    ? `\n\nBrief path: ${options.briefPath}\n\n${briefContent ?? ''}`
    : '';
  return `FLYWHEEL ORCHESTRATOR TASK for ${runId}:

Run the Fix-All Flywheel loop. Keep status snapshots current, coordinate Panopticon roles through the normal pipeline surfaces, respect the configured run scope and agent cap, and wait for explicit lifecycle instructions when the run is paused or complete.${configSection}${briefSection}`;
}

function getLocalFlywheelRunDir(runId: string): string {
  const panopticonHome = process.env.PANOPTICON_HOME ?? join(homedir(), '.panopticon');
  return join(panopticonHome, 'flywheel', 'runs', runId);
}

export async function saveResumeSessionId(runId: string, sessionId: string): Promise<void> {
  const runDir = getLocalFlywheelRunDir(runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(
    join(runDir, 'resume-session.json'),
    JSON.stringify({ sessionId, pausedAt: new Date().toISOString() }),
    'utf-8',
  );
}

export async function loadResumeSessionId(runId: string): Promise<string | null> {
  try {
    const raw = await readFile(join(getLocalFlywheelRunDir(runId), 'resume-session.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { sessionId?: unknown };
    return typeof parsed.sessionId === 'string' ? parsed.sessionId : null;
  } catch {
    return null;
  }
}

export function isFlywheelDevcontainerRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  const disabledDeacon = env.PANOPTICON_DISABLE_DEACON?.toLowerCase();
  if (disabledDeacon === '1' || disabledDeacon === 'true') return true;

  const hostname = env.HOSTNAME?.toLowerCase() ?? '';
  return hostname.includes('devcontainer') || hostname.startsWith('api-feature-') || hostname.startsWith('workspace-');
}

export async function spawnFlywheelAgent(runId: string, options: FlywheelLifecycleOptions = {}): Promise<AgentState> {
  const briefContent = options.briefPath ? await readFile(options.briefPath, 'utf8') : undefined;
  const prompt = options.resumeSessionId
    ? 'FLYWHEEL RESUME: You were paused by the operator. Resume the tick loop from your prior state. Check `docs/FLYWHEEL-STATE.md` and the latest status snapshot for context.'
    : (options.prompt ?? defaultFlywheelPrompt(runId, options, briefContent));
  return spawnRun(runId, 'flywheel', {
    agentId: FLYWHEEL_ORCHESTRATOR_AGENT_ID,
    workspace: options.workspace ?? process.cwd(),
    prompt,
    model: options.model,
    harness: options.harness,
    effort: options.effort,
    allowHost: true,
    registerConversation: true,
    resumeSessionId: options.resumeSessionId,
  });
}

export async function spawnFlywheel(options: FlywheelLifecycleOptions = {}): Promise<AgentState> {
  if (isFlywheelDevcontainerRuntime(options.env)) {
    throw new Error('Refusing to spawn flywheel-orchestrator inside a workspace devcontainer');
  }

  // Self-healing gate check (PAN-1245): if the SQLite gate points at a run
  // that has already ended (report.md/aborted.json) or whose on-disk state is
  // gone (post-reboot, post-wipe), resolveLiveFlywheelRunId clears the gate
  // and returns null. Only a genuinely live prior run blocks a new start.
  const activeRunId = await resolveLiveFlywheelRunId();
  if (activeRunId) {
    throw new Error(`Flywheel run ${activeRunId} is already active; pause, resume, or report it before starting another run`);
  }

  const runId = options.runId ? parseRunId(options.runId) : defaultFlywheelRunId();
  const agent = await spawnFlywheelAgent(runId, options);
  setFlywheelActiveRunId(runId);
  setFlywheelGloballyPaused(false);
  return agent;
}

export async function pauseFlywheel(): Promise<FlywheelPauseResult> {
  const activeRunId = getFlywheelActiveRunId();
  if (activeRunId) {
    try {
      const sessionId = (await readFile(join(getAgentDir(FLYWHEEL_ORCHESTRATOR_AGENT_ID), 'session.id'), 'utf-8')).trim();
      if (sessionId) await saveResumeSessionId(activeRunId, sessionId);
    } catch { /* non-fatal: resume falls back to fresh if session.id is missing */ }
  }
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
  const runId = parseRunId(activeRunId);

  const resumeSessionId = options.resumeSessionId ?? await loadResumeSessionId(runId) ?? undefined;
  const agent = await spawnFlywheelAgent(runId, { ...options, resumeSessionId });
  setFlywheelGloballyPaused(false);
  return { activeRunId, agent };
}

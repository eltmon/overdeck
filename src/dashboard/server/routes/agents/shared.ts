import { exec, execFile, spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Effect } from 'effect';
import { HttpServerRequest } from 'effect/unstable/http';
import type { AgentStatus } from '@overdeck/contracts';

import { jsonResponse } from '../../http-helpers.js';
import { getHeaderFromMap } from '../origin-validation.js';
import { getOverdeckHome } from '../../../../lib/paths.js';
import { panCliInvocation } from '../../../../lib/pan-cli-invocation.js';
import {
  getAgentDir,
  getLatestSessionIdSync,
  normalizeAgentId,
  type AgentRuntimeState,
  type AgentState,
} from '../../../../lib/agents.js';
import { resolveProjectFromIssueSync } from '../../../../lib/projects.js';
import { getGitHubConfig } from '../../services/tracker-config.js';
import { getClosedIssueIdsForReadSource } from '../../read-model.js';
import { recordFeatureRegistryLifecycle } from '../../../../lib/registry/feature-registry-population.js';
import {
  getClaudeProjectDir as getClaudeProjectDirShared,
  getActiveSessionPath as getActiveSessionPathShared,
  getAgentWorkspace as getAgentWorkspaceShared,
  getAgentJsonlPath as getAgentJsonlPathShared,
  getPendingQuestions as getPendingQuestionsShared,
  getAgentPendingQuestions as getAgentPendingQuestionsShared,
} from '../../../../lib/agent-enrichment.js';
import type { WorkAgentLifecycleState, WorkAgentRecommendedAction } from '../../../../lib/work-agent-lifecycle.js';
import { emitActivityEntrySync } from '../../../../lib/activity-logger.js';
import { getResourceConfig, type HealthLeakedSpecialist, type SystemHealthSnapshot } from '../../services/system-health-service.js';
import { classifyMemoryPressure } from '../../../../lib/cloister/memory-governor.js';
import { capturePane } from '../../../../lib/tmux.js';
import type { RuntimeName } from '../../../../lib/runtimes/types.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

type StartAgentPhase = 'stackHealthGate' | 'guardrails' | 'spawn';

export function buildPanStartArgs(input: {
  issueId: string;
  model: string;
  harness?: RuntimeName | null;
  allowHost?: boolean;
}): string[] {
  return [
    'start',
    input.issueId,
    '--local',
    '--model',
    input.model,
    ...(input.harness ? ['--harness', input.harness] : []),
    ...(input.allowHost ? ['--host', '--yes'] : []),
  ];
}

/**
 * PAN-1985: detached-spawn helper for `pan <args>`, shared between the
 * standard work-spawn route and the restart-fresh route. Opens a spawn.log
 * inside the agent dir (creating the dir if missing — the dir may have been
 * just wiped), spawns `pan` detached with stdio to that log, and resolves
 * with an activity id once the child closes with code 0. Throws an Error
 * with the log contents attached on non-zero exit.
 */
export async function spawnPanCommandDetached(input: {
  agentSessionName: string;
  issueId: string;
  role: string;
  workspacePath: string;
  args: string[];
  cwd?: string;
}): Promise<string> {
  const { agentSessionName, issueId, role, workspacePath, args } = input;
  const cwd = input.cwd ?? workspacePath;
  const activityId = `activity-${Date.now()}`;
  const agentDir = join(homedir(), '.overdeck', 'agents', agentSessionName);
  await mkdir(agentDir, { recursive: true });
  const spawnLogPath = join(agentDir, 'spawn.log');
  const spawnLogHandle = await open(spawnLogPath, 'a');
  const invocation = panCliInvocation(args);
  const child = spawn(invocation.command, invocation.args, {
    cwd,
    detached: true,
    stdio: ['ignore', spawnLogHandle.fd, spawnLogHandle.fd],
  });
  child.once('spawn', () => {
    void appendAgentLifecycleLog(agentSessionName, 'agent.work_spawn_process_spawned', {
      issueId,
      role,
      workspacePath,
      activityId,
      pid: child.pid,
      args,
      cwd,
      spawnLogPath,
    }).catch(() => undefined);
  });
  try {
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once('error', (error) => {
        void appendAgentLifecycleLog(agentSessionName, 'agent.work_spawn_process_error', {
          issueId,
          role,
          workspacePath,
          activityId,
          error: error.message,
          args,
          cwd,
          spawnLogPath,
        }).catch(() => undefined);
        reject(error);
      });
      child.once('close', (code, signal) => {
        void appendAgentLifecycleLog(agentSessionName, 'agent.work_spawn_process_closed', {
          issueId,
          role,
          workspacePath,
          activityId,
          code,
          signal,
          args,
          cwd,
          spawnLogPath,
        }).catch(() => undefined);
        resolve({ code, signal });
      });
    });
    if (result.code !== 0) {
      const output = await readFile(spawnLogPath, 'utf-8').catch(() => '');
      const error = new Error(output.trim() || `pan ${args.join(' ')} exited with code ${result.code ?? 'null'}`);
      Object.assign(error, { activityId, spawnLogPath, code: result.code, signal: result.signal, output });
      throw error;
    }
    return activityId;
  } finally {
    await spawnLogHandle.close();
  }
}
type StartAgentPhaseStatus = 'start' | 'success' | 'failure' | 'skipped';

function emitStartAgentPhase(
  issueId: string,
  phase: StartAgentPhase,
  status: StartAgentPhaseStatus,
  reason: string,
  details: Record<string, unknown> = {},
): void {
  const timestamp = new Date().toISOString();
  emitActivityEntrySync({
    source: 'start-agent',
    level: status === 'failure' ? 'error' : status === 'skipped' ? 'warn' : 'info',
    message: `start-agent.phase=${phase}`,
    issueId: issueId.toUpperCase(),
    details: JSON.stringify({ issueId: issueId.toUpperCase(), timestamp, phase, status, reason, ...details }),
  });
}

const INTERNAL_TOKEN_HEADER = 'x-overdeck-internal-token';

function constantTimeTokenEqual(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const providedBuffer = Buffer.from(provided, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

async function readInternalTokenForRequest(): Promise<string | null> {
  const fromEnv = process.env.OVERDECK_INTERNAL_TOKEN;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  try {
    const token = (await readFile(join(getOverdeckHome(), 'internal-token'), 'utf8')).trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export async function validateAgentRuntimeEventAuth(
  request: HttpServerRequest.HttpServerRequest,
) {
  const expected = await readInternalTokenForRequest();
  if (!expected) {
    return {
      ok: false as const,
      response: jsonResponse({ success: false, error: 'internal token not configured' }, { status: 503 }),
    };
  }

  const provided = getHeaderFromMap(request.headers as Record<string, string | string[] | undefined>, INTERNAL_TOKEN_HEADER);
  if (constantTimeTokenEqual(provided, expected)) return { ok: true as const };
  return {
    ok: false as const,
    response: jsonResponse({ success: false, error: 'forbidden' }, { status: 403 }),
  };
}

async function appendAgentLifecycleLog(agentId: string, event: string, details: Record<string, unknown> = {}): Promise<void> {
  const agentDir = join(homedir(), '.overdeck', 'agents', agentId);
  await mkdir(agentDir, { recursive: true });
  const logLine = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    ...details,
  });
  await appendFile(join(agentDir, 'lifecycle.log'), logLine + '\n');
}

function updateRegistryForAgentStart(issueId: string, workspacePath: string, agentId: string): void {
  void recordFeatureRegistryLifecycle({
    issueId,
    workspacePath,
    agentId,
    status: 'active',
  });
}


// ─── Shared IssueDataService singleton ───────────────────────────────────────

function getIssueDataService(): import('../../services/issue-data-service.js').IssueDataService {
  const { getSharedIssueService } = require('../../services/issue-service-singleton.js');
  return getSharedIssueService();
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const AGENTS_CACHE_TTL_MS = 5000;
export const agentsCache: { data: unknown[] | null; timestamp: number } = { data: null, timestamp: 0 };

/** Invalidate the agents cache so the next request re-reads all agent state. */
export function invalidateAgentsCache(): void {
  agentsCache.data = null;
  agentsCache.timestamp = 0;
}

function filterClosedIssueAgents<T>(agents: T[], issues: unknown[]): T[] {
  const closedIssueIds = getClosedIssueIdsForReadSource(issues);
  if (closedIssueIds.size === 0) return agents;
  return agents.filter((agent) => {
    if (!agent || typeof agent !== 'object') return true;
    const issueId = (agent as { issueId?: unknown }).issueId;
    return typeof issueId !== 'string' || !closedIssueIds.has(issueId.toUpperCase());
  });
}

// ─── Local helpers ────────────────────────────────────────────────────────────

// Read the request body as unknown JSON
const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? (JSON.parse(text) ?? {}) : {};
  } catch {
    return {};
  }
});

function toAgentStatusPayload(status: AgentState['status'] | undefined): AgentStatus {
  return status === 'starting' || status === 'running' || status === 'stopped' || status === 'error'
    ? status
    : 'unknown';
}

function buildAgentControlEventPayload(state: AgentState, previousStatus?: AgentStatus) {
  return {
    agentId: state.id,
    issueId: state.issueId,
    status: toAgentStatusPayload(state.status),
    previousStatus,
    stoppedByUser: state.stoppedByUser === true,
    paused: state.paused === true,
    pausedReason: state.pausedReason ?? null,
    pausedAt: state.pausedAt ?? null,
    troubled: state.troubled === true,
    troubledAt: state.troubledAt ?? null,
    consecutiveFailures: state.consecutiveFailures ?? 0,
    firstFailureInRunAt: state.firstFailureInRunAt ?? null,
    lastFailureAt: state.lastFailureAt ?? null,
    lastFailureReason: state.lastFailureReason ?? null,
    lastFailureNextRetryAt: state.lastFailureNextRetryAt ?? null,
  };
}

function buildAgentGateFailureSnapshot(state: Partial<AgentState>) {
  return {
    stoppedByUser: state.stoppedByUser === true,
    paused: state.paused === true,
    pausedReason: state.pausedReason ?? null,
    pausedAt: state.pausedAt ?? null,
    troubled: state.troubled === true,
    troubledAt: state.troubledAt ?? null,
    consecutiveFailures: state.consecutiveFailures ?? 0,
    firstFailureInRunAt: state.firstFailureInRunAt ?? null,
    lastFailureAt: state.lastFailureAt ?? null,
    lastFailureReason: state.lastFailureReason ?? null,
    lastFailureNextRetryAt: state.lastFailureNextRetryAt ?? null,
  };
}

function buildStoppedAgentLifecycle(
  agentOrIssueId: string,
  state: Partial<AgentState>,
  runtimeData: Partial<AgentRuntimeState>,
): WorkAgentLifecycleState {
  const agentId = normalizeAgentId(agentOrIssueId);
  const hasAgentState = true;
  const hasLiveTmuxSession = false;
  // claudeSessionId only covers claude-code agents — codex agents keep their
  // resumable thread in codex-thread-id, which getLatestSessionIdSync resolves
  // (PAN-1988). Without the fallback the listing reports canResumeSession=false
  // for every stopped codex agent and the UI never offers Resume.
  const hasSavedSession = !!runtimeData.claudeSessionId || !!getLatestSessionIdSync(agentId);
  const hasWorkspace = typeof state.workspace === 'string' && state.workspace.length > 0;
  const agentStatus = state.status || 'unknown';
  const runtime = runtimeData.state || 'uninitialized';
  const isCompleted = runtimeData.resolution === 'completed';
  const isPlaceholder = agentStatus === 'starting' && typeof state.model === 'string' && state.model.startsWith('pending-');
  const isStopped = agentStatus === 'stopped' || agentStatus === 'error' || isCompleted || runtime === 'stopped' || runtime === 'idle' || runtime === 'suspended';
  const isRunning = false;
  const isCrashed = (agentStatus === 'running' || isPlaceholder) && !hasLiveTmuxSession;
  const isRunningButStuck = false;
  const hasResumableBackingState = hasAgentState && hasWorkspace && !isPlaceholder;
  const isOrphaned = !hasLiveTmuxSession && (
    (hasSavedSession && !hasResumableBackingState)
    || (hasAgentState && (!hasWorkspace || isPlaceholder))
  );
  const requiresSessionResetBeforeFreshStart = hasSavedSession && hasResumableBackingState && (isStopped || isCrashed);

  let recommendedAction: WorkAgentRecommendedAction = 'start';
  let reason: string | undefined;

  if (isOrphaned) {
    recommendedAction = 'start';
    reason = hasSavedSession
      ? `Agent ${agentId} has stale/orphaned session metadata without a resumable workspace-backed agent state. Start Agent should create a fresh session.`
      : `Agent ${agentId} is an orphaned placeholder/stale record. Start Agent should create a fresh session.`;
  } else if (requiresSessionResetBeforeFreshStart) {
    recommendedAction = 'resume';
    reason = `Agent ${agentId} has a resumable Claude session. Use 'pan resume ${agentOrIssueId}' to continue it, or 'pan start ${agentOrIssueId} --fresh' to start a new session (e.g. to switch model).`;
  } else if (hasAgentState && !hasSavedSession && isStopped) {
    recommendedAction = 'start';
    reason = `Agent ${agentId} is stopped and has no saved Claude session. Start Agent will create a fresh session in the existing workspace.`;
  }

  return {
    agentId,
    hasAgentState,
    hasLiveTmuxSession,
    hasSavedSession,
    hasWorkspace,
    isPlaceholder,
    isOrphaned,
    isRunning,
    isRunningButStuck,
    isStopped,
    isCompleted,
    isCrashed,
    runtimeState: runtime,
    agentStatus,
    canStartFresh: !requiresSessionResetBeforeFreshStart || isOrphaned,
    canResumeSession: hasSavedSession && hasResumableBackingState && (isStopped || isCrashed),
    canRestartWithContext: hasAgentState && hasWorkspace,
    canResetSession: hasSavedSession && hasResumableBackingState,
    requiresSessionResetBeforeFreshStart,
    recommendedAction,
    reason,
  };
}

async function readRemoteAgentState(agentId: string): Promise<Record<string, unknown>> {
  const remoteStateFile = join(homedir(), '.overdeck', 'agents', agentId, 'remote-state.json');
  if (!existsSync(remoteStateFile)) return {};
  try {
    return JSON.parse(await readFile(remoteStateFile, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function captureAgentOutputBeforeKill(agentId: string): Promise<void> {
  const output = await Effect.runPromise(
    capturePane(agentId, 5000).pipe(Effect.catch(() => Effect.succeed(''))),
  );
  if (!output) return;

  const agentDir = getAgentDir(agentId);
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, 'output.log'), output);
}

function buildHostOverrideConfirmation(issueId: string): string {
  return `I understand this bypasses workspace isolation for ${issueId.toUpperCase()}`;
}

function getProjectPath(linearProjectId?: string, issuePrefix?: string): string {
  if (issuePrefix) {
    const issueId = `${issuePrefix}-1`;
    const resolved = resolveProjectFromIssueSync(issueId);
    if (resolved) return resolved.projectPath;
    const config = getGitHubConfig();
    if (config) {
      for (const { owner, repo, prefix } of config.repos) {
        const repoPrefix = prefix || repo.toUpperCase().replace(/-CLI$/, '').replace(/-/g, '');
        if (repoPrefix.toUpperCase() === issuePrefix.toUpperCase()) {
          const possiblePaths = [
            join(homedir(), 'Projects', repo),
            join(homedir(), 'Projects', repo.replace(/-cli$/, '')),
            join(homedir(), 'Projects', owner, repo),
          ];
          for (const path of possiblePaths) {
            if (existsSync(path)) return path;
          }
        }
      }
    }
  }
  return join(homedir(), 'Projects');
}

async function getWorkspaceLocation(issueId: string): Promise<'local' | 'remote' | undefined> {
  try {
    const workspacesDir = join(homedir(), '.overdeck', 'workspaces');
    const variations = [issueId.toLowerCase(), issueId.toUpperCase(), issueId];
    for (const v of variations) {
      const yamlPath = join(workspacesDir, `${v}.yaml`);
      if (existsSync(yamlPath)) {
        const content = await readFile(yamlPath, 'utf-8');
        if (content.includes('location: remote')) return 'remote';
        return 'local';
      }
    }
  } catch {}
  return undefined;
}

async function getGitStatusAsync(workspacePath: string): Promise<{ branch: string; uncommittedFiles: number; latestCommit: string } | null> {
  try {
    if (!existsSync(workspacePath)) return null;
    const [branchResult, uncommittedResult, commitResult] = await Promise.all([
      execAsync('git rev-parse --abbrev-ref HEAD 2>/dev/null || echo ""', { cwd: workspacePath }),
      execAsync('git status --porcelain 2>/dev/null | wc -l', { cwd: workspacePath }),
      execAsync('git log -1 --pretty=format:"%s" 2>/dev/null || echo ""', { cwd: workspacePath }),
    ]);
    const branch = branchResult.stdout.trim();
    const uncommitted = uncommittedResult.stdout.trim();
    const latestCommit = commitResult.stdout.trim();
    if (!branch) return null;
    return {
      branch,
      uncommittedFiles: parseInt(uncommitted) || 0,
      latestCommit: latestCommit.slice(0, 60) + (latestCommit.length > 60 ? '...' : ''),
    };
  } catch {
    return null;
  }
}

interface SpawnGuardrailAdvisory {
  severity: 'warning' | 'critical';
  code: 'memory_pressure' | 'agent_capacity' | 'leaked_specialists';
  message: string;
}

export interface SpawnGuardrailDecision {
  blocked: boolean;
  requiresAcknowledgement: boolean;
  status: number;
  error?: string;
  hint?: string;
  warnings: SpawnGuardrailAdvisory[];
  health: Pick<SystemHealthSnapshot, 'severity' | 'summary' | 'reasons' | 'leakedSpecialists'>;
}

function formatLeakedSpecialistSummary(leaked: HealthLeakedSpecialist[]): string {
  return leaked
    .slice(0, 3)
    .map((item) => `${item.name} (${item.currentIssue})`)
    .join(', ');
}

function resolveAgentCountEnv(varName: string, fallback: number): number {
  const raw = process.env[varName];
  if (raw == null || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : fallback;
}

export interface AgentStartGateDecision {
  success: false;
  blocked: true;
  skipped: true;
  error: string;
  hint: string;
  agentId: string;
  paused: boolean;
  troubled: boolean;
}

export function evaluateAgentStartGate(
  agentId: string,
  state: Pick<AgentState, 'paused' | 'pausedReason' | 'troubled' | 'consecutiveFailures'> | null | undefined,
): AgentStartGateDecision | null {
  if (state?.paused === true) {
    const reason = state.pausedReason ? ` (${state.pausedReason})` : '';
    return {
      success: false,
      blocked: true,
      skipped: true,
      error: `Agent ${agentId} is paused${reason}.`,
      hint: `Run pan unpause ${agentId} before starting it from the dashboard.`,
      agentId,
      paused: true,
      troubled: state.troubled === true,
    };
  }

  if (state?.troubled === true) {
    const failures = state.consecutiveFailures ?? 0;
    return {
      success: false,
      blocked: true,
      skipped: true,
      error: `Agent ${agentId} is troubled (${failures} failure${failures === 1 ? '' : 's'}).`,
      hint: `Investigate the crash cause, then run pan untroubled ${agentId} before starting it from the dashboard.`,
      agentId,
      paused: false,
      troubled: true,
    };
  }

  return null;
}

export function hasActiveAgentGateOrRetry(
  state: Pick<AgentState, 'paused' | 'troubled' | 'lastFailureNextRetryAt'>,
  nowMs: number = Date.now(),
): boolean {
  if (state.paused === true || state.troubled === true) return true;
  if (!state.lastFailureNextRetryAt) return false;
  const retryAtMs = Date.parse(state.lastFailureNextRetryAt);
  return Number.isFinite(retryAtMs) && retryAtMs > nowMs;
}

export function evaluateSpawnGuardrails(health: SystemHealthSnapshot): SpawnGuardrailDecision {
  const warnings: SpawnGuardrailAdvisory[] = [];
  const availableGb = Math.round((health.summary.availableMemoryBytes / (1024 ** 3)) * 10) / 10;
  const workAgentCount = health.summary.workAgentCount;
  const leakedSpecialists = health.leakedSpecialists;
  const resourceConfig = getResourceConfig();
  const hardWorkAgentLimit = resolveAgentCountEnv('PAN_AGENT_BLOCK_COUNT', resourceConfig.agentBlockCount);
  const warnWorkAgentLimit = resolveAgentCountEnv('PAN_AGENT_WARN_COUNT', resourceConfig.agentWarnCount);

  const memoryBand = classifyMemoryPressure(health.summary.availableMemoryBytes, {
    warningBytes: health.thresholds.memoryAvailableWarningBytes,
    criticalBytes: health.thresholds.memoryAvailableCriticalBytes,
  });
  if (memoryBand === 'hard') {
    warnings.push({
      severity: 'critical',
      code: 'memory_pressure',
      message: `Available RAM is critically low (${availableGb} GB).`,
    });
  } else if (memoryBand === 'soft') {
    warnings.push({
      severity: 'warning',
      code: 'memory_pressure',
      message: `Available RAM is tight (${availableGb} GB).`,
    });
  }

  if (workAgentCount >= hardWorkAgentLimit) {
    warnings.push({
      severity: 'warning',
      code: 'agent_capacity',
      message: `Work agent count is at the configured ceiling (${workAgentCount}/${hardWorkAgentLimit}).`,
    });
  } else if (workAgentCount >= warnWorkAgentLimit) {
    warnings.push({
      severity: 'warning',
      code: 'agent_capacity',
      message: `Work agent count is high (${workAgentCount}/${hardWorkAgentLimit}).`,
    });
  }

  if (leakedSpecialists.length > 0) {
    warnings.push({
      severity: health.summary.availableMemoryBytes < health.thresholds.memoryAvailableCriticalBytes ? 'critical' : 'warning',
      code: 'leaked_specialists',
      message: `Leaked specialist sessions detected: ${formatLeakedSpecialistSummary(leakedSpecialists)}${leakedSpecialists.length > 3 ? `, +${leakedSpecialists.length - 3} more` : ''}.`,
    });
  }

  const blockingWarnings = warnings.filter((warning) => warning.severity === 'critical');
  if (blockingWarnings.length > 0) {
    const hasLeakedSpecialists = leakedSpecialists.length > 0;
    return {
      blocked: true,
      requiresAcknowledgement: false,
      status: 429,
      error: blockingWarnings[0]?.message ?? 'System health is blocking new agent spawns.',
      hint: hasLeakedSpecialists
        ? 'Clean up leaked specialist sessions first, then retry the spawn.'
        : 'Reduce memory pressure or active work-agent count before retrying.',
      warnings,
      health: {
        severity: health.severity,
        summary: health.summary,
        reasons: health.reasons,
        leakedSpecialists: health.leakedSpecialists,
      },
    };
  }

  return {
    blocked: false,
    requiresAcknowledgement: warnings.length > 0,
    status: warnings.length > 0 ? 409 : 200,
    hint: warnings.length > 0 ? 'Acknowledge the system health warnings before starting this agent.' : undefined,
    warnings,
    health: {
      severity: health.severity,
      summary: health.summary,
      reasons: health.reasons,
      leakedSpecialists: health.leakedSpecialists,
    },
  };
}

// Shared enrichment utilities (PAN-440) — aliases for readability
const getClaudeProjectDir = getClaudeProjectDirShared;
const getActiveSessionPath = getActiveSessionPathShared;
const getAgentWorkspace = getAgentWorkspaceShared;
const getAgentJsonlPath = getAgentJsonlPathShared;
const getPendingQuestions = getPendingQuestionsShared;
const getAgentPendingQuestions = getAgentPendingQuestionsShared;

function flyExecCmd(vmName: string, command: string): string {
  const appName = vmName.replace(/\/.*$/, ''); // simplified: use vmName as app name
  return `fly ssh console -a ${appName} -C ${JSON.stringify(command)}`;
}

export {
  execAsync,
  execFileAsync,
  constantTimeTokenEqual,
  emitStartAgentPhase,
  appendAgentLifecycleLog,
  updateRegistryForAgentStart,
  getIssueDataService,
  AGENTS_CACHE_TTL_MS,
  filterClosedIssueAgents,
  readJsonBody,
  toAgentStatusPayload,
  buildAgentControlEventPayload,
  buildAgentGateFailureSnapshot,
  buildStoppedAgentLifecycle,
  readRemoteAgentState,
  captureAgentOutputBeforeKill,
  buildHostOverrideConfirmation,
  getProjectPath,
  getWorkspaceLocation,
  getGitStatusAsync,
  resolveAgentCountEnv,
  formatLeakedSpecialistSummary,
  getClaudeProjectDir,
  getActiveSessionPath,
  getAgentWorkspace,
  getAgentJsonlPath,
  getPendingQuestions,
  getAgentPendingQuestions,
  flyExecCmd,
};

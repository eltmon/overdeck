import { jsonResponse } from "../http-helpers.js";
import { httpHandler } from "./http-handler.js";
import { getHeaderFromMap, validateOrigin } from './origin-validation.js';
import {
  buildPermissionActivityDetails,
  buildPermissionWaitingMessage,
  normalizePermissionRequestBody,
  parsePermissionResponseBehavior,
  permissionResolutionVerb,
  processPermissionResponse,
} from './agent-permissions.js';
import { encodeClaudeProjectDir, getOverdeckHome } from '../../../lib/paths.js';
import { buildChildEnvWithoutTmuxSync } from '../../../lib/child-env.js';
import { withBdMutex } from '../../../lib/bd-mutex.js';
/**
 * Agents route module — Effect HttpRouter.Layer (PAN-428 B7)
 *
 * Implements all /api/agents/* endpoints from the Express server:
 *   GET    /api/agents
 *   GET    /api/agents/:id/output
 *   POST   /api/agents/:id/message
 *   POST   /api/agents/:id/tell
 *   DELETE /api/agents/:id
 *   GET    /api/agents/:id/health-history
 *   POST   /api/agents/:id/poke
 *   GET    /api/agents/:id/pending-questions
 *   POST   /api/agents/:id/answer-question
 *   POST   /api/agents/:id/heartbeat
 *   GET    /api/agents/:id/activity
 *   GET    /api/agents/:id/files
 *   GET    /api/agents/:id/timeline
 *   POST   /api/agents/:id/suspend
 *   POST   /api/agents/:id/resume
 *   GET    /api/agents/:id/cloister-health
 *   GET    /api/agents/:id/handoff/suggestion
 *   POST   /api/agents/:id/handoff
 *   GET    /api/agents/:id/cost
 *   POST   /api/agents/:id/reset-session
 *   POST   /api/agents
 */

import { exec, execFile, spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, cp, mkdir, open, readdir, readFile, rename, rm, stat, symlink, lstat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { Effect, Layer, Option, Schema } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { DomainEvent } from '@overdeck/contracts';
import type { AgentStatus, Role } from '@overdeck/contracts';
import { bodyToEvent, decodeDomainEvent } from '../services/agent-event-utils.js';

import { getCloisterService } from '../../../lib/cloister/service.js';
import { loadCloisterConfigSync } from '../../../lib/cloister/config.js';
import { checkAllTriggers } from '../../../lib/cloister/triggers.js';
import { performHandoff } from '../../../lib/cloister/handoff.js';
import { getAgentHealth } from '../../../lib/cloister/health.js';
import { getRuntimeForAgent } from '../../../lib/runtimes/index.js';
import {
  getAgentState,
  getAgentStateSync,
  getAgentRuntimeStateSync,
  getAgentRuntimeState,
  deliverAgentPermissionDecision,
  saveAgentRuntimeState,
  saveAgentStateSync,
  saveAgentState,
  setAgentPaused,
  clearAgentPaused,
  clearAgentTroubled,
  markAgentStoppedState,
  type AgentRuntimeState,
  type AgentState,
  getActivity,
  saveSessionId,
  getSessionId,
  getLatestSessionId,
  recoverAgent,
  resumeAgent,
  restartAgent,
  messageAgent,
  deliverAgentMessage,
  stopAgentSync,
  stopAgent,
  listRunningAgentsSync,
  listRunningAgents,
  getAgentDir,
  determineModel,
  getProviderAuthMode,
  setAgentDeliveryMethod,
  normalizeAgentId,
  listAgentStates,
  wipeAgentStateDirs,
} from '../../../lib/agents.js';
import { stopWorkspaceDocker } from '../../../lib/workspace-manager.js';
import { checkCodexAuthStatus } from '../../../lib/codex-auth.js';
import { canUseHarnessSync } from '../../../lib/harness-policy.js';
import { getProviderForModelSync } from '../../../lib/providers.js';
import { validateProviderHealth, ProviderHealthError } from '../../../lib/provider-health.js';
import { getProjectSync, resolveProjectFromIssueSync } from '../../../lib/projects.js';
import { findPlan, readPlan } from '../../../lib/vbrief/io.js';
import { getWorkspaceStackHealth } from '../../../lib/workspace/stack-health.js';
import { normalizeModelOverrideSync, requireModelOverrideSync } from '../../../lib/model-validation.js';
import { writeAutoStartVBrief } from '../../../lib/vbrief/auto-synthesize.js';
import { transitionVBriefOnMain, updatePlanStatus } from '../../../lib/vbrief/lifecycle-io.js';
import { extractPrefixSync, parseIssueIdSync } from '../../../lib/issue-id.js';
import { PAN_CONTINUE_FILENAME, PAN_DIRNAME } from '../../../lib/pan-dir/types.js';
import { getGitHubConfig } from '../services/tracker-config.js';
import { loadWorkspaceMetadataSync as loadWorkspaceMetadataFn } from '../../../lib/remote/workspace-metadata.js';
import { getWorkAgentLifecycleState, type WorkAgentLifecycleState, type WorkAgentRecommendedAction } from '../../../lib/work-agent-lifecycle.js';
import { recordFeatureRegistryLifecycle } from '../../../lib/registry/feature-registry-population.js';
import { calculateCostSync, getPricingSync, type TokenUsage } from '../../../lib/cost.js';
import { normalizeModelName } from '../../../lib/cost-parsers/jsonl-parser.js';
import { getReviewStatusSync } from '../../../lib/review-status.js';
import { emitActivityEntrySync } from '../../../lib/activity-logger.js';
import { operatorInterventionEvent } from '../../../lib/operator-interventions.js';
import { IssueLifecycle } from '../services/issue-lifecycle.js';
import { getClosedIssueIdsForReadSource, ReadModelService } from '../read-model.js';
import { getSystemHealthSnapshot, getResourceConfig, type HealthLeakedSpecialist, type SystemHealthSnapshot } from '../services/system-health-service.js';
import { resolveAgentGitInfo } from '../services/git-info.js';
import {
  getClaudeProjectDir as getClaudeProjectDirShared,
  getActiveSessionPath as getActiveSessionPathShared,
  getAgentWorkspace as getAgentWorkspaceShared,
  getAgentJsonlPath as getAgentJsonlPathShared,
  getPendingQuestions as getPendingQuestionsShared,
  getAgentPendingQuestions as getAgentPendingQuestionsShared,
  computeAgentEnrichment,
  type PendingQuestion,
} from '../../../lib/agent-enrichment.js';
import { parseEntireConversation } from '../services/conversation-service.js';
import { parsePiConversationMessages } from '../services/pi-conversation-parser.js';
import { parseOhmypiConversationMessages } from '../services/ohmypi-conversation-parser.js';
import { parseCodexConversationMessages } from '../services/codex-conversation-parser.js';
import { readLauncherPinnedSessionId, resolvePiSessionPath, resolveCodexRolloutPath, resolveAgentHarness } from './jsonl-resolver.js';
import type { ConversationResponse } from '@overdeck/contracts';
import type { RuntimeName } from '../../../lib/runtimes/types.js';
import { EventStoreService } from '../services/domain-services.js';
import { saveAgentStateAndEmitEventProgram } from '../services/agent-projection.js';
import { normalizeAwaitingInputPrompt } from '../../../lib/agent-input-detection.js';
import { buildTmuxCommandString, capturePane, killSession, listSessions, sessionExists } from '../../../lib/tmux.js';

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
  const child = spawn('pan', args, {
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

function getIssueDataService(): import('../services/issue-data-service.js').IssueDataService {
  const { getSharedIssueService } = require('../services/issue-service-singleton.js');
  return getSharedIssueService();
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const AGENTS_CACHE_TTL_MS = 5000;
let agentsCache: { data: unknown[] | null; timestamp: number } = { data: null, timestamp: 0 };

/** Invalidate the agents cache so the next request re-reads all agent state. */
export function invalidateAgentsCache(): void {
  agentsCache = { data: null, timestamp: 0 };
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
  const hasSavedSession = !!runtimeData.claudeSessionId;
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

  if (health.summary.availableMemoryBytes < health.thresholds.memoryAvailableCriticalBytes) {
    warnings.push({
      severity: 'critical',
      code: 'memory_pressure',
      message: `Available RAM is critically low (${availableGb} GB).`,
    });
  } else if (health.summary.availableMemoryBytes < health.thresholds.memoryAvailableWarningBytes) {
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

// ─── Route: GET /api/agents ───────────────────────────────────────────────────

const getAgentsRoute = HttpRouter.add(
  'GET',
  '/api/agents',
  httpHandler(Effect.gen(function* () {
        const now = Date.now();

        if (agentsCache.data && (now - agentsCache.timestamp) < AGENTS_CACHE_TTL_MS) {
          return jsonResponse(agentsCache.data);
        }

        const sessions = yield* listSessions();
        const sessionByName = new Map(sessions.map((session) => [session.name, session]));
        const registeredStates = listAgentStates()
          .filter((state) => state.id.startsWith('agent-') || state.id.startsWith('planning-') || state.id.startsWith('strike-'));

        const allAgents = (yield* Effect.promise(() => Promise.all(
          registeredStates.map(async (state) => {
            const name = state.id;
            const isPlanning = name.startsWith('planning-');
            const isStrike = name.startsWith('strike-');
            const issueId = state.issueId?.toUpperCase() ||
              (isPlanning ? name.replace('planning-', '') : isStrike ? name.replace('strike-', '') : name.replace('agent-', '')).toUpperCase();
            const session = sessionByName.get(name);
            const remoteState = await readRemoteAgentState(name);
            const isRemote = remoteState.location === 'remote';
            const runtimeData = await Effect.runPromise(getAgentRuntimeState(name));
            const startedAt = state.startedAt || (session ? new Date(session.created).toISOString() : new Date().toISOString());
            const healthFile = join(homedir(), '.overdeck', 'agents', name, 'health.json');
            let health: any = { killCount: 0 };
            if (existsSync(healthFile)) {
              try { health = { ...health, ...JSON.parse(await readFile(healthFile, 'utf-8')) }; } catch {}
            }

            if (state.status === 'stopped') {
              const stoppedTimestamp = state.stoppedAt || runtimeData?.lastActivity || state.lastActivity;
              const stoppedAt = stoppedTimestamp ? new Date(stoppedTimestamp) : null;
              const reviewStatus = getReviewStatusSync(issueId);
              const keepStoppedAgentVisible =
                hasActiveAgentGateOrRetry(state, now) ||
                (
                  !!reviewStatus &&
                  reviewStatus.mergeStatus !== 'merged' &&
                  (
                    !!reviewStatus.prUrl ||
                    reviewStatus.readyForMerge === true ||
                    reviewStatus.reviewStatus !== 'pending' ||
                    reviewStatus.testStatus !== 'pending' ||
                    reviewStatus.mergeStatus === 'failed'
                  )
                );
              if (stoppedAt && (now - stoppedAt.getTime()) > 60 * 60 * 1000 && !keepStoppedAgentVisible) return null;
              const lifecycle = buildStoppedAgentLifecycle(name, state, runtimeData ?? {});
              const needsInput = runtimeData?.resolution === 'needs_input';
              const pendingQuestionPrompt = needsInput
                ? normalizeAwaitingInputPrompt(
                    runtimeData?.waitingNotification ||
                      'Agent stopped because it needs human input or hit a blocker',
                  )
                : undefined;
              const pendingQuestionReason = needsInput
                ? runtimeData?.waitingReason || 'other'
                : undefined;
              return {
                id: name,
                issueId,
                runtime: state.harness ?? 'claude-code',
                model: state.model || (isPlanning ? 'opus' : 'sonnet'),
                status: 'stopped' as const,
                startedAt,
                ...buildAgentGateFailureSnapshot(state),
                killCount: health.killCount || 0,
                workspace: state.workspace || null,
                workspaceLocation: isRemote ? 'remote' : 'local',
                git: null,
                type: 'agent',
                role: state.role ?? (isStrike ? 'strike' : isPlanning ? 'plan' : 'work'),
                hasPendingQuestion: needsInput,
                pendingQuestionCount: 0,
                pendingQuestionPrompt,
                pendingQuestionReason,
                resolution: runtimeData?.resolution || 'working',
                resolutionCount: runtimeData?.resolutionCount || 0,
                hasSession: lifecycle.canResumeSession,
                lifecycle,
                ...(isRemote ? { remote: true, vmName: remoteState.vmName } : {}),
              };
            }

            if (state.status === 'starting') {
              return {
                id: name,
                issueId,
                runtime: state.harness ?? 'claude-code',
                model: state.model || (isPlanning ? 'opus' : 'sonnet'),
                status: 'starting' as const,
                startedAt,
                ...buildAgentGateFailureSnapshot(state),
                killCount: health.killCount || 0,
                workspace: state.workspace || null,
                workspaceLocation: isRemote ? 'remote' : 'local',
                git: null,
                type: 'agent',
                role: state.role ?? (isStrike ? 'strike' : isPlanning ? 'plan' : 'work'),
                hasPendingQuestion: false,
                pendingQuestionCount: 0,
                message: (state as { message?: string }).message || 'Starting...',
                ...(isRemote ? { remote: true, vmName: remoteState.vmName } : {}),
              };
            }

            if (state.status === 'error') {
              return {
                id: name,
                issueId,
                runtime: state.harness ?? 'claude-code',
                model: state.model || (isPlanning ? 'opus' : 'sonnet'),
                status: 'error' as const,
                startedAt,
                ...buildAgentGateFailureSnapshot(state),
                killCount: health.killCount || 0,
                workspace: state.workspace || null,
                workspaceLocation: isRemote ? 'remote' : 'local',
                git: null,
                type: 'agent',
                role: state.role ?? (isStrike ? 'strike' : isPlanning ? 'plan' : 'work'),
                hasPendingQuestion: false,
                pendingQuestionCount: 0,
                error: state.lastFailureReason || 'Unknown error',
                ...(isRemote ? { remote: true, vmName: remoteState.vmName } : {}),
              };
            }

            const issueReviewStatus = getReviewStatusSync(issueId);
            const hasActiveSpecialist = issueReviewStatus?.reviewStatus === 'reviewing'
              || issueReviewStatus?.testStatus === 'testing'
              || issueReviewStatus?.mergeStatus === 'merging';
            const enrichment = await Effect.runPromise(computeAgentEnrichment(name, startedAt, hasActiveSpecialist));
            const workspaceLocation = isRemote ? 'remote' : await getWorkspaceLocation(issueId);
            const workspace = isRemote && remoteState.vmName
              ? `/workspace (${String(remoteState.vmName)})`
              : state.workspace || null;
            const gitStatus = workspace && !isRemote ? await getGitStatusAsync(workspace) : null;

            let contextPercent: number | null = null;
            let initialContextPercent: number | null = null;
            const agentCtxDir = join(homedir(), '.overdeck', 'agents', name);
            try {
              const ctxFile = join(agentCtxDir, 'context-pct');
              contextPercent = parseInt((await readFile(ctxFile, 'utf-8').catch(() => '')).trim(), 10) || null;
              const initCtxFile = join(agentCtxDir, 'initial-context-pct');
              initialContextPercent = parseInt((await readFile(initCtxFile, 'utf-8').catch(() => '')).trim(), 10) || null;
            } catch {}

            return {
              id: name,
              issueId,
              runtime: state.harness ?? 'claude-code',
              model: state.model || (isPlanning ? 'opus' : 'sonnet'),
              status: 'healthy' as const,
              startedAt,
              ...buildAgentGateFailureSnapshot(state),
              killCount: health.killCount || 0,
              workspace,
              workspaceLocation,
              git: gitStatus,
              type: 'agent',
              role: state.role ?? (isStrike ? 'strike' : isPlanning ? 'plan' : 'work'),
              hasPendingQuestion: enrichment.hasPendingQuestion,
              pendingQuestionCount: enrichment.pendingQuestionCount,
              pendingQuestionPrompt: enrichment.pendingQuestionPrompt,
              pendingQuestionReason: enrichment.pendingQuestionReason,
              pendingInputCount: enrichment.pendingInputCount,
              pendingInputKinds: enrichment.pendingInputKinds,
              pendingAskUserQuestion: enrichment.pendingAskUserQuestion,
              resolution: runtimeData?.resolution || enrichment.resolution || 'working',
              resolutionCount: runtimeData?.resolutionCount || enrichment.resolutionCount || 0,
              contextPercent,
              initialContextPercent,
              ...(isRemote ? { remote: true, vmName: remoteState.vmName } : {}),
            };
          }),
        ))).filter(Boolean);
        const visibleAgents = filterClosedIssueAgents(allAgents, getIssueDataService().getIssues());
        agentsCache = { data: visibleAgents, timestamp: now };
        return jsonResponse(visibleAgents);
  })),
);

// ─── Route: GET /api/agents/:id/output ───────────────────────────────────────

const getAgentOutputRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/output',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const request = yield* HttpServerRequest.HttpServerRequest;
    const urlOpt = HttpServerRequest.toURL(request);
    const lines = Option.isSome(urlOpt) ? (urlOpt.value.searchParams.get('lines') ?? '100') : '100';

    return yield* Effect.promise(async () => {
        try {
          const agentStateDir = join(homedir(), '.overdeck', 'agents', id);
          const remoteStateFile = join(agentStateDir, 'remote-state.json');
          let isRemote = false;
          let vmName = '';

          if (existsSync(remoteStateFile)) {
            try {
              const state = JSON.parse(await readFile(remoteStateFile, 'utf-8'));
              if (state.location === 'remote' && state.vmName) {
                isRemote = true;
                vmName = state.vmName;
              }
            } catch {}
          }

          let stdout: string;
          if (isRemote && vmName) {
            const { getRemoteAgentOutput } = await import('../../../lib/remote/remote-agents.js');
            stdout = await getRemoteAgentOutput(id, vmName, parseInt(String(lines), 10) || 100);
          } else {
            stdout = await Effect.runPromise(capturePane(id, parseInt(String(lines), 10) || 100));
          }

          if (!stdout || stdout.trim() === '' || stdout.trim() === 'Session not found') {
            const savedLog = join(agentStateDir, 'output.log');
            const logContent = await readFile(savedLog, 'utf-8').catch(() => null);
            if (logContent) {
              const logLines = logContent.split('\n');
              const numLines = parseInt(String(lines), 10) || 100;
              stdout = logLines.slice(-numLines).join('\n');
            }
          }

          if (stdout?.trim() === 'Session not found') {
            stdout = '';
          }

          return jsonResponse({ output: stdout });
        } catch (error: unknown) {
          // Try saved log on error
          try {
            const agentStateDir = join(homedir(), '.overdeck', 'agents', id);
            const savedLog = join(agentStateDir, 'output.log');
            const logContent = await readFile(savedLog, 'utf-8').catch(() => null);
            if (logContent) return jsonResponse({ output: logContent });
          } catch {}
          return jsonResponse({ output: '' });
        }
      })
  })),
);

// ─── Route: GET /api/agents/:id/conversation ─────────────────────────────────

const EMPTY_CONVERSATION: ConversationResponse = { messages: [], workLog: [], streaming: false, totalCost: 0, byteOffset: 0 };

/**
 * Resolve and parse an agent's conversation JSONL file.
 * Exported for unit testing — the Effect route layer is not directly unit-testable.
 *
 * Dispatches on harness so Pi and Codex agents get their native parsers (PAN-2012).
 * For claude-code agents, tries the launcher-pinned --session-id first (the exact
 * session the Terminal tab attaches to) before falling back to mtime-based pick
 * (PAN-2011). This makes the Conversation tab match the Terminal tab by construction.
 */
export async function buildConversationResponse(id: string): Promise<ConversationResponse> {
  try {
    const harness = await resolveAgentHarness(id);

    if (harness === 'ohmypi') {
      const sessionFile = await resolvePiSessionPath(id);
      if (!sessionFile || !existsSync(sessionFile)) return EMPTY_CONVERSATION;
      const result = await parseOhmypiConversationMessages(sessionFile);
      return { ...result, streaming: false };
    }

    if (harness === 'pi') {
      const sessionFile = await resolvePiSessionPath(id);
      if (!sessionFile || !existsSync(sessionFile)) return EMPTY_CONVERSATION;
      const result = await parsePiConversationMessages(sessionFile);
      return { ...result, streaming: false };
    }

    if (harness === 'codex') {
      const sessionFile = await resolveCodexRolloutPath(id);
      if (!sessionFile || !existsSync(sessionFile)) return EMPTY_CONVERSATION;
      const result = await parseCodexConversationMessages(sessionFile);
      return { ...result, streaming: false };
    }

    // claude-code (default): try launcher-pinned session ID first (ground truth),
    // then fall back to mtime-based pick.
    let jsonlPath: string | null = null;
    const pinnedSessionId = await readLauncherPinnedSessionId(id);
    if (pinnedSessionId) {
      const workspace = await Effect.runPromise(getAgentWorkspaceShared(id));
      if (workspace) {
        const candidate = join(
          homedir(), '.claude', 'projects',
          encodeClaudeProjectDir(workspace),
          `${pinnedSessionId}.jsonl`,
        );
        if (existsSync(candidate)) jsonlPath = candidate;
      }
    }
    if (!jsonlPath) {
      jsonlPath = await Effect.runPromise(getAgentJsonlPathShared(id));
    }

    if (!jsonlPath || !existsSync(jsonlPath)) return EMPTY_CONVERSATION;
    // parseEntireConversation, not parseConversationMessages: a single parse caps
    // at MAX_READ_BYTES (10 MB) and would drop the most recent turns of a larger
    // transcript (PAN-1989). This one-shot endpoint must return the whole file.
    const result = await parseEntireConversation(jsonlPath);
    // Force streaming: false — tmux session is dead, any "streaming" state is stale
    return { ...result, streaming: false };
  } catch (err) {
    console.error('[conversation] failed for', id, err);
    return EMPTY_CONVERSATION;
  }
}

const getAgentConversationRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/conversation',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    return yield* Effect.promise(async () => jsonResponse(await buildConversationResponse(id)));
  })),
);

async function sendAgentMessage(id: string, message: string) {
  const agentStateDir = join(homedir(), '.overdeck', 'agents', id);
  const remoteStateFile = join(agentStateDir, 'remote-state.json');
  let isRemote = false;

  if (existsSync(remoteStateFile)) {
    try {
      const state = JSON.parse(await readFile(remoteStateFile, 'utf-8'));
      isRemote = state.location === 'remote' && Boolean(state.vmName);
    } catch {}
  }

  await messageAgent(id, message, 'dashboard:user-message');
  return isRemote ? { success: true, remote: true } : { success: true };
}

export function validateAgentMessageOrigin(request: HttpServerRequest.HttpServerRequest) {
  const originCheck = validateOrigin(request);
  if (!originCheck.ok) {
    return {
      ok: false as const,
      response: jsonResponse({ ok: false, error: originCheck.error }, { status: 403 }),
    };
  }
  return { ok: true as const };
}

function postAgentMessageLikeRoute(path: `/${string}`) {
  return HttpRouter.add(
    'POST',
    path,
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const originCheck = validateAgentMessageOrigin(request);
      if (!originCheck.ok) return originCheck.response;

      const params = yield* HttpRouter.params;
      const id = params['id'] ?? '';
      const body = yield* readJsonBody;

      const { message } = body as any;
      if (!message) {
        return jsonResponse({ error: 'Message required' }, { status: 400 });
      }

      return yield* Effect.promise(() => sendAgentMessage(id, message)).pipe(
        Effect.map((result) => jsonResponse(result)),
      );
    })),
  );
}

// ─── Route: POST /api/agents/:id/message ─────────────────────────────────────

const postAgentMessageRoute = postAgentMessageLikeRoute('/api/agents/:id/message');

// ─── Route: POST /api/agents/:id/tell ────────────────────────────────────────

const postAgentTellRoute = postAgentMessageLikeRoute('/api/agents/:id/tell');

export function createAgentStopHandler(
  lifecycleEvent: 'agent.delete_requested' | 'agent.stop_requested',
) {
  return httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ ok: false, error: originCheck.error }, { status: 403 });
    }

    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const eventStore = yield* EventStoreService;

    const stateBeforeStop = yield* getAgentState(id);
    yield* Effect.promise(() => appendAgentLifecycleLog(id, lifecycleEvent));
    yield* stopAgent(id);

    // PAN-1316/PAN-1326: tear down the workspace Docker stack on user-initiated stop.
    // Without this, dev-server containers (Vite/Webpack) outlive their owning
    // agent and can degrade the host via inotify-fallback polling storms.
    // Internal stops (restart) take a different path and don't reach here.
    //
    // Resolve the workspace from the issue (not from the agent's own state) so
    // killing a specialist (review/test/ship) — whose state.workspace may not
    // point at the work agent's workspace — still tears down the right stack.
    // Mirrors the postMergeLifecycle pattern in merge-agent.ts.
    if (stateBeforeStop?.issueId) {
      yield* Effect.promise(async () => {
        try {
          const { resolveProjectFromIssueSync } = await import('../../../lib/projects.js');
          const { findWorkspacePath } = await import('../../../lib/lifecycle/archive-planning.js');
          const issueLower = stateBeforeStop.issueId!.toLowerCase();
          const project = resolveProjectFromIssueSync(stateBeforeStop.issueId!);
          const projectPath = project?.projectPath ?? process.cwd();
          const workspacePath = findWorkspacePath(projectPath, issueLower);
          if (workspacePath) {
            const dockerResult = await Effect.runPromise(stopWorkspaceDocker(workspacePath, issueLower));
            if (dockerResult.containersFound) {
              console.log(`[agents] ✓ Stopped Docker stack for ${id}: ${dockerResult.steps.join('; ')}`);
            }
          }
        } catch (err) {
          console.warn(`[agents] Docker teardown failed for ${id} (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
        }
      });
    }

    // PAN-1048 review feedback 004 (C1): AgentStoppedEvent requires both
    // agentId AND issueId on the payload (packages/contracts/src/events.ts:36);
    // ws-rpc drops events that fail Schema validation, so emits without issueId
    // never reach subscribers and the dashboard misses the stop transition.
    //
    // PAN-1908: write-through projection — re-upsert the stopped row and append
    // the lifecycle event in one SQLite transaction. stopAgent already saved
    // state, but repeating the upsert here makes the event append atomic.
    const stateAfterStop = yield* getAgentState(id);
    if (stateAfterStop) {
      yield* saveAgentStateAndEmitEventProgram(stateAfterStop, {
        type: 'agent.stopped',
        timestamp: new Date().toISOString(),
        payload: { agentId: id, issueId: stateAfterStop.issueId || stateBeforeStop?.issueId || '' },
      });
    }
    const issueId = stateBeforeStop?.issueId;
    // PAN-1048: derive label from role; legacy state.phase no longer exists.
    const phaseLabel = stateBeforeStop?.role === 'plan' ? 'planning' : 'work';
    emitActivityEntrySync({
      source: 'dashboard',
      level: 'info',
      message: issueId
        ? `User stopped ${issueId} ${phaseLabel} agent`
        : `User stopped agent ${id}`,
      issueId,
    });
    invalidateAgentsCache();
    return jsonResponse({ success: true });
  }));
}

function agentStopRoute(
  method: 'DELETE' | 'POST',
  path: `/${string}`,
  lifecycleEvent: 'agent.delete_requested' | 'agent.stop_requested',
) {
  return HttpRouter.add(method, path, createAgentStopHandler(lifecycleEvent));
}

// ─── Route: DELETE /api/agents/:id ───────────────────────────────────────────

const deleteAgentRoute = agentStopRoute('DELETE', '/api/agents/:id', 'agent.delete_requested');

// ─── Route: POST /api/agents/:id/stop ────────────────────────────────────────

const postAgentStopRoute = agentStopRoute('POST', '/api/agents/:id/stop', 'agent.stop_requested');

// ─── Route: GET /api/agents/:id/health-history ───────────────────────────────

const getAgentHealthHistoryRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/health-history',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const request = yield* HttpServerRequest.HttpServerRequest;
    const urlOpt = HttpServerRequest.toURL(request);
    const hours = Option.isSome(urlOpt) ? (urlOpt.value.searchParams.get('hours') ?? '24') : '24';

    const { getHealthHistory } = yield* Effect.promise(() => import('../../../lib/overdeck/health-events.js'));
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - parseInt(hours) * 60 * 60 * 1000);
    const events = getHealthHistory(id, startTime.toISOString(), endTime.toISOString());
    return jsonResponse({
      agentId: id,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      events,
    });
  })),
);

// ─── Route: POST /api/agents/:id/poke ────────────────────────────────────────

const postAgentPokeRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/poke',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;

    const { message } = body as any;
    const defaultPokeMessage =
      "You seem to have been inactive for a while. If you're stuck:\n" +
      '1. Check your current task in continue.vbrief.json\n' +
      '2. Try an alternative approach if blocked\n' +
      '3. Ask for help if needed\n\n' +
      "What's your current status?";
    const pokeMsg = message || defaultPokeMessage;
    yield* Effect.promise(() => messageAgent(id, pokeMsg));
    return jsonResponse({ success: true, message: 'Agent poked successfully' });
  })),
);

// ─── Route: GET /api/agents/:id/pending-questions ────────────────────────────

const getAgentPendingQuestionsRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/pending-questions',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';

    const questions = yield* getAgentPendingQuestions(id);
    return jsonResponse({ pending: questions.length > 0, questions });
  })),
);

// ─── Route: POST /api/agents/:id/answer-question (PAN-1520) ──────────────────
//
// Operator answer for an AskUserQuestion the agent is blocked on. The Phase 1
// hook (sync-sources/hooks/ask-user-question-hook) denies the upstream tool
// call to prevent silent corruption (upstream returns option #1 under
// --dangerously-skip-permissions), so by the time this endpoint is hit the
// agent has restated the question as plain text and is waiting on a normal
// user message. We compose that user message from the chosen option labels
// and deliver it through the standard message pipeline.
//
// Body: { answers: string[] }  — one chosen-option label per question.

const postAgentAnswerQuestionRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/answer-question',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!id.trim()) {
      return jsonResponse({ error: 'missing agent id' }, { status: 400 });
    }
    const body = (yield* readJsonBody) as Record<string, unknown>;

    const answers = body['answers'];
    if (!Array.isArray(answers) || answers.length === 0) {
      return jsonResponse({ error: 'answers array required' }, { status: 400 });
    }
    if (!answers.every((a): a is string => typeof a === 'string' && a.length > 0)) {
      return jsonResponse({ error: 'every answer must be a non-empty string' }, { status: 400 });
    }

    const pendingQuestions = yield* getAgentPendingQuestions(id);
    if (pendingQuestions.length === 0) {
      return jsonResponse({ error: 'No pending questions found for this agent' }, { status: 404 });
    }

    const questionSet = pendingQuestions[0];
    const questions = questionSet.questions;
    const lines: string[] = [];
    for (let i = 0; i < answers.length && i < questions.length; i++) {
      const q = questions[i].question ?? `Question ${i + 1}`;
      lines.push(`Q: ${q}\nA: ${answers[i]}`);
    }
    const message = `Operator answered the pending question${answers.length > 1 ? 's' : ''}:\n\n${lines.join('\n\n')}`;

    yield* Effect.promise(() => deliverAgentMessage(id, message, 'ask-user-question-answer'));
    return jsonResponse({ success: true, agentId: id, delivered: answers.length });
  })),
);

// ─── Route: POST /api/agents/:id/heartbeat (PAN-800 ingestion) ──────────────
//
// Typed event ingestion for agent runtime state. Hooks POST a Schema-validated
// body describing a single runtime transition; the handler translates to an
// agent.* DomainEvent and hands it to AgentStateService.emit (which durably
// appendAsyncs via EventStore).
//
// Body shape (discriminated by `kind`):
//   {kind: "activity",          activity, tool?}
//   {kind: "thinking_start",    lastToolAt}
//   {kind: "thinking_stop",     resolvedBy}
//   {kind: "waiting_start",     reason, message?}
//   {kind: "waiting_clear",     clearedBy}
//   {kind: "message_received",  direction, source}
//   {kind: "model_set",         model, claudeSessionId?}
//   {kind: "resolution_set",    resolution, resolutionCount}
//   {kind: "current_issue_set", currentIssue?}
//   {kind: "context_saturation_changed", contextSaturatedAt?}

function emitAgentRuntimeEvent(id: string, body: Record<string, unknown>, timestamp: string) {
  return Effect.gen(function* () {
    let raw: Record<string, unknown> | null;
    try {
      raw = bodyToEvent(id, body, timestamp);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'invalid heartbeat payload';
      return { ok: false as const, response: jsonResponse({ success: false, error: message }, { status: 400 }) };
    }
    if (!raw) {
      return { ok: true as const, emitted: false };
    }

    const candidate = { ...raw, sequence: 0 };
    const decoded = decodeDomainEvent(candidate);
    if (decoded._tag === 'Failure') {
      return {
        ok: false as const,
        response: jsonResponse(
          { success: false, error: 'invalid event', detail: String(decoded.failure) },
          { status: 400 },
        ),
      };
    }

    const { AgentStateService } = yield* Effect.promise(
      () => import('../services/agent-state-service.js'),
    );
    const agentState = yield* AgentStateService;
    yield* agentState.emit(decoded.success as never);
    return { ok: true as const, emitted: true };
  });
}

const postAgentHeartbeatRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/heartbeat',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const auth = yield* Effect.promise(() => validateAgentRuntimeEventAuth(request));
    if (!auth.ok) return auth.response;

    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!id.trim()) {
      return jsonResponse({ success: false, error: 'missing agent id' }, { status: 400 });
    }
    const body = (yield* readJsonBody) as Record<string, unknown>;
    const timestamp = (body['timestamp'] as string) ?? new Date().toISOString();
    const result = yield* emitAgentRuntimeEvent(id, body, timestamp);
    if (!result.ok) return result.response;
    return jsonResponse({ success: true, emitted: result.emitted });
  })),
);

const postAgentWorkCompleteRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/work-complete',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const auth = yield* Effect.promise(() => validateAgentRuntimeEventAuth(request));
    if (!auth.ok) return auth.response;

    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!id.trim()) return jsonResponse({ success: false, error: 'missing agent id' }, { status: 400 });
    const result = yield* emitAgentRuntimeEvent(id, { kind: 'resolution_set', resolution: 'done', resolutionCount: 1 }, new Date().toISOString());
    if (!result.ok) return result.response;
    return jsonResponse({ success: true, emitted: result.emitted });
  })),
);

const postAgentStuckRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/stuck',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const auth = yield* Effect.promise(() => validateAgentRuntimeEventAuth(request));
    if (!auth.ok) return auth.response;

    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!id.trim()) return jsonResponse({ success: false, error: 'missing agent id' }, { status: 400 });
    const result = yield* emitAgentRuntimeEvent(id, { kind: 'resolution_set', resolution: 'stuck', resolutionCount: 1 }, new Date().toISOString());
    if (!result.ok) return result.response;
    return jsonResponse({ success: true, emitted: result.emitted });
  })),
);

function hasNegatedCompletionOutput(output: string): boolean {
  return /\b(not|never|no|cannot|can't|blocked|waiting|needs input|not yet|isn't|aren't)\b.{0,48}\b(implementation complete|all beads closed|ready for review|work complete)\b/i.test(output);
}

const postAgentClassifyCompletionRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/classify-completion',
  httpHandler(Effect.gen(function* () {
    const body = (yield* readJsonBody) as Record<string, unknown>;
    const output = typeof body['output'] === 'string' ? body['output'] : '';
    const verdict = /blocked|needs input|waiting for|not ready for review/i.test(output) || hasNegatedCompletionOutput(output)
      ? 'STOPPED_FOR_INPUT'
      : /Implementation complete|all beads closed|ready for review|work complete/i.test(output)
        ? 'FORGOT_COMPLETION'
        : 'UNCLEAR';
    return jsonResponse({ success: true, verdict });
  })),
);

const postInternalAgentPermissionRequestRoute = HttpRouter.add(
  'POST',
  '/api/internal/agents/:id/permissions/request',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!id.trim()) {
      return jsonResponse({ ok: false, error: 'missing agent id' }, { status: 400 });
    }

    const request = yield* HttpServerRequest.HttpServerRequest;
    const { INTERNAL_TOKEN_HEADER, getInternalTokenSync } = yield* Effect.promise(() =>
      import('../../../lib/internal-token.js'),
    );
    const expected = getInternalTokenSync();
    if (!expected) {
      return jsonResponse({ ok: false, error: 'internal token not configured' }, { status: 503 });
    }
    const headers = request.headers as Record<string, string | string[] | undefined>;
    const rawHeader = headers[INTERNAL_TOKEN_HEADER];
    const provided = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (!constantTimeTokenEqual(provided, expected)) {
      return jsonResponse({ ok: false, error: 'forbidden' }, { status: 403 });
    }

    const body = (yield* readJsonBody) as Record<string, unknown>;
    const normalized = normalizePermissionRequestBody(body);
    if (!normalized.ok) {
      return jsonResponse({ ok: false, error: normalized.error }, { status: 400 });
    }
    const { requestId, toolName, description, inputPreview } = normalized.value;

    const readModel = yield* ReadModelService;
    const existing = yield* readModel.getChannelPermissionRequest(requestId);
    if (existing) {
      if (existing.agentId !== id) {
        return jsonResponse({ ok: false, error: `request ${requestId} already belongs to ${existing.agentId}` }, { status: 409 });
      }
      return jsonResponse({ ok: true, duplicate: true });
    }

    const agentState = yield* getAgentState(id);
    if (!agentState) {
      return jsonResponse({ ok: false, error: `agent ${id} not found` }, { status: 404 });
    }
    const runtimeState = yield* getAgentRuntimeState(id);
    const issueId = runtimeState?.currentIssue ?? agentState.issueId;

    const eventStore = yield* EventStoreService;
    const timestamp = new Date().toISOString();
    yield* eventStore.append({
      type: 'agent.permission_requested',
      timestamp,
      payload: {
        requestId,
        agentId: id,
        issueId,
        toolName,
        description,
        inputPreview,
        createdAt: timestamp,
      },
    } as never);
    yield* eventStore.append({
      type: 'agent.waiting_started',
      timestamp,
      payload: {
        agentId: id,
        reason: 'tool_permission',
        message: buildPermissionWaitingMessage(toolName, description),
      },
    } as never);

    emitActivityEntrySync({
      source: 'dashboard',
      level: 'warn',
      message: `Permission requested for ${toolName}`,
      details: buildPermissionActivityDetails(description, inputPreview),
      issueId,
    });

    return jsonResponse({ ok: true });
  })),
);

const postAgentPermissionResponseRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/permissions/:requestId/respond',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const requestId = params['requestId'] ?? '';
    if (!id.trim() || !requestId.trim()) {
      return jsonResponse({ ok: false, error: 'missing agent id or request id' }, { status: 400 });
    }

    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ ok: false, error: originCheck.error }, { status: 403 });
    }

    const body = (yield* readJsonBody) as Record<string, unknown>;
    const behaviorResult = parsePermissionResponseBehavior(body);
    if (!behaviorResult.ok) {
      return jsonResponse({ ok: false, error: behaviorResult.error }, { status: 400 });
    }
    const behavior = behaviorResult.value;

    const readModel = yield* ReadModelService;
    const eventStore = yield* EventStoreService;
    const result = yield* Effect.promise(() => processPermissionResponse(
      {
        getPendingRequest: (permissionRequestId) =>
          Effect.runPromise(readModel.getChannelPermissionRequest(permissionRequestId)),
        getResolvedDecision: (permissionRequestId) =>
          Effect.runPromise(readModel.getResolvedChannelPermissionDecision(permissionRequestId)),
        appendResolutionEvents: async (pendingRequest, decisionBehavior) => {
          const timestamp = new Date().toISOString();
          await Effect.runPromise(eventStore.append({
            type: 'agent.permission_resolved',
            timestamp,
            payload: {
              requestId: pendingRequest.requestId,
              agentId: pendingRequest.agentId,
              issueId: pendingRequest.issueId,
              behavior: decisionBehavior,
            },
          } as never));
          await Effect.runPromise(eventStore.append({
            type: 'agent.waiting_cleared',
            timestamp,
            payload: {
              agentId: pendingRequest.agentId,
              clearedBy: 'tool_resumed',
            },
          } as never));
        },
        deliverDecision: (agentId, permissionRequestId, decisionBehavior) =>
          deliverAgentPermissionDecision(agentId, permissionRequestId, decisionBehavior),
        emitResolvedActivity: (pendingRequest, decisionBehavior) => {
          emitActivityEntrySync({
            source: 'dashboard',
            level: decisionBehavior === 'allow' ? 'success' : 'warn',
            message: `Permission ${permissionResolutionVerb(decisionBehavior)} for ${pendingRequest.toolName}`,
            details: buildPermissionActivityDetails(
              pendingRequest.description,
              pendingRequest.inputPreview,
            ),
            issueId: pendingRequest.issueId,
          });
        },
      },
      {
        agentId: id,
        requestId,
        behavior,
      },
    ));

    return jsonResponse(result.body, { status: result.status });
  })),
);

// ─── Route: GET /api/agents/:id/runtime (PAN-800) ────────────────────────────
// Exposes AgentRuntimeSnapshot to out-of-process readers (CLI, tests).

const getAgentRuntimeRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/runtime',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!id.trim()) {
      return jsonResponse({ success: false, error: 'missing agent id' }, { status: 400 });
    }
    const { AgentStateService } = yield* Effect.promise(
      () => import('../services/agent-state-service.js'),
    );
    const agentState = yield* AgentStateService;
    const snapshot = yield* agentState.get(id);
    if (!snapshot) {
      return jsonResponse({ success: false, error: 'not found' }, { status: 404 });
    }
    return jsonResponse({ success: true, snapshot });
  })),
);

// ─── Route: GET /api/agents/:id/git-info ─────────────────────────────────────
//
// Branch + worktree status for the agent's workspace (PAN-1523). Used by
// AgentOutputPanel to render the Local/Worktree/Drifted chip in the panel
// header. Work agents don't have a conversation row to enrich, so the panel
// queries this dedicated endpoint instead.

/**
 * True when the agent has a concrete workspace + issue we can evaluate git
 * state for. When false, the git-info route must NOT claim the worktree is
 * missing — an unresolvable session id (e.g. a legacy / JSONL-only "Planning
 * state" node) or an agent that never got a workspace is "unknown", not
 * "workspace gone from disk". Conflating the two made such nodes falsely render
 * "Worktree missing" in the SessionPanel chip (PAN-1718).
 */
export function agentHasResolvableWorkspace(
  agentState: AgentState | null,
): agentState is AgentState {
  return Boolean(agentState?.workspace && agentState.issueId);
}

/**
 * Benign git-info response for a session we cannot resolve to a workspace-bound
 * agent. workspaceMissing is false (not true): we have no path to stat, so we
 * cannot assert the worktree is gone. The frontend chip hides on this shape
 * (showChip = actualBranch || workspaceMissing). The genuine on-disk
 * "workspace missing" case is detected separately by resolveAgentGitInfo, which
 * stats the real path. See PAN-1718.
 */
export const UNRESOLVABLE_AGENT_GIT_INFO = {
  actualBranch: null,
  branchDrifted: false,
  workspaceMissing: false,
  expectedBranch: null,
} as const;

const getAgentGitInfoRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/git-info',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!id.trim()) {
      return jsonResponse({ error: 'missing agent id' }, { status: 400 });
    }

    const agentState = yield* getAgentState(id);
    if (!agentHasResolvableWorkspace(agentState)) {
      // PAN-1718: unknown session id / no workspace bound → "unknown", not
      // "worktree missing". Return the benign shape so the chip hides instead of
      // flashing a false alarm. Real on-disk absence is caught by
      // resolveAgentGitInfo below.
      return jsonResponse(UNRESOLVABLE_AGENT_GIT_INFO);
    }

    const expectedBranch = `feature/${agentState.issueId.toLowerCase()}`;
    const info = yield* Effect.promise(() =>
      resolveAgentGitInfo(agentState.workspace as string, expectedBranch),
    );
    return jsonResponse({
      ...info,
      expectedBranch,
      workspacePath: agentState.workspace,
    });
  })),
);

// ─── Route: GET /api/agents/:id/activity ─────────────────────────────────────

const getAgentActivityRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/activity',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const request = yield* HttpServerRequest.HttpServerRequest;
    const urlOpt = HttpServerRequest.toURL(request);
    const limitStr = Option.isSome(urlOpt) ? (urlOpt.value.searchParams.get('limit') ?? '100') : '100';
    const limit = parseInt(limitStr) || 100;

    const activity = getActivity(id, limit);
    return jsonResponse({ activity });
  })),
);

// ─── Route: GET /api/agents/:id/files ────────────────────────────────────────

const getAgentFilesRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/files',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';

    const agentState = yield* getAgentState(id);
    if (!agentState?.workspace) {
      return jsonResponse({ files: [] });
    }
    const workspacePath = agentState.workspace;
    if (!existsSync(workspacePath)) {
      return jsonResponse({ files: [] });
    }
    const { stdout } = yield* Effect.promise(() => execAsync(
      'git diff --name-status HEAD 2>/dev/null || git status --porcelain 2>/dev/null || echo ""',
      { cwd: workspacePath, encoding: 'utf-8' }
    ));
    const files = stdout
      .split('\n')
      .filter(l => l.trim())
      .map(l => {
        const parts = l.trim().split(/\s+/);
        if (parts.length >= 2) {
          return { status: parts[0], path: parts[parts.length - 1] };
        }
        return { status: '?', path: l.trim() };
      })
      .filter(f => f.path);
    return jsonResponse({ files });
  })),
);

// ─── Route: GET /api/agents/:id/timeline ─────────────────────────────────────

const getAgentTimelineRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/timeline',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const request = yield* HttpServerRequest.HttpServerRequest;
    const urlOpt = HttpServerRequest.toURL(request);
    const limitStr = Option.isSome(urlOpt) ? (urlOpt.value.searchParams.get('limit') ?? '50') : '50';
    const limit = parseInt(limitStr) || 50;

    const activity = getActivity(id, limit);
    const agentState = yield* getAgentState(id);
    const events = activity.map((a: any) => ({
      timestamp: a.timestamp || new Date().toISOString(),
      type: a.type || 'activity',
      message: a.message || a.content || '',
    }));
    if (agentState?.startedAt) {
      events.unshift({ timestamp: agentState.startedAt, type: 'started', message: 'Agent started' });
    }
    events.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return jsonResponse({ timeline: events.slice(0, limit) });
  })),
);

// ─── Route: POST /api/agents/:id/suspend ─────────────────────────────────────

const postAgentSuspendRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/suspend',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;

    const { sessionId } = body as any;
    const effectiveSessionId = sessionId || getSessionId(id);

    if (!effectiveSessionId) {
      return jsonResponse({ error: 'Session ID required for suspend' }, { status: 400 });
    }

    yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.suspend_requested', { sessionId: effectiveSessionId }));
    saveSessionId(id, effectiveSessionId);
    // PAN-1048 review feedback 004 (C1): resolve issueId before kill so we can
    // include it on the agent.stopped payload (the contract requires it).
    const suspendIssueId = (yield* getAgentState(id))?.issueId ?? '';
    yield* killSession(id).pipe(Effect.catch(() => Effect.void));
    saveAgentRuntimeState(id, {
      state: 'suspended',
      lastActivity: new Date().toISOString(),
      claudeSessionId: effectiveSessionId,
    });
    // PAN-1908: write-through projection — agents-row upsert + lifecycle event
    // append in one SQLite transaction. Preserve the existing agent-table status
    // (suspend does not flip it to stopped).
    const stateAfterSuspend = yield* getAgentState(id);
    if (stateAfterSuspend) {
      yield* saveAgentStateAndEmitEventProgram(stateAfterSuspend, {
        type: 'agent.stopped',
        timestamp: new Date().toISOString(),
        payload: { agentId: id, issueId: stateAfterSuspend.issueId || suspendIssueId },
      });
    }

    invalidateAgentsCache();
    return jsonResponse({ success: true });
  })),
);

// ─── Route: POST /api/agents/:id/pause ────────────────────────────────────────

const postAgentPauseRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/pause',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ ok: false, error: originCheck.error }, { status: 403 });
    }

    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;
    const reason = (body as { reason?: unknown }).reason;

    if (reason !== undefined && typeof reason !== 'string') {
      return jsonResponse({ error: 'reason must be a string' }, { status: 400 });
    }

    const stateBeforePause = yield* getAgentState(id);
    if (!stateBeforePause) {
      return jsonResponse({ error: `Agent ${id} not found` }, { status: 404 });
    }

    const previousStatus = toAgentStatusPayload(stateBeforePause.status);
    const hasLiveSession = yield* sessionExists(id);
    const stoppedByPause = hasLiveSession || stateBeforePause.status === 'running' || stateBeforePause.status === 'starting';
    let updatedState = yield* setAgentPaused(id, reason, stoppedByPause);
    if (!updatedState) {
      return jsonResponse({ error: `Agent ${id} not found` }, { status: 404 });
    }

    if (hasLiveSession) {
      yield* Effect.promise(() => captureAgentOutputBeforeKill(id));
      yield* killSession(id);
    }

    if (hasLiveSession || updatedState.status === 'running' || updatedState.status === 'starting') {
      const stoppedState = markAgentStoppedState(updatedState);
      updatedState = stoppedState;
      yield* Effect.promise(() => saveAgentRuntimeState(id, {
        state: 'stopped',
        lastActivity: new Date().toISOString(),
      }));
    }

    yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.pause_requested', { reason }));
    yield* eventStore.appendAsync(operatorInterventionEvent({
      issueId: updatedState.issueId || stateBeforePause.issueId || id.replace(/^agent-/, '').toUpperCase(),
      kind: 'pause',
      source: 'dashboard',
    }));
    // PAN-1908: write-through projection — agents-row upsert + lifecycle event
    // append in one SQLite transaction.
    yield* saveAgentStateAndEmitEventProgram(updatedState, {
      type: 'agent.status_changed',
      timestamp: new Date().toISOString(),
      payload: buildAgentControlEventPayload(updatedState, previousStatus),
    });

    invalidateAgentsCache();
    return jsonResponse({ success: true, agent: updatedState });
  })),
);

// ─── Route: POST /api/agents/:id/unpause ──────────────────────────────────────

const postAgentUnpauseRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/unpause',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ ok: false, error: originCheck.error }, { status: 403 });
    }

    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const eventStore = yield* EventStoreService;

    const stateBeforeUnpause = yield* getAgentState(id);
    if (!stateBeforeUnpause) {
      return jsonResponse({ error: `Agent ${id} not found` }, { status: 404 });
    }

    const updatedState = yield* clearAgentPaused(id);
    if (!updatedState) {
      return jsonResponse({ error: `Agent ${id} not found` }, { status: 404 });
    }

    yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.unpause_requested'));
    if (stateBeforeUnpause.paused === true) {
      yield* eventStore.appendAsync(operatorInterventionEvent({
        issueId: updatedState.issueId || stateBeforeUnpause.issueId || id.replace(/^agent-/, '').toUpperCase(),
        kind: 'unpause',
        source: 'dashboard:agent-unpause',
      }));
    }
    // PAN-1908: write-through projection — agents-row upsert + lifecycle event
    // append in one SQLite transaction.
    yield* saveAgentStateAndEmitEventProgram(updatedState, {
      type: 'agent.status_changed',
      timestamp: new Date().toISOString(),
      payload: buildAgentControlEventPayload(updatedState, toAgentStatusPayload(stateBeforeUnpause.status)),
    });

    invalidateAgentsCache();
    return jsonResponse({ success: true, agent: updatedState });
  })),
);

// ─── Route: POST /api/agents/:id/untroubled ───────────────────────────────────

const postAgentUntroubledRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/untroubled',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ ok: false, error: originCheck.error }, { status: 403 });
    }

    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const eventStore = yield* EventStoreService;

    const stateBeforeClear = yield* getAgentState(id);
    if (!stateBeforeClear) {
      return jsonResponse({ error: `Agent ${id} not found` }, { status: 404 });
    }

    const updatedState = yield* clearAgentTroubled(id);
    if (!updatedState) {
      return jsonResponse({ error: `Agent ${id} not found` }, { status: 404 });
    }

    yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.untroubled_requested'));
    if (stateBeforeClear.troubled === true || (stateBeforeClear.consecutiveFailures ?? 0) > 0) {
      yield* eventStore.appendAsync(operatorInterventionEvent({
        issueId: updatedState.issueId || stateBeforeClear.issueId || id.replace(/^agent-/, '').toUpperCase(),
        kind: 'untroubled',
        source: 'dashboard:agent-untroubled',
      }));
    }
    // PAN-1908: write-through projection — agents-row upsert + lifecycle event
    // append in one SQLite transaction.
    yield* saveAgentStateAndEmitEventProgram(updatedState, {
      type: 'agent.status_changed',
      timestamp: new Date().toISOString(),
      payload: buildAgentControlEventPayload(updatedState, toAgentStatusPayload(stateBeforeClear.status)),
    });

    invalidateAgentsCache();
    return jsonResponse({ success: true, agent: updatedState });
  })),
);

// ─── Route: POST /api/agents/:id/resume ──────────────────────────────────────

const postAgentResumeRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/resume',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;

    const { message, model, harness, compact } = body as { message?: string; model?: string; harness?: RuntimeName; compact?: boolean };
    let resumeModel: string | undefined;
    try {
      resumeModel = normalizeModelOverrideSync(model);
    } catch (err) {
      console.warn(`[agents/resume] ${id} model validation failed: ${err instanceof Error ? err.message : String(err)}`);
      return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
    }
    // PAN-1985 follow-up: structured log at the route entry so the operator
    // can trace every resume attempt in the server console / pty-supervisor
    // log even when the front-end's toast is missed.
    console.log(`[agents/resume] ${id} requested: model=${resumeModel ?? 'unchanged'} harness=${harness ?? 'unchanged'} hasMessage=${!!message} compact=${compact === true}`);
    const eventStore = yield* EventStoreService;
    // Snapshot lifecycle state BEFORE taking any action so callers can see the
    // temporal context (why was this resume allowed) without recomputing state.
    const lifecycleBefore = yield* getWorkAgentLifecycleState(id);
    console.log(`[agents/resume] ${id} lifecycle: canResume=${lifecycleBefore.canResumeSession} hasSavedSession=${lifecycleBefore.hasSavedSession} hasLiveTmux=${lifecycleBefore.hasLiveTmuxSession} isCrashed=${lifecycleBefore.isCrashed} isStopped=${lifecycleBefore.isStopped}`);
    // PAN-1675: a compact-resume targets a context-wedged agent that is usually
    // still 'running' (a live but stuck session), which the normal gate rejects.
    // Allow it through for compact === true — resumeAgent summarizes the wedged
    // session out-of-band, kills it, and respawns a fresh session seeded with
    // the summary (PAN-1781; its own canResume handles the running case).
    // Non-compact resumes keep the strict gate.
    if (!lifecycleBefore.canResumeSession && !lifecycleBefore.isRunningButStuck && compact !== true) {
      console.warn(`[agents/resume] ${id} rejected: ${lifecycleBefore.reason}`);
      return jsonResponse({
        error: lifecycleBefore.reason || `Cannot resume agent ${lifecycleBefore.agentId}`,
        lifecycle: lifecycleBefore,
      }, { status: 409 });
    }

    yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.resume_requested', {
      hasMessage: !!message,
      model: resumeModel || undefined,
      harness: harness || undefined,
      lifecycle: lifecycleBefore,
    }));
    const resumeOpts = resumeModel || harness || compact === true
      ? { ...(resumeModel ? { model: resumeModel } : {}), ...(harness ? { harness } : {}), ...(compact === true ? { compact: true } : {}) }
      : undefined;
    console.log(`[agents/resume] ${id} dispatching resumeAgent() with opts=${JSON.stringify(resumeOpts)}`);
    const result = yield* Effect.promise(() => resumeAgent(id, message, resumeOpts));
    console.log(`[agents/resume] ${id} resumeAgent returned: success=${result.success} messageDelivered=${result.messageDelivered} error=${result.error ?? 'none'}`);
    if (result.success) {
      // PAN-1908: write-through projection — agents-row upsert + lifecycle event
      // append in one SQLite transaction so the read model transitions agent
      // status from 'stopped' → 'running' and the frontend updates immediately.
      const agentState = yield* getAgentState(id);
      if (agentState) {
        yield* saveAgentStateAndEmitEventProgram(agentState, {
          type: 'agent.started',
          timestamp: new Date().toISOString(),
          payload: {
            agentId: id,
            issueId: agentState.issueId,
            agent: {
              id,
              issueId: agentState.issueId,
              workspace: agentState.workspace,
              runtime: agentState.harness ?? 'claude-code',
              model: agentState.model,
              status: 'running',
              startedAt: agentState.startedAt,
              lastActivity: new Date().toISOString(),
              role: agentState.role ?? 'work',
            },
          },
        });
      }
      yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.resume_succeeded', {
        hasMessage: !!message,
        messageDelivered: result.messageDelivered !== false,
      }));
      invalidateAgentsCache();
      // PAN-1985 follow-up: the messageDelivered flag distinguishes "agent is
      // resumed and your message landed in its composer" from "agent is
      // resumed but your message did NOT land in its composer (PTY supervisor
      // echo-confirm timed out, harness/session.id mismatch, etc.)". The
      // former gets a 'delivered' toast; the latter gets a clear 'queued in
      // mail' warning so the operator can intervene if needed.
      const delivered = result.messageDelivered !== false;
      console.log(`[agents/resume] ${id} returning: success=${true} delivered=${delivered}`);
      return jsonResponse({
        success: true,
        resumed: true,
        messageDelivered: delivered,
        hint: delivered
          ? 'Continue prompt delivered to the agent.'
          : 'The continue prompt was queued in the agent mail/ folder because the live delivery path did not confirm in time. The agent will read it on its next session start.',
        lifecycle: { before: lifecycleBefore, after: yield* getWorkAgentLifecycleState(id) },
      });
    } else {
      yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.resume_failed', {
        hasMessage: !!message,
        error: result.error,
      }));
      return jsonResponse({
        error: result.error,
        lifecycle: { before: lifecycleBefore, after: yield* getWorkAgentLifecycleState(id) },
      }, { status: 400 });
    }
  })),
);

// ─── Route: POST /api/agents/:id/recover ──────────────────────────────────────

const postAgentRecoverRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/recover',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;
    const { model } = body as { model?: string };
    let recoveryModel: string | undefined;
    try {
      recoveryModel = normalizeModelOverrideSync(model);
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
    }

    const stateBeforeRecover = yield* getAgentState(id);
    if (!stateBeforeRecover) {
      return jsonResponse({ error: `Agent ${id} not found` }, { status: 404 });
    }

    yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.recover_requested', {
      model: recoveryModel || undefined,
    }));

    const result = yield* Effect.promise(() => recoverAgent(id, recoveryModel ? { modelOverride: recoveryModel } : undefined));
    if (!result) {
      const error = `Could not recover agent ${id}`;
      yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.recover_failed', { error }));
      return jsonResponse({ success: false, error }, { status: 400 });
    }

    const updatedState = yield* getAgentState(id);
    if (updatedState) {
      // PAN-1908: write-through projection — agents-row upsert + lifecycle event
      // append in one SQLite transaction.
      yield* saveAgentStateAndEmitEventProgram(updatedState, {
        type: 'agent.started',
        timestamp: new Date().toISOString(),
        payload: {
          agentId: id,
          issueId: updatedState.issueId || stateBeforeRecover.issueId || id.replace('agent-', '').toUpperCase(),
          agent: {
            id,
            issueId: updatedState.issueId || stateBeforeRecover.issueId,
            workspace: updatedState.workspace,
            model: updatedState.model,
            status: 'running',
            startedAt: updatedState.startedAt,
            lastActivity: updatedState.lastActivity,
            role: updatedState.role ?? 'work',
          },
        },
      });
    }

    yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.recover_succeeded'));
    invalidateAgentsCache();
    return jsonResponse({ success: true, recovered: true, agent: updatedState ?? null });
  })),
);

// ─── Route: POST /api/agents/:id/restart ──────────────────────────────────────
//
// Restart an agent with optional model override. Graceful mode sends a 30s
// warning then restarts; quick mode kills and relaunches immediately.
// Returns 202 for graceful (async work), 200 for quick.

const postAgentRestartRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/restart',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;

    const { model, harness, graceful = true, message } = body as {
      model?: string;
      harness?: 'claude-code' | 'ohmypi' | 'codex';
      graceful?: boolean;
      message?: string;
    };
    let restartModel: string | undefined;
    try {
      restartModel = normalizeModelOverrideSync(model);
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
    }

    const agentState = yield* getAgentState(id);
    if (!agentState) {
      return jsonResponse({ error: `Agent ${id} not found` }, { status: 404 });
    }

    yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.restart_requested', {
      model: restartModel || agentState.model,
      harness: harness || undefined,
      graceful,
      hasMessage: !!message,
    }));

    if (graceful) {
      yield* eventStore.appendAsync(operatorInterventionEvent({
        issueId: agentState.issueId,
        kind: 'restart',
        source: 'dashboard',
      }));
      // Kick off async restart — don't block the HTTP response for 30s
      (async () => {
        try {
          // PAN-1908: write-through projection — agents-row upsert + lifecycle
          // event append in one SQLite transaction.
          await Effect.runPromise(saveAgentStateAndEmitEventProgram(agentState, {
            type: 'agent.stopped',
            timestamp: new Date().toISOString(),
            payload: { agentId: id, issueId: agentState.issueId },
          }));

          const result = await restartAgent(id, { model: restartModel, harness, graceful: true, message });

          if (result.success) {
            const updatedState = await Effect.runPromise(getAgentState(id));
            // PAN-1908: write-through projection — agents-row upsert + lifecycle
            // event append in one SQLite transaction.
            if (updatedState) {
              await Effect.runPromise(saveAgentStateAndEmitEventProgram(updatedState, {
                type: 'agent.started',
                timestamp: new Date().toISOString(),
                payload: {
                  agentId: id,
                  issueId: updatedState.issueId || agentState.issueId,
                  agent: {
                    id,
                    issueId: updatedState.issueId || agentState.issueId,
                    workspace: updatedState.workspace || agentState.workspace,
                    // PAN-1048 review feedback 004 (C3): same as quick-restart
                    // below — surface the actual harness so Pi agents do not
                    // get mis-labelled as Claude Code on graceful restart.
                    runtime: updatedState.harness ?? agentState.harness ?? 'claude-code',
                    model: restartModel || updatedState.model || agentState.model,
                    status: 'running',
                    startedAt: updatedState.startedAt || agentState.startedAt,
                    lastActivity: new Date().toISOString(),
                    role: updatedState.role ?? agentState.role,
                  },
                },
              }));
            }
            invalidateAgentsCache();
          }
          await appendAgentLifecycleLog(id, 'agent.restart_completed', {
            success: result.success,
            error: result.error,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[agents] Graceful restart failed for ${id}: ${msg}`);
          await appendAgentLifecycleLog(id, 'agent.restart_failed', { error: msg });
        }
      })();

      return jsonResponse({ accepted: true, graceful: true, agentId: id }, { status: 202 });
    }

    // Quick restart — synchronous
    const result = yield* Effect.promise(() => restartAgent(id, { model: restartModel, harness, graceful: false, message }));

    if (result.success) {
      const updatedState = yield* getAgentState(id);
      yield* eventStore.appendAsync(operatorInterventionEvent({
        issueId: updatedState?.issueId || agentState.issueId,
        kind: 'restart',
        source: 'dashboard',
      }));
      // PAN-1908: write-through projection — agents-row upsert + lifecycle event
      // append in one SQLite transaction. restartAgent already saved state, but
      // repeating the upsert here makes each lifecycle event atomic.
      if (updatedState) {
        yield* saveAgentStateAndEmitEventProgram(updatedState, {
          type: 'agent.stopped',
          timestamp: new Date().toISOString(),
          payload: { agentId: id, issueId: updatedState.issueId || agentState.issueId },
        });
        yield* saveAgentStateAndEmitEventProgram(updatedState, {
          type: 'agent.started',
          timestamp: new Date().toISOString(),
          payload: {
            agentId: id,
            issueId: updatedState.issueId || agentState.issueId,
            agent: {
              id,
              issueId: updatedState.issueId || agentState.issueId,
              workspace: updatedState.workspace || agentState.workspace,
              // PAN-1048 review feedback 004 (C3): preserve the agent's actual
              // harness instead of hard-coding 'claude'. AgentSnapshot.runtime
              // is what getHarness() reads, so a Pi agent restarted through
              // this path was being mis-labelled as Claude Code.
              runtime: updatedState.harness ?? agentState.harness ?? 'claude-code',
              model: restartModel || updatedState.model || agentState.model,
              status: 'running',
              startedAt: updatedState.startedAt || agentState.startedAt,
              lastActivity: new Date().toISOString(),
              role: updatedState.role ?? agentState.role,
            },
          },
        });
      }
      invalidateAgentsCache();
      return jsonResponse({ success: true, restarted: true, agentId: id, model: restartModel || agentState.model });
    }

    return jsonResponse({ error: result.error }, { status: 500 });
  })),
);

// ─── Route: POST /api/agents/:id/restart-fresh ────────────────────────────────
//
// PAN-1985: wipe the work agent's state directory under ~/.overdeck/agents/,
// then optionally spawn a fresh work agent with a new harness/model. This is
// the deliberate operator override path — for harness/model switches (the
// Claude-session JSONL can't be resumed under a different harness) and for
// "I want a clean work run" recovery. The NORMAL review flow continues the
// same session across re-dispatches (PAN-1862); this route is the escape
// hatch that pays the re-research cost.
//
// Modes (driven by request body):
//   { spawn: true,  model, harness }  — wipe + respawn a new work agent with
//                                       the chosen harness/model
//   { spawn: false }                   — wipe only; user clicks Start afterwards
//                                       (this is the backend of the new
//                                       'completeWorkReset' issue action)
//
// Refuses (409) if a live tmux session is alive — same gate as reset-session.
// Workspace, vBRIEF, beads, .pan/continue.json, .pan/feedback/, the branch,
// and the commit history are all left untouched. The new agent (whether
// auto-spawned or manually started) reads .pan/continue.json + branch state
// to pick up where the prior run left off.

const postAgentRestartFreshRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/restart-fresh',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;

    const { spawn: spawnFlag, model: rawModel, harness } = body as {
      spawn?: boolean;
      model?: string;
      harness?: 'claude-code' | 'ohmypi' | 'codex';
    };
    const wantsSpawn = spawnFlag !== false; // default to spawn when omitted (picker path)

    let newModel: string | undefined;
    if (wantsSpawn && rawModel) {
      try {
        newModel = requireModelOverrideSync(rawModel);
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
      }
    }

    const agentState = yield* getAgentState(id);
    if (!agentState) {
      return jsonResponse({ error: `Agent ${id} not found` }, { status: 404 });
    }
    const issueId = agentState.issueId ?? id.replace(/^agent-/, '').toUpperCase();

    const lifecycle = yield* getWorkAgentLifecycleState(id);
    if (lifecycle.hasLiveTmuxSession) {
      return jsonResponse({
        error: `Agent ${id} has a live tmux session. Run 'pan kill ${issueId}' first, then retry.`,
        lifecycle,
      }, { status: 409 });
    }

    yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.restart_fresh_requested', {
      wantsSpawn,
      model: newModel,
      harness,
      issueId,
    }));

    // Kill any zombie tmux session (shouldn't happen with the gate above, but
    // belt-and-suspenders) before wiping state.
    yield* killSession(id).pipe(Effect.catch(() => Effect.void));

    // Wipe the work agent dir only — leave specialist dirs (review, etc.)
    // alone. The new agent will read .pan/continue.json to pick up.
    const wipeResult = yield* Effect.promise(() => wipeAgentStateDirs(issueId));
    yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.restart_fresh_wiped', {
      removed: wipeResult.removed,
      path: wipeResult.path,
    }));

    if (!wantsSpawn) {
      invalidateAgentsCache();
      return jsonResponse({
        success: true,
        spawn: false,
        agentId: id,
        issueId,
        removed: wipeResult.removed,
        hint: 'Agent dir wiped. Click Start agent to respawn with a fresh session.',
      });
    }

    // Auto-spawn path: dispatch to the existing /api/agents spawn flow.
    // We don't go through HTTP — we call the spawn primitives directly so
    // the caller gets a single 200 with both wipe and spawn confirmed.
    const spawnModel = newModel ?? agentState.model ?? 'claude-sonnet-5';
    let effectiveHarness: 'claude-code' | 'ohmypi' | 'codex' | null = null;
    if (harness) {
      const harnessDecision = yield* Effect.promise(async () =>
        canUseHarnessSync(harness, spawnModel, await getProviderAuthMode(spawnModel)),
      );
      effectiveHarness = harnessDecision.allowed ? harness : 'claude-code';
    }

    const agentSessionName = `agent-${issueId.toLowerCase()}`;
    const projectPath = agentState.workspace
      ? dirname(agentState.workspace)
      : undefined;
    const projectConfig = resolveProjectFromIssueSync(issueId);
    const projectRoot = projectConfig?.projectPath ?? projectPath ?? process.cwd();
    const workspacePath = agentState.workspace ?? join(projectRoot, 'workspaces', `feature-${issueId.toLowerCase()}`);

    const args = buildPanStartArgs({
      issueId,
      model: spawnModel,
      harness: effectiveHarness,
    });

    yield* Effect.promise(() => appendAgentLifecycleLog(agentSessionName, 'agent.restart_fresh_spawn_requested', {
      args,
      model: spawnModel,
      harness: effectiveHarness,
    }));

    // Spawn detached `pan start` — same pattern the existing POST /api/agents
    // route uses, minus the HTTP hop. We deliberately write a placeholder
    // state.json (matching the existing spawn flow) so the dashboard
    // transitions the agent from "stopped" to "starting" within one refresh.
    saveAgentStateSync({
      id: agentSessionName,
      issueId,
      workspace: workspacePath,
      harness: effectiveHarness ?? 'claude-code',
      role: 'work',
      model: 'pending-work-spawn',
      status: 'starting',
      startedAt: new Date().toISOString(),
    });

    try {
      yield* Effect.promise(() => spawnPanCommandDetached({
        agentSessionName,
        issueId,
        role: 'work',
        workspacePath,
        args,
        cwd: workspacePath,
      }));
    } catch (err: any) {
      return jsonResponse({
        success: false,
        error: `Agent dir wiped but spawn failed: ${err?.message ?? String(err)}`,
        wiped: wipeResult.removed,
      }, { status: 500 });
    }

    yield* Effect.promise(() => appendAgentLifecycleLog(agentSessionName, 'agent.restart_fresh_spawn_requested_complete', {
      model: spawnModel,
      harness: effectiveHarness,
    }));

    invalidateAgentsCache();
    return jsonResponse({
      success: true,
      spawn: true,
      agentId: id,
      issueId,
      removed: wipeResult.removed,
      spawnedModel: spawnModel,
      spawnedHarness: effectiveHarness,
      hint: 'Fresh work agent spawned. It will read .pan/continue.json and the branch state to continue.',
    });
  })),
);

// ─── Route: GET /api/agents/:id/cloister-health ──────────────────────────────

const getAgentCloisterHealthRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/cloister-health',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';

    const service = getCloisterService();
    const health = service.getAgentHealth(id);
    if (!health) {
      return jsonResponse({ error: 'Agent not found or runtime not available' }, { status: 404 });
    }
    return jsonResponse(health);
  })),
);

// ─── Route: GET /api/agents/:id/handoff/suggestion ───────────────────────────

const getAgentHandoffSuggestionRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/handoff/suggestion',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';

    const agentState = yield* getAgentState(id);
    if (!agentState) {
      return jsonResponse({ error: 'Agent not found' }, { status: 404 });
    }

    const runtime = getRuntimeForAgent(id);
    if (!runtime) {
      return jsonResponse({ error: 'Runtime not found for agent' }, { status: 404 });
    }

    const health = getAgentHealth(id, runtime);
    const triggers = yield* checkAllTriggers(
      id,
      agentState.workspace,
      agentState.issueId,
      agentState.model,
      health,
      loadCloisterConfigSync()
    );

    if (triggers.length > 0) {
      const trigger = triggers[0];
      return jsonResponse({
        suggested: true,
        trigger: trigger.type,
        currentModel: agentState.model,
        suggestedModel: trigger.suggestedModel,
        reason: trigger.reason,
      });
    }

    return jsonResponse({
      suggested: false,
      trigger: null,
      currentModel: agentState.model,
      suggestedModel: null,
      reason: 'No handoff triggers detected',
    });
  })),
);

// ─── Route: POST /api/agents/:id/handoff ─────────────────────────────────────

const postAgentHandoffRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/handoff',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;

    const { toModel, reason } = body as any;
    let targetModel: string;
    try {
      targetModel = requireModelOverrideSync(toModel);
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
    }

    const result = yield* performHandoff(id, {
      targetModel,
      reason: reason || 'Manual handoff from dashboard',
    });

    if (result.success) {
      return jsonResponse({
        success: true,
        newAgentId: result.newAgentId,
        newSessionId: result.newSessionId,
      });
    } else {
      return jsonResponse({ success: false, error: result.error }, { status: 500 });
    }
  })),
);


// ─── Route: GET /api/agents/:id/cost ─────────────────────────────────────────

const getAgentCostRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/cost',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';

    const agentState = yield* getAgentState(id);
    if (!agentState) {
      return jsonResponse({ error: 'Agent not found' }, { status: 404 });
    }

    let cost = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let detectedModel = agentState.model || '';
    // Claude Code repeats the same `usage` on every JSONL line of one API response
    // (text line, each tool_use line, …). Dedup on requestId/message.id so a multi-block
    // turn is counted once instead of inflating tokens/cost ~2-3×.
    const countedUsageIds = new Set<string>();

    const homeDir = process.env.HOME || homedir();
    const claudeProjectsDir = join(homeDir, '.claude', 'projects');
    const workspacePath = agentState.workspace;

    if (workspacePath) {
      const projectDirName = encodeClaudeProjectDir(workspacePath);
      const projectDir = join(claudeProjectsDir, projectDirName);
      const sessionsIndexPath = join(projectDir, 'sessions-index.json');

      const parseJsonlCost = async (filePath: string) => {
        const jsonlContent = await readFile(filePath, 'utf-8');
        const lines = jsonlContent.split('\n').filter((l: string) => l.trim());
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            const usage = entry.message?.usage || entry.usage;
            const model = entry.message?.model || entry.model;
            const usageId = entry.requestId ?? entry.message?.id;
            if (usage && (usageId === undefined || !countedUsageIds.has(usageId))) {
              if (usageId !== undefined) countedUsageIds.add(usageId);
              inputTokens += usage.input_tokens || 0;
              outputTokens += usage.output_tokens || 0;
              cacheReadTokens += usage.cache_read_input_tokens || 0;
              cacheWriteTokens += usage.cache_creation_input_tokens || 0;
            }
            if (model && !detectedModel) {
              detectedModel = model;
            }
          } catch {}
        }
      };

      if (existsSync(sessionsIndexPath)) {
        try {
          const indexContent = JSON.parse(yield* Effect.promise(() => readFile(sessionsIndexPath, 'utf-8')));
          for (const sessionEntry of (indexContent.entries || [])) {
            if (sessionEntry?.fullPath && existsSync(sessionEntry.fullPath)) {
              yield* Effect.promise(() => parseJsonlCost(sessionEntry.fullPath));
            }
          }
        } catch {}
      }

      if (inputTokens === 0 && existsSync(projectDir)) {
        try {
          const files = (yield* Effect.promise(() => readdir(projectDir))).filter(f => f.endsWith('.jsonl'));
          for (const file of files) {
            yield* Effect.promise(() => parseJsonlCost(join(projectDir, file)));
          }
        } catch {}
      }
    }

    if (inputTokens > 0 || outputTokens > 0) {
      const modelInfo = normalizeModelName(detectedModel || 'claude-sonnet-4');
      const pricing = getPricingSync(modelInfo.provider, modelInfo.model);
      if (pricing) {
        const usage: TokenUsage = {
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
        };
        cost = calculateCostSync(usage, pricing);
      }
    }

    return jsonResponse({
      agentId: id,
      model: detectedModel || agentState.model,
      tokens: {
        input: inputTokens,
        output: outputTokens,
        cacheRead: cacheReadTokens,
        cacheWrite: cacheWriteTokens,
      },
      cost,
    });
  })),
);

// ─── Route: POST /api/agents (start agent) ───────────────────────────────────

const postAgentsRoute = HttpRouter.add(
  'POST',
  '/api/agents',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ ok: false, error: originCheck.error }, { status: 403 });
    }

    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;
    const lifecycle = yield* IssueLifecycle;
    const readModel = yield* ReadModelService;

    const { issueId, projectId } = body as any;
    const autoStart = (body as any).auto === true;
    const guardrailAcknowledged = (body as any).guardrailAcknowledged === true;
    const requestedHostOverride = (body as any).host === true || (body as any).allowHost === true;

    if (!issueId) {
      return jsonResponse({ error: 'issueId required' }, { status: 400 });
    }

    const legacyFields = ['workType', 'phase', 'agentType'].filter((field) => field in (body as Record<string, unknown>));
    if (legacyFields.length > 0) {
      return jsonResponse({
        error: `Legacy start-agent field(s) are no longer accepted: ${legacyFields.join(', ')}. Send role: 'work' instead.`,
      }, { status: 400 });
    }

    const role = (body as any).role ?? 'work';
    if (role !== 'work') {
      return jsonResponse({ error: `Unsupported agent role "${String(role)}". POST /api/agents only starts role: 'work'.` }, { status: 400 });
    }

    // Reject bare numeric IDs (e.g. "484") — they have no project prefix, so tracker
    // routing and workspace naming both fail. Require "PAN-484" style.
    if (/^\d+$/.test(String(issueId))) {
      return jsonResponse(
        {
          error: `Invalid issueId "${issueId}": bare numeric IDs are not allowed. Use a prefixed ID (e.g. PAN-${issueId}).`,
          hint: 'Issue IDs must include a project prefix (e.g. PAN-484, MIN-123).',
        },
        { status: 422 },
      );
    }

    const parsedIssueId = parseIssueIdSync(String(issueId));
    if (!parsedIssueId) {
      return jsonResponse(
        {
          error: `Invalid issueId "${issueId}": issue IDs must use a supported project format (e.g. PAN-484, MIN-123).`,
          hint: 'Issue IDs must include a project prefix and numeric identifier.',
        },
        { status: 422 },
      );
    }

    const hostOverrideConfirmation = buildHostOverrideConfirmation(String(issueId));
    const allowHost = requestedHostOverride && (body as any).hostOverrideConfirmation === hostOverrideConfirmation;
    if (requestedHostOverride && !allowHost) {
      return jsonResponse({
        success: false,
        error: 'host_override_confirmation_required',
        requiresHostConfirmation: true,
        confirmation: hostOverrideConfirmation,
        hint: `Host override bypasses workspace isolation. Retry only after explicitly confirming: ${hostOverrideConfirmation}`,
      }, { status: 409 });
    }

    // Guard: reject starting agents for already-closed issues
    const issueDataService = getIssueDataService();
    const cachedIssues = issueDataService.getIssues();
    const cachedIssue = cachedIssues.find(
      (i: any) => (i.identifier || '').toUpperCase() === issueId.toUpperCase()
    );
    if (cachedIssue && (cachedIssue.canonicalStatus === 'done' || cachedIssue.canonicalStatus === 'canceled')) {
      return jsonResponse(
        {
          error: `Issue ${issueId} is already closed (${cachedIssue.canonicalStatus}). Cannot start an agent for a closed issue.`,
          hint: 'Reopen the issue first if you need to resume work.',
        },
        { status: 422 },
      );
    }

    const issueLower = parsedIssueId.normalized;
    const agentSessionName = `agent-${issueLower}`;
    const startGateBlock = evaluateAgentStartGate(agentSessionName, yield* getAgentState(agentSessionName));
    if (startGateBlock) {
      yield* Effect.promise(() => appendAgentLifecycleLog(agentSessionName, 'agent.start_blocked_gate', {
        issueId,
        paused: startGateBlock.paused,
        troubled: startGateBlock.troubled,
        reason: startGateBlock.error,
      }));
      return jsonResponse(startGateBlock, { status: 409 });
    }

    const workspaceMetadata = loadWorkspaceMetadataFn(issueId);
    const isRemote = workspaceMetadata?.location === 'remote';

    const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
    const resolvedProject = resolveProjectFromIssueSync(String(issueId));
    const projectConfig = resolvedProject ? getProjectSync(resolvedProject.projectKey) : null;
    const projectPath = projectConfig?.path ?? getProjectPath(projectId, issuePrefix);

    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
    if (!existsSync(workspacePath)) {
      try {
        const nodeDir = dirname(process.execPath);
        yield* Effect.promise(() => execAsync(
          `pan workspace create ${issueId} --local`,
          { cwd: projectPath, encoding: 'utf-8', timeout: 60000, env: buildChildEnvWithoutTmuxSync(process.env, { PATH: `${nodeDir}:${process.env.PATH ?? ''}` }) }
        ));
      } catch (wsErr) {
        return jsonResponse({
          error: `Failed to create workspace for ${issueId}: ${(wsErr as Error).message}`,
          hint: 'Try creating the workspace manually: pan workspace create ' + issueId + ' --local',
        }, { status: 500 });
      }
    }

    const workspacePanDir = join(workspacePath, PAN_DIRNAME);
    const workspacePanContinuePath = join(workspacePanDir, PAN_CONTINUE_FILENAME);

    const workspaceBeadsDir = join(workspacePath, '.beads');
    if (!existsSync(workspaceBeadsDir)) {
      const projectRootBeadsDir = join(projectPath, '.beads');
      if (existsSync(projectRootBeadsDir)) {
        try {
          yield* Effect.promise(() => cp(projectRootBeadsDir, workspaceBeadsDir, { recursive: true }));
        } catch {}
      }
    }

    let planPath = yield* findPlan(workspacePath);
    if (autoStart && !planPath) {
      const issueTitle = cachedIssue?.title || issueId;
      const issueBody = cachedIssue?.description || '';
      // writeAutoStartVBrief is Effect-returning — yield it directly (PAN-1768).
      yield* writeAutoStartVBrief(projectPath, workspacePath, {
        issueId,
        title: issueTitle,
        body: issueBody,
        url: cachedIssue?.url,
      });
      planPath = yield* findPlan(workspacePath);
    }
    if (!planPath) {
      return jsonResponse({
        error: `No workspace vBRIEF found for ${issueId}. Work agents require a finalized plan with matching beads.`,
        hint: 'Run planning first, or use auto-start to synthesize a plan before starting the work agent.',
        issueId,
      }, { status: 422 });
    }

    const planReadResult = yield* readPlan(planPath).pipe(
      Effect.match({
        onFailure: (planErr) => ({ _tag: 'failure' as const, planErr }),
        onSuccess: (planDoc) => ({ _tag: 'success' as const, planDoc }),
      }),
    );
    if (planReadResult._tag === 'failure') {
      const { planErr } = planReadResult;
      return jsonResponse({
        error: `Could not read workspace vBRIEF for ${issueId}: ${planErr instanceof Error ? planErr.message : String(planErr)}`,
        hint: 'Re-run planning to produce a readable vBRIEF before starting the work agent.',
        issueId,
      }, { status: 422 });
    }
    const { planDoc } = planReadResult;

    const planIssueId = planDoc?.plan?.id;
    if (planIssueId && planIssueId.toLowerCase() !== issueLower) {
      return jsonResponse({
        error: `Plan in workspace is for ${planIssueId.toUpperCase()}, not ${issueId}. The workspace contains stale planning artifacts from a different issue.`,
        hint: 'Run planning for this issue first, or clean the workspace planning artifacts.',
        issueId,
        expectedIssue: issueId,
        actualIssue: planIssueId.toUpperCase(),
      }, { status: 422 });
    }

    const planItemCount = planDoc?.plan?.items?.length ?? 0;
    if (planItemCount === 0) {
      return jsonResponse({
        error: 'Plan exists but contains no items. Planning may have failed or produced an empty plan.',
        hint: 'Re-run planning to produce a plan with tasks and acceptance criteria.',
        issueId,
      }, { status: 422 });
    }

    let hasBeads = false;
    let beadCount = 0;
    try {
      const { stdout: bdOutput } = yield* withBdMutex(() => Effect.promise(() => execFileAsync(
        'bd',
        ['list', '--json', '-l', issueLower, '--status', 'all', '--limit', '0'],
        { cwd: workspacePath, encoding: 'utf-8', timeout: 10000 },
      )));
      const bdTasks = JSON.parse(bdOutput.trim() || '[]');
      beadCount = Array.isArray(bdTasks) ? bdTasks.length : 0;
      hasBeads = beadCount > 0;
      if (planItemCount !== null && planItemCount > 0 && beadCount !== planItemCount) {
        hasBeads = false;
      }
    } catch {}

    let recoveryError: string | null = null;
    if (!hasBeads) {
      // Auto-recovery: beads DB may not have been initialized (fresh install, or planning
      // completed before bd init ran). Attempt to create beads from the vBRIEF plan now.
      console.log(`[agents] No beads for ${issueId} — attempting auto-recovery via createBeadsFromVBrief`);
      try {
        const { createBeadsFromVBrief } = yield* Effect.promise(() => import('../../../lib/vbrief/beads.js'));
        const recovery = yield* createBeadsFromVBrief(workspacePath);
        beadCount = recovery.created.length;
        hasBeads = recovery.created.length > 0 && (planItemCount === null || recovery.created.length === planItemCount);
        if (hasBeads) {
          console.log(`[agents] Auto-recovery created ${recovery.created.length} beads for ${issueId}`);
        } else if (recovery.created.length > 0 && planItemCount !== null) {
          recoveryError = `created ${recovery.created.length} beads, but vBRIEF has ${planItemCount} plan items`;
        } else if (recovery.errors.length > 0) {
          recoveryError = recovery.errors[0] ?? 'Unknown error during beads creation';
          console.warn(`[agents] Auto-recovery errors: ${recovery.errors.join(', ')}`);
        } else {
          recoveryError = 'createBeadsFromVBrief returned no beads and no errors';
        }
      } catch (recoveryErr: any) {
        recoveryError = recoveryErr.message;
        console.warn(`[agents] Auto-recovery failed: ${recoveryErr.message}`);
      }
    }

    if (!hasBeads) {
      // PAN-1048 C6: Beads are a hard requirement for the work role — without
      // them the agent has nothing to claim, no Jidoka inspection scope, and
      // commits would batch across multiple beads. Recovery already attempted
      // above via createBeadsFromVBrief; if that failed the workspace's vBRIEF
      // is missing or malformed, which is a planning bug that must surface to
      // the operator. Refuse the spawn with 422 instead of starting a half-
      // configured work agent that will silently misbehave.
      const detail = recoveryError
        ? ` Beads recovery failed: ${recoveryError}.`
        : ' No beads exist for this issue.';
      console.warn(`[agents] Refusing to start work agent for ${issueId} without beads.${detail}`);
      return jsonResponse({
        success: false,
        error: 'beads_required',
        message: `Cannot start work agent for ${issueId} without beads.${detail} `
          + 'Re-run planning so beads can be materialized from the vBRIEF plan, then retry.',
        ...(recoveryError ? { recoveryError } : {}),
      }, { status: 422 });
    }

    const health = yield* readModel.getSnapshot.pipe(
      Effect.flatMap((snapshot) => Effect.promise(() => getSystemHealthSnapshot(snapshot))),
    );
    emitStartAgentPhase(issueId, 'guardrails', 'start', 'evaluating spawn guardrails');
    const spawnGuardrails = evaluateSpawnGuardrails(health);
    if (spawnGuardrails.blocked) {
      emitStartAgentPhase(issueId, 'guardrails', 'failure', spawnGuardrails.error ?? 'guardrails blocked', {
        status: spawnGuardrails.status,
        hint: spawnGuardrails.hint,
      });
      return jsonResponse({
        success: false,
        blocked: true,
        skipped: true,
        error: spawnGuardrails.error,
        hint: spawnGuardrails.hint,
        guardrails: spawnGuardrails,
      }, { status: spawnGuardrails.status });
    }
    if (spawnGuardrails.requiresAcknowledgement && !guardrailAcknowledged) {
      emitStartAgentPhase(issueId, 'guardrails', 'skipped', 'guardrail acknowledgement required', {
        status: spawnGuardrails.status,
        hint: spawnGuardrails.hint,
      });
      return jsonResponse({
        success: false,
        blocked: false,
        skipped: true,
        requiresAcknowledgement: true,
        hint: spawnGuardrails.hint,
        guardrails: spawnGuardrails,
      }, { status: spawnGuardrails.status });
    }
    emitStartAgentPhase(issueId, 'guardrails', 'success', 'spawn guardrails passed');

    let spawnModel: string;
    try {
      spawnModel = determineModel({
        model: (body as any).model,
        role,
        spawnKey: `${role}:${issueId}`,
      });
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
    }
    const providerAuthMode = yield* Effect.promise(() => getProviderAuthMode(spawnModel));
    if (providerAuthMode === 'subscription') {
      const codexAuth = yield* checkCodexAuthStatus();
      if (codexAuth.status === 'expired' || codexAuth.status === 'burned') {
        return jsonResponse({
          success: false,
          blocked: true,
          skipped: true,
          error: `Codex authentication ${codexAuth.status}. GPT subscription agents cannot spawn with expired/burned tokens.`,
          hint: 'Click "Re-authenticate" in the Codex auth banner or Settings page to refresh your OpenAI subscription tokens.',
        }, { status: 429 });
      }
    }

    // Pre-flight provider health check — detect quota/auth/network errors
    // before spawning the agent into Claude Code's opaque retry loop.
    // validateProviderHealth returns an Effect (typed ProviderHealthError
    // channel) — wrapping it in Effect.promise handed a non-thenable to the
    // runtime and crashed the whole request (PAN-1768).
    const providerHealthCheck = yield* validateProviderHealth(spawnModel).pipe(
      Effect.match({
        onFailure: (err) => ({ _tag: 'failure' as const, err }),
        onSuccess: () => ({ _tag: 'success' as const, err: null }),
      }),
    );
    if (providerHealthCheck._tag === 'failure' && providerHealthCheck.err) {
      const err = providerHealthCheck.err;
      return jsonResponse({
        success: false,
        blocked: true,
        skipped: true,
        error: err.message,
        hint: err.probeResult.kind === 'quota'
          ? 'Top up your credits on the provider dashboard, or switch this agent to a different model.'
          : err.probeResult.kind === 'auth'
            ? 'Check your API key in Settings → Providers.'
            : 'The provider may be temporarily unavailable. Try again later or switch models.',
        providerHealth: {
          provider: err.provider.name,
          model: err.model,
          kind: err.probeResult.kind,
          status: err.probeResult.status,
        },
      }, { status: 429 });
    }

    if (!isRemote) {
      emitStartAgentPhase(issueId, 'stackHealthGate', 'start', 'checking workspace docker stack health', { workspacePath });
      const stackHealth = yield* getWorkspaceStackHealth(issueId, { projectConfig, workspacePath });
      if (!stackHealth.healthy) {
        yield* Effect.promise(() => appendAgentLifecycleLog(agentSessionName, 'agent.start_blocked_stack_unhealthy', {
          issueId,
          reasons: stackHealth.reasons,
          lastObserved: stackHealth.lastObserved,
        }));
        if (!allowHost) {
          emitStartAgentPhase(issueId, 'stackHealthGate', 'failure', stackHealth.reasons.join('; '), {
            workspacePath,
            lastObserved: stackHealth.lastObserved,
          });
          emitActivityEntrySync({
            source: 'dashboard',
            level: 'error',
            issueId: issueId.toUpperCase(),
            message: `agent-spawn-blocked-stack-unhealthy: ${issueId.toUpperCase()}`,
            details: stackHealth.reasons.join('; '),
          });
          return jsonResponse({
            success: false,
            blocked: true,
            skipped: true,
            error: `Workspace docker stack for ${issueId} is not healthy: ${stackHealth.reasons.join('; ')}`,
            hint: `Run 'pan workspace rebuild ${issueId}' or use the CLI break-glass path: pan start ${issueId} --host.`,
            stackHealth,
          }, { status: 422 });
        }
        emitStartAgentPhase(issueId, 'stackHealthGate', 'skipped', 'stack unhealthy but host override confirmed', {
          workspacePath,
          reasons: stackHealth.reasons,
        });
      } else {
        emitStartAgentPhase(issueId, 'stackHealthGate', 'success', 'workspace docker stack healthy', { workspacePath });
      }
    } else {
      emitStartAgentPhase(issueId, 'stackHealthGate', 'skipped', 'remote workspace skips local stack-health gate', { workspacePath });
    }

    if (allowHost) {
      // PAN-1556: host-override is a spawn detail, not user-facing activity.
      console.warn(`[agents] agent-spawn-host-override: ${issueId.toUpperCase()} (dashboard-confirmed)`);
    }

    if (existsSync(workspacePanContinuePath) || existsSync(workspacePanDir)) {
      // Commit workspace orchestration artifacts before handing off to the work agent.
      // The entire block is best-effort — never let git errors abort the agent start.
      yield* Effect.gen(function* () {
        const gitRoot = workspacePath;
        if (existsSync(join(gitRoot, PAN_DIRNAME))) {
          // PAN-1819: use plain git add (never -f) and exclude workspace-state/sync-target paths.
          yield* Effect.promise(() => execAsync(`git add .pan/`, { cwd: gitRoot, encoding: 'utf-8' }));
          yield* Effect.promise(() => execAsync(
            `git reset HEAD -- .pan/kickoff.md .pan/continue.json .pan/handoff-*.md .pan/spec.vbrief.json`,
            { cwd: gitRoot, encoding: 'utf-8' },
          ));
        }
        if (existsSync(join(gitRoot, '.beads'))) {
          yield* Effect.promise(() => execAsync(`git add .beads/`, { cwd: gitRoot, encoding: 'utf-8' }));
        }
        // git diff --cached --quiet exits 1 when there ARE staged changes (normal).
        // Handle exit-1 in the Promise so it never becomes an Effect failure.
        const diffResult = yield* Effect.promise(() =>
          execAsync(`git diff --cached --quiet`, { cwd: gitRoot, encoding: 'utf-8' })
            .then(() => false)
            .catch(() => true)
        );
        if (diffResult) {
          yield* Effect.promise(() => execAsync(`git commit -m "chore: planning artifacts for ${issueId} before agent start"`, { cwd: gitRoot, encoding: 'utf-8' }));
          const pushChild = spawn('git', ['push'], { cwd: gitRoot, detached: true, stdio: 'ignore' });
          pushChild.unref();
        }
      }).pipe(Effect.catch(() => Effect.void));
    }

    // Approval transition (PAN-946): move the scope vBRIEF on main from
    // proposed/ → active/ and stamp plan.status='approved'. Idempotent: if the
    // vBRIEF is already in active/ with status approved, this is a no-op. The
    // commit only happens when projectPath is on main; otherwise the on-disk
    // move still applies and a later sync will pick it up. Failure is non-fatal
    // — agent spawn proceeds even if the lifecycle move fails.
    // transitionVBriefOnMain is Effect-returning — match on it directly (PAN-1768).
    yield* transitionVBriefOnMain(
      projectPath,
      issueId,
      'active',
      'approved',
      `scope: approve ${issueId.toUpperCase()} vBRIEF`,
    ).pipe(
      Effect.match({
        onSuccess: (result) => {
          if (result.moved) {
            console.log(`[start-agent] vBRIEF moved ${result.fromDir} → active for ${issueId}`);
          }
          if (result.committed) {
            console.log(`[start-agent] Committed approval transition on main for ${issueId}`);
          }
        },
        onFailure: (err) => {
          console.warn(`[start-agent] vBRIEF approval transition failed (non-fatal): ${err?.message ?? err}`);
        },
      }),
    );

    // Running transition (PAN-946): set workspace plan.status to 'running'.
    // This is the worktree-side state — the workspace vBRIEF resolved by
    // findPlan() is updated directly, and the planning artifacts commit below
    // will pick it up. Non-fatal: agent starts even if the write fails.
    if (existsSync(planPath)) {
      try {
        updatePlanStatus(planPath, 'running');
        console.log(`[start-agent] Set plan.status=running for ${issueId}`);
      } catch (planStatusErr: any) {
        console.warn(`[start-agent] Failed to set plan.status=running (non-fatal): ${planStatusErr?.message ?? planStatusErr}`);
      }
    }

    // Write start session entry to per-issue record (PAN-1919)
    try {
      const { appendSessionEntry, getProjectConfigFromWorkspacePath, resolveProjectForIssue } =
        yield* Effect.promise(() => import('../../../lib/pan-dir/record.js'));
      const recordProject = resolveProjectForIssue(issueId) ?? getProjectConfigFromWorkspacePath(workspacePath);
      yield* Effect.promise(() => appendSessionEntry(recordProject, issueId, {
        timestamp: new Date().toISOString(),
        reason: 'start',
        agentModel: spawnModel,
      }));
      console.log(`[start-agent] Wrote start session entry to record for ${issueId}`);
    } catch (continueErr: any) {
      console.warn(`[start-agent] Failed to write start entry to record (non-fatal): ${continueErr?.message ?? continueErr}`);
    }

    if (isRemote && workspaceMetadata) {
      const { spawnRemoteAgent, checkRemoteSpendCap } = yield* Effect.promise(() => import('../../../lib/remote/remote-agents.js'));
      const { createFlyProviderFromConfig } = yield* Effect.promise(() => import('../../../lib/remote/index.js'));
      const { loadConfigSync: loadPanConfig } = yield* Effect.promise(() => import('../../../lib/config.js'));
      const panConfig = loadPanConfig();
      const spendCap = checkRemoteSpendCap(panConfig);
      if (!spendCap.allowed) {
        return jsonResponse({ error: spendCap.message }, { status: 429 });
      }
      const fly = createFlyProviderFromConfig(panConfig.remote);
      yield* Effect.promise(() => fly.syncAllCredentials(workspaceMetadata.vmName));

      const { buildWorkAgentPrompt, getTrackerContext } = yield* Effect.promise(() => import('../../../lib/cloister/work-agent-prompt.js'));
      const trackerContext = yield* Effect.promise(() => getTrackerContext(issueId, workspacePath));
      const agentPrompt = yield* Effect.promise(() => buildWorkAgentPrompt({
        issueId,
        env: 'REMOTE',
        workspacePath: '/workspace',
        skipDynamicContext: true,
        trackerContext,
      }));

      emitStartAgentPhase(issueId, 'spawn', 'start', 'starting remote work agent', {
        workspacePath,
        vmName: workspaceMetadata.vmName,
      });
      const state = yield* Effect.promise(() => spawnRemoteAgent({
        issueId,
        workspace: workspaceMetadata,
        prompt: agentPrompt,
        model: spawnModel,
        tier: fly.getResiliencyTier(),
      }));

      // Write canonical state.json so activeRoleRunExists() sees this remote
      // work agent as active before we emit the lifecycle transition below.
      // spawnRemoteAgent only writes remote-state.json; without state.json the
      // Cloister duplicate-spawn guard misses the in-flight remote agent and
      // would spawn a second local work run when in_progress is emitted.
      yield* saveAgentState({
        id: state.id,
        issueId: state.issueId,
        workspace: workspacePath,
        role: 'work',
        model: spawnModel,
        status: 'starting',
        startedAt: state.startedAt,
        harness: 'claude-code',
      });
      updateRegistryForAgentStart(state.issueId, workspacePath, state.id);

      // PAN-1048: lifecycle.transitionTo() is the single source of issue.transitioned.
      // The redundant issue.statusChanged emit was racing with reactive Cloister:
      // Cloister mapped 'in_progress' → 'work' role and tried to spawn a second
      // run while activeRoleRunExists() still saw no state.json for the
      // in-flight spawn above. state.json is now written before this emit.
      yield* Effect.promise(() => Effect.runPromise(
        lifecycle.transitionTo(issueId, 'in_progress').pipe(Effect.catch(() => Effect.void))
      ));

      // PAN-1048 review feedback 003: emit a contract-compliant agent.started
      // event. The reducer writes event.payload.agent into agentsById keyed by
      // event.payload.agentId — the previous shape ({ agentId: issueId, issueId })
      // omitted .agent and used the issue ID as the key, inserting `undefined`
      // into the read model and breaking dashboard consumers.
      //
      // PAN-1908: write-through projection — agents-row upsert + lifecycle event
      // append in one SQLite transaction.
      yield* saveAgentStateAndEmitEventProgram({
        id: state.id,
        issueId: state.issueId,
        workspace: workspacePath,
        role: 'work',
        model: spawnModel,
        status: state.status,
        startedAt: state.startedAt,
        harness: 'claude-code',
      }, {
        type: 'agent.started',
        timestamp: new Date().toISOString(),
        payload: {
          agentId: state.id,
          issueId: state.issueId,
          agent: {
            id: state.id,
            issueId: state.issueId,
            role: 'work' as const,
            model: spawnModel,
            status: state.status,
            startedAt: state.startedAt,
            lastActivity: state.lastActivity,
          },
        },
      });
      emitStartAgentPhase(issueId, 'spawn', 'success', 'remote work agent spawn requested', {
        agentId: state.id,
        vmName: workspaceMetadata.vmName,
      });
      try { getIssueDataService().patchIssue(issueId, { status: 'In Progress', canonicalStatus: 'in_progress' }); } catch { /* non-fatal */ }
      invalidateAgentsCache();
      return jsonResponse({
        success: true,
        message: `Starting remote agent for ${issueId}`,
        remote: true,
        vmName: workspaceMetadata.vmName,
        agentId: state.id,
        projectPath,
        guardrails: spawnGuardrails,
      });
    }

    // Local workspace
    const devScript = join(workspacePath, 'dev');
    const hasPlanning = existsSync(join(workspacePath, PAN_DIRNAME));

    yield* Effect.promise(() => appendAgentLifecycleLog(agentSessionName, 'agent.start_requested', {
      issueId,
      workspacePath,
      hasPlanning,
      role,
    }));

    const agentLifecycle = yield* getWorkAgentLifecycleState(agentSessionName);
    yield* Effect.promise(() => appendAgentLifecycleLog(agentSessionName, 'agent.start_lifecycle_evaluated', {
      issueId,
      lifecycle: agentLifecycle,
    }));
    if (!agentLifecycle.canStartFresh) {
      yield* Effect.promise(() => appendAgentLifecycleLog(agentSessionName, 'agent.start_blocked', {
        issueId,
        reason: agentLifecycle.reason,
        lifecycle: agentLifecycle,
      }));
      return jsonResponse({
        error: agentLifecycle.reason || `Cannot start agent for ${issueId}`,
        lifecycle: agentLifecycle,
      }, { status: 409 });
    }

    yield* Effect.gen(function* () {
      const exists = yield* sessionExists(agentSessionName);
      if (exists) yield* killSession(agentSessionName);
      console.log(`[start-agent] Killed stale tmux session ${agentSessionName}`);
    }).pipe(Effect.catch(() => Effect.void));

    // PAN-1531: dirty-worktree refusal replaces silent pre-spawn stashing.
    // If the workspace has uncommitted changes the route returns 409 with the
    // diff so the dashboard can present the user three explicit choices:
    // Commit / Discard (typed confirmation required) / Stash as salvageable.
    // Clients that have already resolved the dirtiness MUST pass
    // `acknowledgeDirtyWorkspace: true` to bypass this gate (typically after
    // the user clicked one of the three modal buttons).
    const acknowledgeDirtyWorkspace = (body as any).acknowledgeDirtyWorkspace === true;
    if (!acknowledgeDirtyWorkspace) {
      try {
        const { stdout: statusOut } = yield* Effect.promise(() => execAsync('git status --porcelain', {
          cwd: workspacePath,
          encoding: 'utf-8',
        }));
        if (statusOut.trim()) {
          const { stdout: diffOut } = yield* Effect.promise(() => execAsync('git diff HEAD --stat', {
            cwd: workspacePath,
            encoding: 'utf-8',
          }).catch(() => ({ stdout: '' })));
          yield* Effect.promise(() => appendAgentLifecycleLog(agentSessionName, 'agent.start_refused_dirty_workspace', {
            issueId,
            workspacePath,
            porcelain: statusOut.trim(),
          }));
          return jsonResponse({
            error: `Workspace ${workspacePath} has uncommitted changes. Choose an action and retry start with acknowledgeDirtyWorkspace=true.`,
            code: 'WORKSPACE_DIRTY',
            workspacePath,
            porcelain: statusOut.trim(),
            diffStat: diffOut.trim(),
            actions: ['commit', 'discard', 'stash-salvage'],
          }, { status: 409 });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[start-agent] Failed to check workspace status for ${issueId}: ${message}`);
      }
    }

    // PAN-1048 review feedback 003: the route only resolves harness when the
    // dashboard launch panel explicitly chose one. Otherwise pass nothing and
    // let pan start → spawnAgent resolve from roles.work.harness (the new
    // single source of truth for per-role harness). The legacy `phase`
    // variable and the workType/harnessOverrides map are gone — the
    // legacy-field guard above (line 1872) blocks any client still sending
    // them. Note: when bodyHarness is set we still run it through
    // canUseHarness() so we can fail fast on a model+harness incompatibility
    // before spawning the subprocess.
    const bodyHarness = (body as any).harness;
    const userPickedHarness: 'claude-code' | 'ohmypi' | 'codex' | null =
      bodyHarness === 'ohmypi' || bodyHarness === 'claude-code' || bodyHarness === 'codex' ? bodyHarness : null;
    let effectiveHarness: 'claude-code' | 'ohmypi' | 'codex' | null = null;
    if (userPickedHarness !== null) {
      const harnessDecision = yield* Effect.promise(async () =>
        canUseHarnessSync(userPickedHarness, spawnModel, await getProviderAuthMode(spawnModel))
      );
      effectiveHarness = harnessDecision.allowed ? userPickedHarness : 'claude-code';
    }

    // Spawn pan start command
    const spawnPanCommand = async (args: string[], cwd?: string): Promise<string> => spawnPanCommandDetached({
      agentSessionName,
      issueId,
      role,
      workspacePath,
      args,
      cwd,
    });

    // Use IssueLifecycle service to transition issue to "In Progress" (PAN-449)
    const updateIssueStatus = async () => {
      await Effect.runPromise(
        lifecycle.transitionTo(issueId, 'in_progress').pipe(Effect.catch(() => Effect.void))
      );
    };

    if (existsSync(workspacePath) && existsSync(devScript)) {
      let dockerRunning = false;
      try {
        yield* Effect.promise(() => execAsync('docker info >/dev/null 2>&1', { encoding: 'utf-8' }));
        dockerRunning = true;
      } catch {}

      if (dockerRunning) {
        const getComposeProjectName = async (id: string, wPath: string): Promise<string> => {
          const featureFolder = `feature-${id.toLowerCase()}`;
          const expected = `overdeck-${featureFolder}`;
          const validate = (value: string, devPath: string): string => {
            if (value !== expected) {
              throw new Error(`Invalid COMPOSE_PROJECT_NAME in ${devPath}: expected ${expected}`);
            }
            return value;
          };

          const devScriptPaths = [join(wPath, '.devcontainer', 'dev'), join(wPath, 'dev')];
          for (const devPath of devScriptPaths) {
            try {
              if (existsSync(devPath)) {
                const content = await readFile(devPath, 'utf-8');
                const match = content.match(/COMPOSE_PROJECT_NAME="([^$"]*)\$\{FEATURE_FOLDER\}"/);
                if (match) return validate(`${match[1]}${featureFolder}`, devPath);
                const literalMatch = content.match(/COMPOSE_PROJECT_NAME="([^"]+)"/);
                if (literalMatch) return validate(literalMatch[1], devPath);
              }
            } catch (error) {
              if (error instanceof Error && error.message.startsWith('Invalid COMPOSE_PROJECT_NAME')) throw error;
            }
          }
          return expected;
        };

        let featureName: string;
        try {
          featureName = yield* Effect.promise(() => getComposeProjectName(issueId, workspacePath));
        } catch (error) {
          return jsonResponse({
            success: false,
            blocked: true,
            skipped: true,
            error: error instanceof Error ? error.message : String(error),
          }, { status: 422 });
        }
        yield* Effect.promise(() => appendAgentLifecycleLog(agentSessionName, 'agent.start_container_check', {
          issueId,
          featureName,
          workspacePath,
        }));
        let containersReady = false;

        try {
          const { stdout: existing } = yield* Effect.promise(() => execFileAsync(
            'docker',
            ['ps', '--filter', `name=${featureName}`, '--format', '{{.Names}}|{{.Status}}'],
            { encoding: 'utf-8' }
          ));
          const runningContainers = existing.trim().split('\n').filter(Boolean);
          const allHealthy = runningContainers.length > 0 && runningContainers.every(line => {
            const status = line.split('|')[1] || '';
            return status.includes('Up') && (!status.includes('(') || status.includes('(healthy)'));
          });
          if (allHealthy) containersReady = true;
        } catch {}

        yield* Effect.promise(() => appendAgentLifecycleLog(agentSessionName, 'agent.start_container_check_result', {
          issueId,
          featureName,
          containersReady,
        }));

        if (!containersReady && !allowHost) {
          const earlyAgentId = agentSessionName;
          const earlyStateDir = join(homedir(), '.overdeck', 'agents', earlyAgentId);
          yield* Effect.promise(() => mkdir(earlyStateDir, { recursive: true }));
          // PAN-1048 R2: legacy `runtime` field removed; PAN-1055: persist user-picked harness.
          saveAgentStateSync({
            id: earlyAgentId,
            issueId,
            ...(effectiveHarness ? { harness: effectiveHarness } : {}),
            model: 'pending-container-start',
            status: 'starting',
            startedAt: new Date().toISOString(),
            workspace: workspacePath,
            role,
            hostOverride: allowHost || undefined,
          });
          updateRegistryForAgentStart(issueId, workspacePath, earlyAgentId);
          yield* Effect.promise(() => appendAgentLifecycleLog(earlyAgentId, 'agent.start_waiting_for_containers', {
            issueId,
            featureName,
            workspacePath,
            role,
          }));

              const containerActivityId = `containers-${Date.now()}`;

              // Start containers in background and spawn agent when ready
              (async () => {
                try {
                  const containerUid = process.getuid?.() ?? 1000;
                  const containerGid = process.getgid?.() ?? 1000;
                  await appendAgentLifecycleLog(earlyAgentId, 'agent.container_start_spawned', {
                    issueId,
                    featureName,
                    workspacePath,
                  });
                  const containerChild = spawn('./dev', ['all'], {
                    cwd: workspacePath,
                    stdio: 'ignore',
                    env: buildChildEnvWithoutTmuxSync(process.env, { UID: String(containerUid), GID: String(containerGid), DOCKER_USER: `${containerUid}:${containerGid}` }),
                    detached: true,
                  });
                  containerChild.unref();

                  const maxWaitMs = 3 * 60 * 1000;
                  const pollIntervalMs = 3000;
                  const startTime = Date.now();
                  let healthy = false;

                  while (Date.now() - startTime < maxWaitMs) {
                    try {
                      const { stdout } = await execFileAsync(
                        'docker',
                        ['ps', '--filter', `name=${featureName}`, '--format', '{{.Names}}|{{.Status}}'],
                        { encoding: 'utf-8' }
                      );
                      const containers = stdout.trim().split('\n').filter(Boolean);
                      const allH = containers.length > 0 && containers.every(line => {
                        const status = line.split('|')[1] || '';
                        return status.includes('Up') && (!status.includes('(') || status.includes('(healthy)'));
                      });
                      if (allH) { healthy = true; break; }
                    } catch {}
                    await new Promise(r => setTimeout(r, pollIntervalMs));
                  }

                  await appendAgentLifecycleLog(earlyAgentId, healthy ? 'agent.container_wait_succeeded' : 'agent.container_wait_timed_out', {
                    issueId,
                    featureName,
                    waitedMs: Date.now() - startTime,
                  });

                  if (!healthy) {
                    // PAN-1048 R2: legacy `runtime` removed; PAN-1055: persist user-picked harness.
                    saveAgentStateSync({
                      id: earlyAgentId,
                      issueId,
                      ...(effectiveHarness ? { harness: effectiveHarness } : {}),
                      model: 'pending-container-start',
                      status: 'error',
                      startedAt: new Date().toISOString(),
                      workspace: workspacePath,
                      role,
                    });
                    return;
                  }

                  // Docker named volumes may create root-owned empty node_modules.
                  // Remove them — workspace creation runs bun install which creates
                  // correct workspace-aware node_modules with proper local package resolution.
                  for (const nmDir of [join(workspacePath, 'node_modules'), join(workspacePath, 'src', 'dashboard', 'frontend', 'node_modules')]) {
                    try {
                      if (existsSync(nmDir)) {
                        const stat = await lstat(nmDir);
                        if (!stat.isSymbolicLink()) {
                          await rm(nmDir, { recursive: true, force: true });
                          console.log(`[start-agent] Removed Docker-created ${nmDir}`);
                        }
                      }
                    } catch (nmErr: any) {
                      console.warn(`[start-agent] Could not remove ${nmDir}: ${nmErr.message}`);
                    }
                  }

                  await appendAgentLifecycleLog(earlyAgentId, 'agent.work_spawn_requested_after_containers', {
                    issueId,
                    role,
                    workspacePath,
                    harness: effectiveHarness,
                  });
                  emitStartAgentPhase(issueId, 'spawn', 'start', 'starting local work agent after containers became healthy', { workspacePath });
                  const activityId = await spawnPanCommand(
                    buildPanStartArgs({
                      issueId,
                      model: spawnModel,
                      harness: effectiveHarness,
                      allowHost,
                    }),
                    workspacePath,
                  );
                  emitStartAgentPhase(issueId, 'spawn', 'success', 'local work agent spawn requested after container startup', {
                    workspacePath,
                    activityId,
                  });
                  await updateIssueStatus();
                } catch (err: any) {
                  const errorMessage = err instanceof Error ? err.message : String(err);
                  emitStartAgentPhase(issueId, 'spawn', 'failure', errorMessage, { workspacePath });
                  await appendAgentLifecycleLog(earlyAgentId, 'agent.container_start_failed', {
                    issueId,
                    error: errorMessage,
                  }).catch(() => undefined);
                  // PAN-1048 R2: legacy `runtime` removed from state writes.
                  try { saveAgentStateSync({
                    id: earlyAgentId,
                    issueId,
                    model: 'pending-container-start',
                    status: 'error',
                    startedAt: new Date().toISOString(),
                    workspace: workspacePath,
                    role,
                  }); } catch { /* non-fatal */ }
                  console.error(`[start-agent] Background container startup failed for ${issueId}:`, err);
                }
              })();

          yield* Effect.promise(() => Effect.runPromise(eventStore.append({
            type: 'issue.statusChanged',
            timestamp: new Date().toISOString(),
            payload: { issueId, status: 'In Progress', canonicalStatus: 'in_progress' },
          })));
          try { getIssueDataService().patchIssue(issueId, { status: 'In Progress', canonicalStatus: 'in_progress' }); } catch { /* non-fatal */ }
          invalidateAgentsCache();
          return jsonResponse({
            success: true,
            message: `Starting containers and agent for ${issueId} (this may take a few minutes)`,
            startingContainers: true,
            containerActivityId,
            agentId: earlyAgentId,
            projectPath,
            guardrails: spawnGuardrails,
          });
        }
      }
    }

    // Containers already ready or no containers needed
    yield* Effect.promise(() => appendAgentLifecycleLog(agentSessionName, 'agent.work_spawn_requested', {
      issueId,
      role,
      workspacePath,
    }));
    let activityId: string;
    try {
      emitStartAgentPhase(issueId, 'spawn', 'start', 'starting local work agent', { workspacePath });
      activityId = yield* Effect.promise(() => spawnPanCommand(
        buildPanStartArgs({
          issueId,
          model: spawnModel,
          harness: effectiveHarness,
          allowHost,
        }),
        workspacePath,
      ));
      emitStartAgentPhase(issueId, 'spawn', 'success', 'local work agent spawn requested', {
        workspacePath,
        activityId,
      });
    } catch (error: any) {
      const output = String(error?.output ?? error?.message ?? '');
      if (output.includes(`Workspace docker stack for ${issueId}`) && output.includes('is not healthy')) {
        const failedStackHealth = yield* getWorkspaceStackHealth(issueId, { projectConfig, workspacePath });
        emitStartAgentPhase(issueId, 'stackHealthGate', 'failure', failedStackHealth.reasons.length > 0 ? failedStackHealth.reasons.join('; ') : output.trim(), {
          workspacePath,
          activityId: error?.activityId,
        });
        emitStartAgentPhase(issueId, 'spawn', 'failure', output.trim() || `Failed to start agent for ${issueId}`, {
          workspacePath,
          activityId: error?.activityId,
        });
        emitActivityEntrySync({
          source: 'dashboard',
          level: 'error',
          issueId: issueId.toUpperCase(),
          message: `agent-spawn-blocked-stack-unhealthy: ${issueId.toUpperCase()}`,
          details: failedStackHealth.reasons.length > 0 ? failedStackHealth.reasons.join('; ') : output.trim(),
        });
        return jsonResponse({
          success: false,
          blocked: true,
          skipped: true,
          error: failedStackHealth.reasons.length > 0
            ? `Workspace docker stack for ${issueId} is not healthy: ${failedStackHealth.reasons.join('; ')}`
            : output.trim(),
          hint: `Run 'pan workspace rebuild ${issueId}' or use the CLI break-glass path: pan start ${issueId} --host.`,
          stackHealth: failedStackHealth,
          activityId: error?.activityId,
        }, { status: 422 });
      }
      emitStartAgentPhase(issueId, 'spawn', 'failure', output.trim() || `Failed to start agent for ${issueId}`, {
        workspacePath,
        activityId: error?.activityId,
      });
      return jsonResponse({
        success: false,
        blocked: true,
        skipped: true,
        error: output.trim() || `Failed to start agent for ${issueId}`,
        activityId: error?.activityId,
      }, { status: 500 });
    }

    // Write early state.json so the dashboard immediately shows agent-<id> as the
    // active agent. Without this there's a race window between spawnPanCommand returning
    // and pan start calling saveAgentState(), during which the workspace detail
    // panel shows the stale planning-<id> session and "No saved output available."
    const earlyAgentId = agentSessionName; // e.g. "agent-pan-488"
    const earlyStateDir = join(homedir(), '.overdeck', 'agents', earlyAgentId);
    yield* Effect.promise(() => mkdir(earlyStateDir, { recursive: true }));
    // PAN-1048 R2: legacy `runtime` removed; PAN-1055: persist user-picked harness.
    saveAgentStateSync({
      id: earlyAgentId,
      issueId,
      ...(effectiveHarness ? { harness: effectiveHarness } : {}),
      model: 'pending-work-spawn',
      status: 'starting',
      startedAt: new Date().toISOString(),
      workspace: workspacePath,
      role,
      hostOverride: allowHost || undefined,
    });
    updateRegistryForAgentStart(issueId, workspacePath, earlyAgentId);
    yield* Effect.promise(() => appendAgentLifecycleLog(earlyAgentId, 'agent.start_placeholder_created', {
      issueId,
      role,
      workspacePath,
      activityId,
    }));

    yield* Effect.promise(() => updateIssueStatus());

    // PAN-1048: lifecycle.transitionTo() inside updateIssueStatus() is the
    // single source of issue.transitioned. The duplicate issue.statusChanged
    // emit raced with reactive Cloister: the early state.json above (with
    // role: 'work', status: 'starting') is already on disk, so any code path
    // that wants to know about the in-flight spawn can read it. Removing the
    // redundant emit collapses two-source-of-truth into one.
    //
    // PAN-1048 review feedback 003: emit a contract-compliant agent.started
    // payload (agentId = session name, agent = AgentSnapshot) so the read-model
    // reducer writes a real snapshot into agentsById instead of `undefined`.
    // Mirrors the early state.json shape we just wrote at line 2693.
    //
    // PAN-1908: write-through projection — agents-row upsert + lifecycle event
    // append in one SQLite transaction.
    yield* saveAgentStateAndEmitEventProgram({
      id: earlyAgentId,
      issueId,
      workspace: workspacePath,
      role,
      ...(effectiveHarness ? { harness: effectiveHarness } : {}),
      model: 'pending-work-spawn',
      status: 'starting',
      startedAt: new Date().toISOString(),
      hostOverride: allowHost || undefined,
    }, {
      type: 'agent.started',
      timestamp: new Date().toISOString(),
      payload: {
        agentId: earlyAgentId,
        issueId,
        agent: {
          id: earlyAgentId,
          issueId,
          workspace: workspacePath,
          status: 'starting',
          startedAt: new Date().toISOString(),
          role,
          ...(effectiveHarness ? { runtime: effectiveHarness } : {}),
        },
      },
    });
    try { getIssueDataService().patchIssue(issueId, { status: 'In Progress', canonicalStatus: 'in_progress' }); } catch { /* non-fatal */ }
    invalidateAgentsCache();
    return jsonResponse({
      success: true,
      message: `Starting agent for ${issueId}`,
      activityId,
      projectPath,
      guardrails: spawnGuardrails,
    });
  })),
);

// ─── Compose all routes into a single Layer ───────────────────────────────────

// ─── Route: GET /api/agents/:id/tmux-alive ──────────────────────────────────

const getAgentTmuxAliveRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/tmux-alive',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const agentId = params['id'] ?? '';
    const alive = yield* sessionExists(agentId);
    return jsonResponse({ alive });
  }),
);

// ─── Route: POST /api/agents/restart-all ──────────────────────────────────────
//
// Restart all running workspace agents using restartAgent() directly.
// Quick mode (no graceful delay) to avoid serializing 30s waits across N agents.

const postAgentsRestartAllRoute = HttpRouter.add(
  'POST',
  '/api/agents/restart-all',
  Effect.gen(function* () {
    return yield* Effect.promise(async () => {
      try {
        const running = (await Effect.runPromise(listRunningAgents())).filter(a => a.tmuxActive);
        const results: { id: string; issueId: string; model: string; status: string }[] = [];

        for (const agent of running) {
          try {
            const result = await restartAgent(agent.id, { graceful: false });
            if (result.success) {
              results.push({ id: agent.id, issueId: agent.issueId, model: agent.model, status: 'restarted' });
            } else {
              results.push({ id: agent.id, issueId: agent.issueId, model: agent.model, status: `failed: ${result.error}` });
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[agents] Failed to restart ${agent.id}:`, msg);
            results.push({ id: agent.id, issueId: agent.issueId, model: agent.model, status: `failed: ${msg}` });
          }
        }

        const succeeded = results.filter(r => r.status === 'restarted').length;
        console.log(`[agents] Restarted ${succeeded}/${running.length} workspace agents`);
        return jsonResponse({ restarted: succeeded, total: running.length, results });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return jsonResponse({ error: 'Failed to restart agents: ' + msg }, { status: 500 });
      }
    });
  }),
);

// ─── Route: GET /api/agents/:id/has-session ─────────────────────────────────
// Returns whether a stopped agent has a resumable Claude session.

const getAgentHasSessionRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/has-session',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const lifecycle = yield* getWorkAgentLifecycleState(id);
    return jsonResponse({
      hasSession: lifecycle.canResumeSession,
      lifecycle,
    });
  })),
);

// ─── Route: POST /api/agents/:id/reset-session ─────────────────────────────
// Clears saved Claude session tracking so the next start creates a fresh session.
// Workspace, beads, and git state are preserved. JSONL files kept for cost history.

const postAgentResetSessionRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/reset-session',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const eventStore = yield* EventStoreService;

    const lifecycle = yield* getWorkAgentLifecycleState(id);
    const agentState = yield* getAgentState(id);
    if (!agentState) {
      return jsonResponse({ error: `Agent ${id} not found`, lifecycle }, { status: 404 });
    }

    if (lifecycle.hasLiveTmuxSession) {
      return jsonResponse({ error: `Agent ${id} is running. Stop it first.`, lifecycle }, { status: 409 });
    }

    const previousSessionId = yield* getLatestSessionId(id);
    if (!previousSessionId) {
      return jsonResponse({ error: `Agent ${id} has no saved session to reset`, lifecycle }, { status: 404 });
    }

    const agentDir = getAgentDir(id);

    // Clear session.id
    yield* Effect.promise(() => rm(join(agentDir, 'session.id'), { force: true }));

    // Clear sessions.json
    yield* Effect.promise(() => rm(join(agentDir, 'sessions.json'), { force: true }));

    // Clear claudeSessionId from runtime.json (preserve other fields).
    // Must read/write directly — saveAgentRuntimeState merges with existing file.
    const runtimeFile = join(agentDir, 'runtime.json');
    if (existsSync(runtimeFile)) {
      try {
        const runtimeContent = yield* Effect.promise(() => readFile(runtimeFile, 'utf-8'));
        const runtime = JSON.parse(runtimeContent);
        delete runtime.claudeSessionId;
        yield* Effect.promise(() => writeFile(runtimeFile, JSON.stringify(runtime, null, 2)));
      } catch { /* non-fatal */ }
    }

    yield* killSession(id).pipe(Effect.catch(() => Effect.void));

    // Emit event so dashboard updates. PAN-1048 review feedback 004 (C1):
    // include issueId — without it AgentStoppedEvent fails Schema validation.
    //
    // PAN-1908: write-through projection — agents-row upsert + lifecycle event
    // append in one SQLite transaction.
    yield* saveAgentStateAndEmitEventProgram(agentState, {
      type: 'agent.stopped',
      timestamp: new Date().toISOString(),
      payload: { agentId: id, issueId: agentState.issueId },
    });

    console.log(`[reset-session] Cleared session for ${id} (was: ${previousSessionId.slice(0, 8)}...)`);
    invalidateAgentsCache();
    return jsonResponse({ success: true, agentId: id, previousSessionId, lifecycle: yield* getWorkAgentLifecycleState(id) });
  })),
);

// ─── Route: POST /api/agents/:id/delivery-method ─────────────────────────────
// Updates the agent's delivery method (auto | channels | tmux) in state.json.

export function validateAgentDeliveryMethodOrigin(
  request: HttpServerRequest.HttpServerRequest,
): { ok: true } | { ok: false; status: 403; body: { error: 'forbidden' } } {
  const originCheck = validateOrigin(request);
  if (originCheck.ok) return { ok: true };
  return { ok: false, status: 403, body: { error: 'forbidden' } };
}

const postAgentDeliveryMethodRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/delivery-method',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originDecision = validateAgentDeliveryMethodOrigin(request);
    if (!originDecision.ok) {
      return jsonResponse(originDecision.body, { status: originDecision.status });
    }

    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;
    const { deliveryMethod } = body as { deliveryMethod?: 'auto' | 'channels' | 'tmux' };

    if (!deliveryMethod || !['auto', 'channels', 'tmux'].includes(deliveryMethod)) {
      return jsonResponse({ error: 'deliveryMethod must be auto, channels, or tmux' }, { status: 400 });
    }

    const agentState = yield* getAgentState(id);
    if (!agentState) {
      return jsonResponse({ error: `Agent ${id} not found` }, { status: 404 });
    }

    yield* Effect.promise(() => setAgentDeliveryMethod(id, deliveryMethod));
    return jsonResponse({ success: true, agentId: id, deliveryMethod });
  })),
);

// ─── Route: POST /api/agents/:id/switch-model ────────────────────────────────
// Pipeline agent models are fixed at spawn. Changing a model tears down the
// live session and discards context, so this route is retained only as a
// server-side compatibility rejection for older clients.

const postAgentSwitchModelRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/switch-model',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    return jsonResponse({
      error: `Agent ${id} model is locked once the agent is spawned`,
    }, { status: 409 });
  })),
);

export const agentsRouteLayer = Layer.mergeAll(
  getAgentsRoute,
  getAgentOutputRoute,
  getAgentConversationRoute,
  postAgentMessageRoute,
  postAgentTellRoute,
  deleteAgentRoute,
  postAgentStopRoute,
  getAgentHealthHistoryRoute,
  postAgentPokeRoute,
  getAgentPendingQuestionsRoute,
  postAgentAnswerQuestionRoute,
  postAgentHeartbeatRoute,
  postAgentWorkCompleteRoute,
  postAgentStuckRoute,
  postAgentClassifyCompletionRoute,
  postInternalAgentPermissionRequestRoute,
  postAgentPermissionResponseRoute,
  getAgentRuntimeRoute,
  getAgentGitInfoRoute,
  getAgentActivityRoute,
  getAgentFilesRoute,
  getAgentTimelineRoute,
  postAgentSuspendRoute,
  postAgentPauseRoute,
  postAgentUnpauseRoute,
  postAgentUntroubledRoute,
  postAgentResumeRoute,
  postAgentRecoverRoute,
  postAgentRestartRoute,
  getAgentCloisterHealthRoute,
  getAgentHandoffSuggestionRoute,
  postAgentHandoffRoute,
  getAgentCostRoute,
  postAgentsRoute,
  postAgentsRestartAllRoute,
  getAgentTmuxAliveRoute,
  getAgentHasSessionRoute,
  postAgentResetSessionRoute,
  postAgentSwitchModelRoute,
  postAgentRestartFreshRoute,
  postAgentDeliveryMethodRoute,
);

export default agentsRouteLayer;

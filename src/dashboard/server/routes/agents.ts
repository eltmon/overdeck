import { jsonResponse } from "../http-helpers.js";
import { httpHandler } from "./http-handler.js";
import { validateOrigin } from './origin-validation.js';
import {
  buildPermissionActivityDetails,
  buildPermissionWaitingMessage,
  normalizePermissionRequestBody,
  parsePermissionResponseBehavior,
  permissionResolutionVerb,
  processPermissionResponse,
} from './agent-permissions.js';
import { encodeClaudeProjectDir } from '../../../lib/paths.js';
import { buildChildEnvWithoutTmux } from '../../../lib/child-env.js';
import { withBdMutex } from '../../../lib/bd-mutex.js';
/**
 * Agents route module — Effect HttpRouter.Layer (PAN-428 B7)
 *
 * Implements all /api/agents/* endpoints from the Express server:
 *   GET    /api/agents
 *   GET    /api/agents/:id/output
 *   POST   /api/agents/:id/message
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

import { exec, spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, open, readdir, readFile, rename, rm, stat, symlink, lstat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { Effect, Layer, Option, Schema } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { DomainEvent } from '@panctl/contracts';
import type { Role } from '@panctl/contracts';
import { bodyToEvent, decodeDomainEvent } from '../services/agent-event-utils.js';

import { getCloisterService } from '../../../lib/cloister/service.js';
import { loadCloisterConfig } from '../../../lib/cloister/config.js';
import { checkAllTriggers } from '../../../lib/cloister/triggers.js';
import { performHandoff } from '../../../lib/cloister/handoff.js';
import { getAgentHealth } from '../../../lib/cloister/health.js';
import { getRuntimeForAgent } from '../../../lib/runtimes/index.js';
import {
  getAgentState,
  getAgentStateAsync,
  getAgentRuntimeState,
  getAgentRuntimeStateAsync,
  deliverAgentPermissionDecision,
  saveAgentRuntimeState,
  saveAgentState,
  saveAgentStateAsync,
  getActivity,
  saveSessionId,
  getSessionId,
  getLatestSessionId,
  resumeAgent,
  restartAgent,
  messageAgent,
  stopAgent,
  stopAgentAsync,
  listRunningAgents,
  listRunningAgentsAsync,
  getAgentDir,
  determineModel,
  getProviderAuthMode,
  setAgentDeliveryMethod,
} from '../../../lib/agents.js';
import { checkCodexAuthStatus } from '../../../lib/codex-auth.js';
import { canUseHarness } from '../../../lib/harness-policy.js';
import { getProviderForModel } from '../../../lib/providers.js';
import { validateProviderHealth, ProviderHealthError } from '../../../lib/provider-health.js';
import { resolveProjectFromIssue } from '../../../lib/projects.js';
import { findPlan, isPlanningComplete } from '../../../lib/vbrief/io.js';
import { writeAutoStartVBrief } from '../../../lib/vbrief/auto-synthesize.js';
import { transitionVBriefOnMain, updatePlanStatus } from '../../../lib/vbrief/lifecycle-io.js';
import type { ContinueState } from '../../../lib/vbrief/continue-state.js';
import { extractPrefix } from '../../../lib/issue-id.js';
import { PAN_CONTINUE_FILENAME, PAN_DIRNAME } from '../../../lib/pan-dir/types.js';
import { getGitHubConfig } from '../services/tracker-config.js';
import { loadWorkspaceMetadata as loadWorkspaceMetadataFn } from '../../../lib/remote/workspace-metadata.js';
import { getWorkAgentLifecycleState } from '../../../lib/work-agent-lifecycle.js';
import { buildStashMessage, createNamedStash } from '../../../lib/stashes.js';
import { calculateCost, getPricing, type TokenUsage } from '../../../lib/cost.js';
import { normalizeModelName } from '../../../lib/cost-parsers/jsonl-parser.js';
import { getReviewStatus } from '../../../lib/review-status.js';
import { emitActivityEntry } from '../../../lib/activity-logger.js';
import { IssueLifecycle } from '../services/issue-lifecycle.js';
import { ReadModelService } from '../read-model.js';
import { getSystemHealthSnapshot, getResourceConfig, type HealthLeakedSpecialist, type SystemHealthSnapshot } from '../services/system-health-service.js';
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
import { parseConversationMessages } from '../services/conversation-service.js';
import type { ConversationResponse } from '@panctl/contracts';
import { EventStoreService } from '../services/domain-services.js';
import { normalizeAwaitingInputPrompt } from '../../../lib/agent-input-detection.js';
import { buildTmuxCommandString, capturePaneAsync, createSessionAsync, killSessionAsync, listSessionsAsync, sessionExistsAsync } from '../../../lib/tmux.js';

const execAsync = promisify(exec);

function constantTimeTokenEqual(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const providedBuffer = Buffer.from(provided, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

async function appendAgentLifecycleLog(agentId: string, event: string, details: Record<string, unknown> = {}): Promise<void> {
  const agentDir = join(homedir(), '.panopticon', 'agents', agentId);
  await mkdir(agentDir, { recursive: true });
  const logLine = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    ...details,
  });
  await appendFile(join(agentDir, 'lifecycle.log'), logLine + '\n');
}

async function readWorkspaceContinueState(workspacePath: string): Promise<ContinueState | null> {
  const continuePath = join(workspacePath, PAN_DIRNAME, PAN_CONTINUE_FILENAME);
  if (!existsSync(continuePath)) return null;
  const raw = await readFile(continuePath, 'utf-8');
  return JSON.parse(raw) as ContinueState;
}

async function writeWorkspaceContinueState(workspacePath: string, state: ContinueState): Promise<ContinueState> {
  const panDir = join(workspacePath, PAN_DIRNAME);
  const continuePath = join(panDir, PAN_CONTINUE_FILENAME);
  await mkdir(panDir, { recursive: true });
  const now = new Date().toISOString();
  const next: ContinueState = {
    ...state,
    version: '1',
    created: state.created || now,
    updated: now,
  };
  const tmpPath = `${continuePath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(next, null, 2), 'utf-8');
  await rename(tmpPath, continuePath);
  return next;
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

function getProjectPath(linearProjectId?: string, issuePrefix?: string): string {
  if (issuePrefix) {
    const issueId = `${issuePrefix}-1`;
    const resolved = resolveProjectFromIssue(issueId);
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
    const workspacesDir = join(homedir(), '.panopticon', 'workspaces');
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

        const sessions = yield* Effect.promise(() => listSessionsAsync());
        const agentLines = sessions
          .filter((session) => session.name.startsWith('agent-') || session.name.startsWith('planning-'))
          .map((session) => `${session.name}|${Math.floor(session.created.getTime() / 1000)}`);

        const agentsDir = join(homedir(), '.panopticon', 'agents');
        const remoteAgentIds: string[] = [];
        const startingAgentIds: string[] = [];
        const failedAgentIds: string[] = [];

        if (existsSync(agentsDir)) {
          const dirs = (yield* Effect.promise(() => readdir(agentsDir))).filter(d => d.startsWith('agent-') || d.startsWith('planning-'));
          for (const dir of dirs) {
            const inLocalList = agentLines.some(line => line.startsWith(dir + '|'));
            const remoteStateFile = join(agentsDir, dir, 'remote-state.json');
            if (existsSync(remoteStateFile)) {
              try {
                const state = JSON.parse(yield* Effect.promise(() => readFile(remoteStateFile, 'utf-8')));
                if (state.location === 'remote' && state.status === 'running' && !inLocalList) {
                  remoteAgentIds.push(dir);
                }
              } catch {}
            }
            if (!inLocalList && !remoteAgentIds.includes(dir)) {
              const localStateFile = join(agentsDir, dir, 'state.json');
              if (existsSync(localStateFile)) {
                try {
                  const state = JSON.parse(yield* Effect.promise(() => readFile(localStateFile, 'utf-8')));
                  if (state.status === 'starting') {
                    startingAgentIds.push(dir);
                  } else if (state.status === 'error' || state.status === 'failed') {
                    // PAN-1048 review feedback 004 (C2): contract AgentStatus
                    // is starting | running | stopped | error | unknown. Writers
                    // now persist 'error'; the legacy 'failed' literal is
                    // accepted here for backward compatibility with state.json
                    // files written by older builds.
                    failedAgentIds.push(dir);
                  }
                } catch {}
              }
            }
          }
        }

        const agents = yield* Effect.promise(() => Promise.all(
          agentLines.map(async (line) => {
            const [name, created] = line.split('|');
            const startedAt = new Date(parseInt(created) * 1000).toISOString();
            const isPlanning = name.startsWith('planning-');
            const stateFile = join(homedir(), '.panopticon', 'agents', name, 'state.json');
            const healthFile = join(homedir(), '.panopticon', 'agents', name, 'health.json');
            let state: any = { model: isPlanning ? 'opus' : 'sonnet', workspace: process.cwd() };
            let health: any = { consecutiveFailures: 0, killCount: 0 };

            if (existsSync(stateFile)) {
              try { state = { ...state, ...JSON.parse(await readFile(stateFile, 'utf-8')) }; } catch {}
            }
            if (existsSync(healthFile)) {
              try { health = { ...health, ...JSON.parse(await readFile(healthFile, 'utf-8')) }; } catch {}
            }

            const gitStatus = state.workspace ? await getGitStatusAsync(state.workspace) : null;
            const issueId = isPlanning
              ? name.replace('planning-', '').toUpperCase()
              : name.replace('agent-', '').toUpperCase();

            const runtimeState = await getAgentRuntimeStateAsync(name);

            const issueReviewStatus = getReviewStatus(issueId);
            const hasActiveSpecialist = issueReviewStatus?.reviewStatus === 'reviewing'
              || issueReviewStatus?.testStatus === 'testing'
              || issueReviewStatus?.mergeStatus === 'merging';
            const enrichment = await computeAgentEnrichment(name, startedAt, hasActiveSpecialist);

            const workspaceLocation = await getWorkspaceLocation(issueId);

            let contextPercent: number | null = null;
            let initialContextPercent: number | null = null;
            const agentCtxDir = join(homedir(), '.panopticon', 'agents', name);
            try {
              const ctxFile = join(agentCtxDir, 'context-pct');
              contextPercent = parseInt((await readFile(ctxFile, 'utf-8').catch(() => '')).trim(), 10) || null;
              const initCtxFile = join(agentCtxDir, 'initial-context-pct');
              initialContextPercent = parseInt((await readFile(initCtxFile, 'utf-8').catch(() => '')).trim(), 10) || null;
            } catch {}

            return {
              id: name,
              issueId,
              runtime: 'claude',
              model: state.model || (isPlanning ? 'opus' : 'sonnet'),
              status: 'healthy' as const,
              startedAt,
              consecutiveFailures: health.consecutiveFailures || 0,
              killCount: health.killCount || 0,
              workspace: state.workspace || null,
              workspaceLocation,
              git: gitStatus,
              type: 'agent',
              role: state.role,
              hasPendingQuestion: enrichment.hasPendingQuestion,
              pendingQuestionCount: enrichment.pendingQuestionCount,
              pendingQuestionPrompt: enrichment.pendingQuestionPrompt,
              pendingQuestionReason: enrichment.pendingQuestionReason,
              resolution: runtimeState?.resolution || enrichment.resolution || 'working',
              resolutionCount: runtimeState?.resolutionCount || enrichment.resolutionCount || 0,
              contextPercent,
              initialContextPercent,
            };
          })
        ));

        const remoteAgents = yield* Effect.promise(() => Promise.all(
          remoteAgentIds.map(async (name) => {
            const remoteStateFile = join(homedir(), '.panopticon', 'agents', name, 'remote-state.json');
            const isPlanning = name.startsWith('planning-');
            try {
              const state = JSON.parse(await readFile(remoteStateFile, 'utf-8'));
              const issueId = state.issueId?.toUpperCase() || name.replace(/^(agent-|planning-)/, '').toUpperCase();
              const workspaceLocation = await getWorkspaceLocation(issueId);
              return {
                id: name,
                issueId,
                runtime: 'claude',
                model: state.model || (isPlanning ? 'opus' : 'sonnet'),
                status: 'healthy' as const,
                startedAt: state.startedAt || new Date().toISOString(),
                consecutiveFailures: 0,
                killCount: 0,
                workspace: `/workspace (${state.vmName})`,
                workspaceLocation: 'remote',
                vmName: state.vmName,
                git: null,
                type: 'agent',
                role: state.role ?? (isPlanning ? 'plan' : 'work'),
                hasPendingQuestion: false,
                pendingQuestionCount: 0,
                remote: true,
              };
            } catch { return null; }
          })
        ));

        const stoppedAgents: any[] = [];
        if (existsSync(agentsDir)) {
          const allDirs = (yield* Effect.promise(() => readdir(agentsDir))).filter(d => d.startsWith('agent-') || d.startsWith('planning-'));
          const alreadyListed = new Set([
            ...agentLines.map(l => l.split('|')[0]),
            ...remoteAgentIds,
          ]);
          for (const dir of allDirs) {
            if (alreadyListed.has(dir)) continue;
            const stateFile = join(agentsDir, dir, 'state.json');
            if (!existsSync(stateFile)) continue;
            try {
              const state = JSON.parse(yield* Effect.promise(() => readFile(stateFile, 'utf-8')));
              const runtimeFile = join(agentsDir, dir, 'runtime.json');
              let runtimeData: any = {};
              if (existsSync(runtimeFile)) {
                try { runtimeData = JSON.parse(yield* Effect.promise(() => readFile(runtimeFile, 'utf-8'))); } catch {}
              }
              const hasCompletedMarker = existsSync(join(agentsDir, dir, 'completed')) ||
                existsSync(join(agentsDir, dir, 'completed.processed'));
              const runtimeIdle = runtimeData.state === 'idle' || state.state === 'idle';
              const isStopped = state.status === 'stopped' || hasCompletedMarker ||
                (runtimeIdle && state.status !== 'starting');
              if (!isStopped) continue;
              const isPlanning = dir.startsWith('planning-');
              const issueId = state.issueId?.toUpperCase() ||
                (isPlanning ? dir.replace('planning-', '') : dir.replace('agent-', '')).toUpperCase();
              const lastActivity = runtimeData.lastActivity || state.lastActivity;
              const stoppedAt = lastActivity ? new Date(lastActivity) : null;
              const reviewStatus = getReviewStatus(issueId);
              const keepStoppedAgentVisible =
                !!reviewStatus &&
                reviewStatus.mergeStatus !== 'merged' &&
                (
                  !!reviewStatus.prUrl ||
                  reviewStatus.readyForMerge === true ||
                  reviewStatus.reviewStatus !== 'pending' ||
                  reviewStatus.testStatus !== 'pending' ||
                  reviewStatus.mergeStatus === 'failed'
                );
              if (stoppedAt && (now - stoppedAt.getTime()) > 60 * 60 * 1000 && !keepStoppedAgentVisible) continue;
              const lifecycle = getWorkAgentLifecycleState(dir);
              const needsInput = runtimeData.resolution === 'needs_input';
              const pendingQuestionPrompt = needsInput
                ? normalizeAwaitingInputPrompt(
                    runtimeData.waitingNotification ||
                      'Agent stopped because it needs human input or hit a blocker',
                  )
                : undefined;
              const pendingQuestionReason = needsInput
                ? runtimeData.waitingReason || 'other'
                : undefined;
              stoppedAgents.push({
                id: dir,
                issueId,
                runtime: 'claude',
                model: state.model || (isPlanning ? 'opus' : 'sonnet'),
                status: 'stopped' as const,
                startedAt: state.startedAt || new Date().toISOString(),
                consecutiveFailures: 0,
                killCount: 0,
                workspace: state.workspace || null,
                workspaceLocation: 'local',
                git: null,
                type: 'agent',
                role: state.role ?? (isPlanning ? 'plan' : 'work'),
                hasPendingQuestion: needsInput,
                pendingQuestionCount: 0,
                pendingQuestionPrompt,
                pendingQuestionReason,
                resolution: runtimeData.resolution || 'working',
                resolutionCount: runtimeData.resolutionCount || 0,
                hasSession: lifecycle.canResumeSession,
                lifecycle,
              });
            } catch {}
          }
        }

        const startingAgents = (yield* Effect.promise(() => Promise.all(startingAgentIds.map(async dir => {
          const stateFile = join(agentsDir, dir, 'state.json');
          try {
            const state = JSON.parse(await readFile(stateFile, 'utf-8'));
            const isPlanning = dir.startsWith('planning-');
            const issueId = state.issueId?.toUpperCase() ||
              (isPlanning ? dir.replace('planning-', '') : dir.replace('agent-', '')).toUpperCase();
            return {
              id: dir,
              issueId,
              runtime: 'claude',
              model: state.model || (isPlanning ? 'opus' : 'sonnet'),
              status: 'starting' as const,
              startedAt: state.startedAt || new Date().toISOString(),
              consecutiveFailures: 0,
              killCount: 0,
              workspace: state.workspace || null,
              workspaceLocation: 'local',
              git: null,
              type: 'agent',
              role: state.role ?? (isPlanning ? 'plan' : 'work'),
              hasPendingQuestion: false,
              pendingQuestionCount: 0,
              message: state.message || 'Starting...',
            };
          } catch { return null; }
        })))).filter(Boolean);

        const failedAgents = (yield* Effect.promise(() => Promise.all(failedAgentIds.map(async dir => {
          const stateFile = join(agentsDir, dir, 'state.json');
          try {
            const state = JSON.parse(await readFile(stateFile, 'utf-8'));
            const isPlanning = dir.startsWith('planning-');
            const issueId = state.issueId?.toUpperCase() ||
              (isPlanning ? dir.replace('planning-', '') : dir.replace('agent-', '')).toUpperCase();
            return {
              id: dir,
              issueId,
              runtime: 'claude',
              model: state.model || (isPlanning ? 'opus' : 'sonnet'),
              status: 'error' as const,
              startedAt: state.startedAt || new Date().toISOString(),
              consecutiveFailures: 0,
              killCount: 0,
              workspace: state.workspace || null,
              workspaceLocation: state.location || 'local',
              git: null,
              type: 'agent',
              role: state.role ?? (isPlanning ? 'plan' : 'work'),
              hasPendingQuestion: false,
              pendingQuestionCount: 0,
              error: state.error || 'Unknown error',
            };
          } catch { return null; }
        })))).filter(Boolean);

        const allAgents = [...agents, ...remoteAgents.filter(Boolean), ...startingAgents, ...failedAgents, ...stoppedAgents];
        agentsCache = { data: allAgents, timestamp: now };
        return jsonResponse(allAgents);
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
          const agentStateDir = join(homedir(), '.panopticon', 'agents', id);
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
            stdout = await capturePaneAsync(id, parseInt(String(lines), 10) || 100);
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
            const agentStateDir = join(homedir(), '.panopticon', 'agents', id);
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
 */
export async function buildConversationResponse(id: string): Promise<ConversationResponse> {
  try {
    const jsonlPath = await getAgentJsonlPathShared(id);
    if (!jsonlPath || !existsSync(jsonlPath)) {
      return EMPTY_CONVERSATION;
    }
    const result = await parseConversationMessages(jsonlPath);
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

// ─── Route: POST /api/agents/:id/message ─────────────────────────────────────

const postAgentMessageRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/message',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;

    const { message } = body as any;
    if (!message) {
      return jsonResponse({ error: 'Message required' }, { status: 400 });
    }

    const agentStateDir = join(homedir(), '.panopticon', 'agents', id);
    const remoteStateFile = join(agentStateDir, 'remote-state.json');
    let isRemote = false;
    let vmName = '';

    if (existsSync(remoteStateFile)) {
      try {
        const state = JSON.parse(yield* Effect.promise(() => readFile(remoteStateFile, 'utf-8')));
        if (state.location === 'remote' && state.vmName) {
          isRemote = true;
          vmName = state.vmName;
        }
      } catch {}
    }

    if (isRemote && vmName) {
      const { sendToRemoteAgent } = yield* Effect.promise(() => import('../../../lib/remote/remote-agents.js'));
      yield* Effect.promise(() => sendToRemoteAgent(id, vmName, message));
      return jsonResponse({ success: true, remote: true });
    } else {
      yield* Effect.promise(() => messageAgent(id, message));
      return jsonResponse({ success: true });
    }
  })),
);

// ─── Route: DELETE /api/agents/:id ───────────────────────────────────────────

const deleteAgentRoute = HttpRouter.add(
  'DELETE',
  '/api/agents/:id',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const eventStore = yield* EventStoreService;

    const stateBeforeStop = yield* Effect.promise(() => getAgentStateAsync(id));
    yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.delete_requested'));
    yield* Effect.promise(() => stopAgentAsync(id));
    // PAN-1048 review feedback 004 (C1): AgentStoppedEvent requires both
    // agentId AND issueId on the payload (packages/contracts/src/events.ts:36);
    // ws-rpc drops events that fail Schema validation, so emits without issueId
    // never reach subscribers and the dashboard misses the stop transition.
    yield* Effect.promise(() => Effect.runPromise(eventStore.append({
      type: 'agent.stopped',
      timestamp: new Date().toISOString(),
      payload: { agentId: id, issueId: stateBeforeStop?.issueId ?? '' },
    })));
    const issueId = stateBeforeStop?.issueId;
    // PAN-1048: derive label from role; legacy state.phase no longer exists.
    const phaseLabel = stateBeforeStop?.role === 'plan' ? 'planning' : 'work';
    emitActivityEntry({
      source: 'dashboard',
      level: 'info',
      message: issueId
        ? `User stopped ${issueId} ${phaseLabel} agent`
        : `User stopped agent ${id}`,
      issueId,
    });
    invalidateAgentsCache();
    return jsonResponse({ success: true });
  })),
);

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

    const { getHealthHistory } = yield* Effect.promise(() => import('../../../lib/database/health-events-db.js'));
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

    const questions = yield* Effect.promise(() => getAgentPendingQuestions(id));
    return jsonResponse({ pending: questions.length > 0, questions });
  })),
);

// ─── Route: POST /api/agents/:id/answer-question ─────────────────────────────

const postAgentAnswerQuestionRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/answer-question',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;

    const { answers } = body as any;
    if (!answers || !Array.isArray(answers) || answers.length === 0) {
      return jsonResponse({ error: 'answers array required' }, { status: 400 });
    }

    const pendingQuestions = yield* Effect.promise(() => getAgentPendingQuestions(id));
    if (pendingQuestions.length === 0) {
      return jsonResponse({ error: 'No pending questions found' }, { status: 400 });
    }

    const questionSet = pendingQuestions[0];
    const questions = questionSet.questions;
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    for (let i = 0; i < answers.length && i < questions.length; i++) {
      const answer = answers[i];
      const question = questions[i];
      const optionIndex = question.options.findIndex(
        (opt: { label: string }) => opt.label === answer
      );

      if (optionIndex === -1) {
        yield* Effect.promise(() => execAsync(buildTmuxCommandString(['send-keys', '-t', id, '4'])));
        yield* Effect.promise(() => execAsync(buildTmuxCommandString(['send-keys', '-t', id, answer])));
        yield* Effect.promise(() => execAsync(buildTmuxCommandString(['send-keys', '-t', id, 'C-m'])));
      } else {
        const keyNumber = optionIndex + 1;
        yield* Effect.promise(() => execAsync(buildTmuxCommandString(['send-keys', '-t', id, String(keyNumber)])));
      }

      yield* Effect.promise(() => execAsync(buildTmuxCommandString(['send-keys', '-t', id, 'Tab'])));
      yield* Effect.promise(() => delay(100));
    }

    yield* Effect.promise(() => execAsync(buildTmuxCommandString(['send-keys', '-t', id, 'C-m'])));
    return jsonResponse({ success: true });
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

const postAgentHeartbeatRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/heartbeat',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!id.trim()) {
      return jsonResponse({ success: false, error: 'missing agent id' }, { status: 400 });
    }
    const body = (yield* readJsonBody) as Record<string, unknown>;
    const timestamp = (body['timestamp'] as string) ?? new Date().toISOString();

    let raw: Record<string, unknown> | null;
    try {
      raw = bodyToEvent(id, body, timestamp);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'invalid heartbeat payload';
      return jsonResponse({ success: false, error: message }, { status: 400 });
    }
    if (!raw) {
      // Legacy 'uninitialized' or unknown kind — accept but no-op so hooks
      // don't retry forever.
      return jsonResponse({ success: true, emitted: false });
    }

    // Placeholder sequence — appendAsync assigns the real server-side number.
    const candidate = { ...raw, sequence: 0 };
    const decoded = decodeDomainEvent(candidate);
    if (decoded._tag === 'Failure') {
      return jsonResponse(
        { success: false, error: 'invalid event', detail: String(decoded.failure) },
        { status: 400 },
      );
    }

    const { AgentStateService } = yield* Effect.promise(
      () => import('../services/agent-state-service.js'),
    );
    const agentState = yield* AgentStateService;
    yield* agentState.emit(decoded.success as never);

    return jsonResponse({ success: true, emitted: true });
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
    const { INTERNAL_TOKEN_HEADER, getInternalToken } = yield* Effect.promise(() =>
      import('../../../lib/internal-token.js'),
    );
    const expected = getInternalToken();
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

    const agentState = yield* Effect.promise(() => getAgentStateAsync(id));
    if (!agentState) {
      return jsonResponse({ ok: false, error: `agent ${id} not found` }, { status: 404 });
    }
    const runtimeState = yield* Effect.promise(() => getAgentRuntimeStateAsync(id));
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

    emitActivityEntry({
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
          emitActivityEntry({
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

    const agentState = yield* Effect.promise(() => getAgentStateAsync(id));
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
    const agentState = yield* Effect.promise(() => getAgentStateAsync(id));
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
    const suspendIssueId = (yield* Effect.promise(() => getAgentStateAsync(id)))?.issueId ?? '';
    yield* Effect.promise(() => killSessionAsync(id).catch(() => { /* no tmux session to kill */ }));
    saveAgentRuntimeState(id, {
      state: 'suspended',
      suspendedAt: new Date().toISOString(),
      sessionId: effectiveSessionId,
    });
    yield* Effect.promise(() => Effect.runPromise(eventStore.append({
      type: 'agent.stopped',
      timestamp: new Date().toISOString(),
      payload: { agentId: id, issueId: suspendIssueId },
    })));

    invalidateAgentsCache();
    return jsonResponse({ success: true });
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

    const { message, model } = body as any;
    const eventStore = yield* EventStoreService;
    // Snapshot lifecycle state BEFORE taking any action so callers can see the
    // temporal context (why was this resume allowed) without recomputing state.
    const lifecycleBefore = getWorkAgentLifecycleState(id);
    if (!lifecycleBefore.canResumeSession && !lifecycleBefore.isRunningButStuck) {
      return jsonResponse({
        error: lifecycleBefore.reason || `Cannot resume agent ${lifecycleBefore.agentId}`,
        lifecycle: lifecycleBefore,
      }, { status: 409 });
    }

    yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.resume_requested', {
      hasMessage: !!message,
      model: model || undefined,
      lifecycle: lifecycleBefore,
    }));
    const result = yield* Effect.promise(() => resumeAgent(id, message, model ? { model } : undefined));
    if (result.success) {
      // Emit agent.started event so the read model transitions agent status
      // from 'stopped' → 'running' and the frontend updates immediately.
      const agentState = yield* Effect.promise(() => getAgentStateAsync(id));
      yield* Effect.promise(() => Effect.runPromise(eventStore.append({
        type: 'agent.started',
        timestamp: new Date().toISOString(),
        payload: {
          agentId: id,
          issueId: agentState?.issueId || id.replace('agent-', '').toUpperCase(),
          resumed: true,
          agent: {
            id,
            issueId: agentState?.issueId || id.replace('agent-', '').toUpperCase(),
            workspace: agentState?.workspace,
            model: agentState?.model,
            status: 'running',
            startedAt: agentState?.startedAt,
            lastActivity: new Date().toISOString(),
            role: agentState?.role ?? 'work',
          },
        },
      })));
      yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.resume_succeeded', {
        hasMessage: !!message,
      }));
      invalidateAgentsCache();
      // Return both the pre-action and post-action lifecycle so consumers can
      // see why the resume was allowed (before) and the new running state (after)
      // without confusion about "canResumeSession:false" in the same payload.
      return jsonResponse({
        success: true,
        resumed: true,
        lifecycle: { before: lifecycleBefore, after: getWorkAgentLifecycleState(id) },
      });
    } else {
      yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.resume_failed', {
        hasMessage: !!message,
        error: result.error,
      }));
      return jsonResponse({
        error: result.error,
        lifecycle: { before: lifecycleBefore, after: getWorkAgentLifecycleState(id) },
      }, { status: 400 });
    }
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
      harness?: 'claude-code' | 'pi';
      graceful?: boolean;
      message?: string;
    };

    const agentState = yield* Effect.promise(() => getAgentStateAsync(id));
    if (!agentState) {
      return jsonResponse({ error: `Agent ${id} not found` }, { status: 404 });
    }

    yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.restart_requested', {
      model: model || agentState.model,
      graceful,
      hasMessage: !!message,
    }));

    if (graceful) {
      // Kick off async restart — don't block the HTTP response for 30s
      (async () => {
        try {
          await Effect.runPromise(eventStore.append({
            type: 'agent.stopped',
            timestamp: new Date().toISOString(),
            payload: { agentId: id, issueId: agentState.issueId },
          }));

          const result = await restartAgent(id, { model, harness, graceful: true, message });

          if (result.success) {
            const updatedState = getAgentState(id);
            await Effect.runPromise(eventStore.append({
              type: 'agent.started',
              timestamp: new Date().toISOString(),
              payload: {
                agentId: id,
                issueId: updatedState?.issueId || agentState.issueId,
                restarted: true,
                agent: {
                  id,
                  issueId: updatedState?.issueId || agentState.issueId,
                  workspace: updatedState?.workspace || agentState.workspace,
                  // PAN-1048 review feedback 004 (C3): same as quick-restart
                  // below — surface the actual harness so Pi agents do not
                  // get mis-labelled as Claude Code on graceful restart.
                  runtime: updatedState?.harness ?? agentState.harness ?? 'claude-code',
                  model: model || updatedState?.model || agentState.model,
                  status: 'running',
                  startedAt: updatedState?.startedAt || agentState.startedAt,
                  lastActivity: new Date().toISOString(),
                  role: updatedState?.role ?? agentState.role,
                },
              },
            }));
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
    const result = yield* Effect.promise(() => restartAgent(id, { model, graceful: false, message }));

    if (result.success) {
      const updatedState = yield* Effect.promise(() => getAgentStateAsync(id));
      yield* Effect.promise(() => Effect.runPromise(eventStore.append({
        type: 'agent.stopped',
        timestamp: new Date().toISOString(),
        payload: { agentId: id, issueId: updatedState?.issueId || agentState.issueId },
      })));
      yield* Effect.promise(() => Effect.runPromise(eventStore.append({
        type: 'agent.started',
        timestamp: new Date().toISOString(),
        payload: {
          agentId: id,
          issueId: updatedState?.issueId || agentState.issueId,
          restarted: true,
          agent: {
            id,
            issueId: updatedState?.issueId || agentState.issueId,
            workspace: updatedState?.workspace || agentState.workspace,
            // PAN-1048 review feedback 004 (C3): preserve the agent's actual
            // harness instead of hard-coding 'claude'. AgentSnapshot.runtime
            // is what getHarness() reads, so a Pi agent restarted through
            // this path was being mis-labelled as Claude Code.
            runtime: updatedState?.harness ?? agentState.harness ?? 'claude-code',
            model: model || updatedState?.model || agentState.model,
            status: 'running',
            startedAt: updatedState?.startedAt || agentState.startedAt,
            lastActivity: new Date().toISOString(),
            role: updatedState?.role ?? agentState.role,
          },
        },
      })));
      invalidateAgentsCache();
      return jsonResponse({ success: true, restarted: true, agentId: id, model: model || agentState.model });
    }

    return jsonResponse({ error: result.error }, { status: 500 });
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

    const agentState = yield* Effect.promise(() => getAgentStateAsync(id));
    if (!agentState) {
      return jsonResponse({ error: 'Agent not found' }, { status: 404 });
    }

    const runtime = getRuntimeForAgent(id);
    if (!runtime) {
      return jsonResponse({ error: 'Runtime not found for agent' }, { status: 404 });
    }

    const health = getAgentHealth(id, runtime);
    const triggers = yield* Effect.promise(() => checkAllTriggers(
      id,
      agentState.workspace,
      agentState.issueId,
      agentState.model,
      health,
      loadCloisterConfig()
    ));

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
    if (!toModel) {
      return jsonResponse({ error: 'toModel is required' }, { status: 400 });
    }

    const result = yield* Effect.promise(() => performHandoff(id, {
      targetModel: toModel,
      reason: reason || 'Manual handoff from dashboard',
    }));

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

    const agentState = yield* Effect.promise(() => getAgentStateAsync(id));
    if (!agentState) {
      return jsonResponse({ error: 'Agent not found' }, { status: 404 });
    }

    let cost = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let detectedModel = agentState.model || '';

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
            if (usage) {
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
      const pricing = getPricing(modelInfo.provider, modelInfo.model);
      if (pricing) {
        const usage: TokenUsage = {
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
        };
        cost = calculateCost(usage, pricing);
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
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;
    const lifecycle = yield* IssueLifecycle;
    const readModel = yield* ReadModelService;

    const { issueId, projectId } = body as any;
    const autoStart = (body as any).auto === true;
    const guardrailAcknowledged = (body as any).guardrailAcknowledged === true;

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

    const issueLower = issueId.toLowerCase();
    const agentSessionName = `agent-${issueLower}`;

    const workspaceMetadata = loadWorkspaceMetadataFn(issueId);
    const isRemote = workspaceMetadata?.location === 'remote';

    const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(projectId, issuePrefix);

    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
    if (!existsSync(workspacePath)) {
      try {
        const nodeDir = dirname(process.execPath);
        yield* Effect.promise(() => execAsync(
          `pan workspace create ${issueId} --local`,
          { cwd: projectPath, encoding: 'utf-8', timeout: 60000, env: buildChildEnvWithoutTmux(process.env, { PATH: `${nodeDir}:${process.env.PATH ?? ''}` }) }
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
          yield* Effect.promise(() => execAsync(`cp -r "${projectRootBeadsDir}" "${workspaceBeadsDir}"`, { encoding: 'utf-8' }));
        } catch {}
      }
    }

    let planPath = findPlan(workspacePath);
    if (autoStart && !planPath) {
      const issueTitle = cachedIssue?.title || issueId;
      const issueBody = cachedIssue?.description || '';
      yield* Effect.promise(() => writeAutoStartVBrief(projectPath, workspacePath, {
        issueId,
        title: issueTitle,
        body: issueBody,
        url: cachedIssue?.url,
      }));
      planPath = findPlan(workspacePath);
    }
    const hasPlan = planPath !== null;
    // Planning has finished when plan.status is any of:
    // proposed/approved/pending/running/completed/blocked.
    const isComplete = isPlanningComplete(workspacePath);

    // vBRIEF no longer blocks agent start — agents can begin without a plan.
    void hasPlan;
    void isComplete;

    try {
      const { readPlan } = yield* Effect.promise(() => import('../../../lib/vbrief/io.js'));
      if (!planPath) {
        throw new Error('No workspace vBRIEF found');
      }
      const planDoc = readPlan(planPath);
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
      const itemCount = planDoc?.plan?.items?.length ?? 0;
      if (itemCount === 0) {
        return jsonResponse({
          error: 'Plan exists but contains no items. Planning may have failed or produced an empty plan.',
          hint: 'Re-run planning to produce a plan with tasks and acceptance criteria.',
          issueId,
        }, { status: 422 });
      }
    } catch {}

    let hasBeads = false;
    try {
      const { stdout: bdOutput } = yield* Effect.promise(() => withBdMutex(() => execAsync(
        `bd list --json -l ${issueId.toLowerCase()} --status all --limit 1`,
        { cwd: workspacePath, encoding: 'utf-8', timeout: 10000 }
      )));
      const bdTasks = JSON.parse(bdOutput.trim() || '[]');
      hasBeads = bdTasks.length > 0;
    } catch {}

    let recoveryError: string | null = null;
    if (!hasBeads) {
      // Auto-recovery: beads DB may not have been initialized (fresh install, or planning
      // completed before bd init ran). Attempt to create beads from the vBRIEF plan now.
      console.log(`[agents] No beads for ${issueId} — attempting auto-recovery via createBeadsFromVBrief`);
      try {
        const { createBeadsFromVBrief } = yield* Effect.promise(() => import('../../../lib/vbrief/beads.js'));
        const recovery = yield* Effect.promise(() => createBeadsFromVBrief(workspacePath));
        hasBeads = recovery.created.length > 0;
        if (hasBeads) {
          console.log(`[agents] Auto-recovery created ${recovery.created.length} beads for ${issueId}`);
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
    const spawnGuardrails = evaluateSpawnGuardrails(health);
    if (spawnGuardrails.blocked) {
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
      return jsonResponse({
        success: false,
        blocked: false,
        skipped: true,
        requiresAcknowledgement: true,
        hint: spawnGuardrails.hint,
        guardrails: spawnGuardrails,
      }, { status: spawnGuardrails.status });
    }

    const spawnModel = determineModel({
      model: (body as any).model,
      role,
    });
    const providerAuthMode = yield* Effect.promise(() => getProviderAuthMode(spawnModel));
    if (providerAuthMode === 'subscription') {
      const codexAuth = yield* Effect.promise(() => checkCodexAuthStatus());
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
    try {
      yield* Effect.promise(() => validateProviderHealth(spawnModel));
    } catch (err) {
      if (err instanceof ProviderHealthError) {
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
      throw err;
    }

    if (existsSync(workspacePanContinuePath) || existsSync(workspacePanDir)) {
      // Commit workspace orchestration artifacts before handing off to the work agent.
      // The entire block is best-effort — never let git errors abort the agent start.
      yield* Effect.gen(function* () {
        const gitRoot = workspacePath;
        if (existsSync(join(gitRoot, PAN_DIRNAME))) {
          yield* Effect.promise(() => execAsync(`git add -f .pan/`, { cwd: gitRoot, encoding: 'utf-8' }));
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
    yield* Effect.promise(() =>
      transitionVBriefOnMain(
        projectPath,
        issueId,
        'active',
        'approved',
        `scope: approve ${issueId.toUpperCase()} vBRIEF`,
      )
        .then((result) => {
          if (result.moved) {
            console.log(`[start-agent] vBRIEF moved ${result.fromDir} → active for ${issueId}`);
          }
          if (result.committed) {
            console.log(`[start-agent] Committed approval transition on main for ${issueId}`);
          }
        })
        .catch((err) => {
          console.warn(`[start-agent] vBRIEF approval transition failed (non-fatal): ${err?.message ?? err}`);
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

    // Write initial continue state (PAN-946: workspace-44p)
    try {
      const { stdout: branchOut } = yield* Effect.promise(() => execAsync('git branch --show-current', { cwd: workspacePath, encoding: 'utf-8' }));
      const { stdout: shaOut } = yield* Effect.promise(() => execAsync('git rev-parse --short HEAD', { cwd: workspacePath, encoding: 'utf-8' }));
      const { stdout: dirtyOut } = yield* Effect.promise(() => execAsync('git status --porcelain', { cwd: workspacePath, encoding: 'utf-8' }));
      const branch = branchOut.trim();
      const sha = shaOut.trim();
      const dirty = dirtyOut.trim().length > 0;

      const existing = yield* Effect.promise(() => readWorkspaceContinueState(workspacePath));
      const now = new Date().toISOString();
      const next: ContinueState = existing
        ? {
            ...existing,
            issueId,
            gitState: { branch, sha, dirty },
            agentModel: spawnModel,
            sessionHistory: [...existing.sessionHistory, { timestamp: now, reason: 'start' as const, agentModel: spawnModel }],
          }
        : {
            version: '1',
            issueId,
            created: now,
            updated: now,
            gitState: { branch, sha, dirty },
            decisions: [],
            hazards: [],
            resumePoint: null,
            beadsMapping: {},
            agentModel: spawnModel,
            sessionHistory: [{ timestamp: now, reason: 'start' as const, agentModel: spawnModel }],
            feedback: [],
          };
      yield* Effect.promise(() => writeWorkspaceContinueState(workspacePath, next));
      console.log(`[start-agent] Wrote workspace continue state for ${issueId}`);
    } catch (continueErr: any) {
      console.warn(`[start-agent] Failed to write continue state (non-fatal): ${continueErr?.message ?? continueErr}`);
    }

    if (isRemote && workspaceMetadata) {
      const { spawnRemoteAgent } = yield* Effect.promise(() => import('../../../lib/remote/remote-agents.js'));
      const { createFlyProviderFromConfig } = yield* Effect.promise(() => import('../../../lib/remote/index.js'));
      const { loadConfig: loadPanConfig } = yield* Effect.promise(() => import('../../../lib/config.js'));
      const fly = createFlyProviderFromConfig(loadPanConfig().remote);
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

      const state = yield* Effect.promise(() => spawnRemoteAgent({
        issueId,
        workspace: workspaceMetadata,
        prompt: agentPrompt,
        model: spawnModel,
      }));

      // Write canonical state.json so activeRoleRunExists() sees this remote
      // work agent as active before we emit the lifecycle transition below.
      // spawnRemoteAgent only writes remote-state.json; without state.json the
      // Cloister duplicate-spawn guard misses the in-flight remote agent and
      // would spawn a second local work run when in_progress is emitted.
      yield* Effect.promise(() => saveAgentStateAsync({
        id: state.id,
        issueId: state.issueId,
        workspace: workspacePath,
        role: 'work',
        model: spawnModel,
        status: 'starting',
        startedAt: state.startedAt,
        harness: 'claude-code',
      }));

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
      yield* Effect.promise(() => Effect.runPromise(eventStore.append({
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
      })));
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

    const agentLifecycle = getWorkAgentLifecycleState(agentSessionName);
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

    // Kill any zombie tmux session from a previous crash.
    // NOTE: try/catch does NOT work with yield* in Effect.gen — Effect errors propagate
    // through the Effect error channel, not as JS exceptions. Use .catch() in the Promise
    // chain instead so the Effect never fails when the session doesn't exist.
    yield* Effect.promise(() =>
      sessionExistsAsync(agentSessionName)
        .then((exists) => exists ? killSessionAsync(agentSessionName) : undefined)
        .then(() => console.log(`[start-agent] Killed stale tmux session ${agentSessionName}`))
        .catch(() => { /* No existing session — good */ })
    );

    let preSpawnStashRef: string | null = null;
    let preSpawnStashMessage: string | null = null;
    let preSpawnBaselineHead: string | null = null;
    try {
      const { stdout: statusOut } = yield* Effect.promise(() => execAsync('git status --porcelain', {
        cwd: workspacePath,
        encoding: 'utf-8',
      }));
      if (statusOut.trim()) {
        const { stdout: headOut } = yield* Effect.promise(() => execAsync('git rev-parse HEAD', {
          cwd: workspacePath,
          encoding: 'utf-8',
        }));
        preSpawnBaselineHead = headOut.trim() || null;
        preSpawnStashMessage = buildStashMessage('pre-spawn', issueId, new Date());
        preSpawnStashRef = yield* Effect.promise(() => createNamedStash(workspacePath, preSpawnStashMessage!, true));
        if (preSpawnStashRef) {
          yield* Effect.promise(() => appendAgentLifecycleLog(agentSessionName, 'agent.pre_spawn_stash_created', {
            issueId,
            workspacePath,
            stashRef: preSpawnStashRef,
            stashMessage: preSpawnStashMessage,
            baselineHead: preSpawnBaselineHead,
          }));
        } else {
          preSpawnBaselineHead = null;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      preSpawnStashRef = null;
      preSpawnStashMessage = null;
      preSpawnBaselineHead = null;
      yield* Effect.promise(() => appendAgentLifecycleLog(agentSessionName, 'agent.pre_spawn_stash_failed', {
        issueId,
        workspacePath,
        error: message,
      }));
      console.warn(`[start-agent] Failed to create pre-spawn stash for ${issueId}: ${message}`);
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
    const userPickedHarness: 'claude-code' | 'pi' | null =
      bodyHarness === 'pi' || bodyHarness === 'claude-code' ? bodyHarness : null;
    let effectiveHarness: 'claude-code' | 'pi' | null = null;
    if (userPickedHarness !== null) {
      const harnessDecision = yield* Effect.promise(async () =>
        canUseHarness(userPickedHarness, spawnModel, await getProviderAuthMode(spawnModel))
      );
      effectiveHarness = harnessDecision.allowed ? userPickedHarness : 'claude-code';
    }

    // Spawn pan start command
    const spawnPanCommand = async (args: string[], cwd?: string): Promise<string> => {
      const activityId = `activity-${Date.now()}`;
      const agentDir = join(homedir(), '.panopticon', 'agents', agentSessionName);
      await mkdir(agentDir, { recursive: true });
      const spawnLogPath = join(agentDir, 'spawn.log');
      const spawnLogHandle = await open(spawnLogPath, 'a');
      const child = spawn('pan', args, {
        cwd: cwd || workspacePath,
        detached: true,
        stdio: ['ignore', spawnLogHandle.fd, spawnLogHandle.fd],
      });
      child.on('error', (error) => {
        void appendAgentLifecycleLog(agentSessionName, 'agent.work_spawn_process_error', {
          issueId,
          role,
          workspacePath,
          activityId,
          error: error.message,
          args,
          cwd: cwd || workspacePath,
          spawnLogPath,
        }).catch(() => undefined);
      });
      child.once('spawn', () => {
        void appendAgentLifecycleLog(agentSessionName, 'agent.work_spawn_process_spawned', {
          issueId,
          role,
          workspacePath,
          activityId,
          pid: child.pid,
          args,
          cwd: cwd || workspacePath,
          spawnLogPath,
        }).catch(() => undefined);
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
          cwd: cwd || workspacePath,
          spawnLogPath,
        }).catch(() => undefined);
      });
      child.unref();
      await spawnLogHandle.close();
      return activityId;
    };

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
        const getComposeProjectName = async (id: string, pPath?: string): Promise<string> => {
          const lower = id.toLowerCase();
          const featureFolder = `feature-${lower}`;
          if (pPath) {
            const devScriptPaths = [
              join(pPath, 'workspaces', featureFolder, '.devcontainer', 'dev'),
              join(pPath, 'workspaces', featureFolder, 'dev'),
            ];
            for (const devPath of devScriptPaths) {
              try {
                if (existsSync(devPath)) {
                  const content = await readFile(devPath, 'utf-8');
                  const match = content.match(/COMPOSE_PROJECT_NAME="([^$"]*)\$\{FEATURE_FOLDER\}"/);
                  if (match) return `${match[1]}${featureFolder}`;
                  const literalMatch = content.match(/COMPOSE_PROJECT_NAME="([^"]+)"/);
                  if (literalMatch) return literalMatch[1];
                }
              } catch {}
            }
          }
          return featureFolder;
        };

        const featureName = yield* Effect.promise(() => getComposeProjectName(issueId, projectPath));
        yield* Effect.promise(() => appendAgentLifecycleLog(agentSessionName, 'agent.start_container_check', {
          issueId,
          featureName,
          workspacePath,
        }));
        let containersReady = false;

        try {
          const { stdout: existing } = yield* Effect.promise(() => execAsync(
            `docker ps --filter "name=${featureName}" --format "{{.Names}}|{{.Status}}"`,
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

        if (!containersReady) {
          const earlyAgentId = agentSessionName;
          const earlyStateDir = join(homedir(), '.panopticon', 'agents', earlyAgentId);
          yield* Effect.promise(() => mkdir(earlyStateDir, { recursive: true }));
          yield* Effect.promise(() => writeFile(join(earlyStateDir, 'state.json'), JSON.stringify({
            id: earlyAgentId,
            issueId,
            // PAN-1048 R2: legacy `runtime` field removed from state.json writes;
            // AgentState shape carries `harness` instead and parseAgentState drops
            // unknown fields. PAN-1055: persist the user-picked harness when set,
            // so a Pi-locked spawn does not race-degrade to claude-code on restart.
            // When the user did not pick, omit the field — saveAgentState() will
            // backfill it from roles.work.harness on the next write.
            ...(effectiveHarness ? { harness: effectiveHarness } : {}),
            model: 'pending-container-start',
            status: 'starting',
            startedAt: new Date().toISOString(),
            workspace: workspacePath,
            role,
            message: 'Waiting for containers to start...',
            ...(preSpawnStashRef ? { preSpawnStashRef } : {}),
            ...(preSpawnStashMessage ? { preSpawnStashMessage } : {}),
            ...(preSpawnBaselineHead ? { preSpawnBaselineHead } : {}),
          }, null, 2)));
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
                    env: buildChildEnvWithoutTmux(process.env, { UID: String(containerUid), GID: String(containerGid), DOCKER_USER: `${containerUid}:${containerGid}` }),
                    detached: true,
                  });
                  containerChild.unref();

                  const maxWaitMs = 3 * 60 * 1000;
                  const pollIntervalMs = 3000;
                  const startTime = Date.now();
                  let healthy = false;

                  while (Date.now() - startTime < maxWaitMs) {
                    try {
                      const { stdout } = await execAsync(
                        `docker ps --filter "name=${featureName}" --format "{{.Names}}|{{.Status}}"`,
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
                    await writeFile(join(earlyStateDir, 'state.json'), JSON.stringify({
                      id: earlyAgentId,
                      issueId,
                      // PAN-1048 R2: legacy `runtime` removed; PAN-1055: persist
                      // the user-picked harness only when set (see comment above).
                      ...(effectiveHarness ? { harness: effectiveHarness } : {}),
                      model: 'pending-container-start',
                      status: 'error',
                      startedAt: new Date().toISOString(),
                      workspace: workspacePath,
                      role,
                      message: 'Container startup timed out before work agent spawn',
                      error: `Containers for ${issueId} did not become healthy within ${maxWaitMs}ms`,
                      ...(preSpawnStashRef ? { preSpawnStashRef } : {}),
                      ...(preSpawnStashMessage ? { preSpawnStashMessage } : {}),
                      ...(preSpawnBaselineHead ? { preSpawnBaselineHead } : {}),
                    }, null, 2));
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
                  await spawnPanCommand(
                    ['start', issueId, '--local', '--model', spawnModel,
                      ...(effectiveHarness ? ['--harness', effectiveHarness] : [])],
                    workspacePath,
                  );
                  await updateIssueStatus();
                } catch (err: any) {
                  const errorMessage = err instanceof Error ? err.message : String(err);
                  await appendAgentLifecycleLog(earlyAgentId, 'agent.container_start_failed', {
                    issueId,
                    error: errorMessage,
                  }).catch(() => undefined);
                  await writeFile(join(earlyStateDir, 'state.json'), JSON.stringify({
                    id: earlyAgentId,
                    issueId,
                    // PAN-1048 R2: legacy `runtime` removed from state.json writes.
                    model: 'pending-container-start',
                    status: 'error',
                    startedAt: new Date().toISOString(),
                    workspace: workspacePath,
                    role,
                    message: 'Container startup failed before work agent spawn',
                    error: errorMessage,
                    ...(preSpawnStashRef ? { preSpawnStashRef } : {}),
                    ...(preSpawnStashMessage ? { preSpawnStashMessage } : {}),
                    ...(preSpawnBaselineHead ? { preSpawnBaselineHead } : {}),
                  }, null, 2)).catch(() => undefined);
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
    const activityId = yield* Effect.promise(() => spawnPanCommand(
      ['start', issueId, '--local', '--model', spawnModel,
        ...(effectiveHarness ? ['--harness', effectiveHarness] : [])],
      workspacePath,
    ));

    // Write early state.json so the dashboard immediately shows agent-<id> as the
    // active agent. Without this there's a race window between spawnPanCommand returning
    // and pan start calling saveAgentState(), during which the workspace detail
    // panel shows the stale planning-<id> session and "No saved output available."
    const earlyAgentId = agentSessionName; // e.g. "agent-pan-488"
    const earlyStateDir = join(homedir(), '.panopticon', 'agents', earlyAgentId);
    yield* Effect.promise(() => mkdir(earlyStateDir, { recursive: true }));
    yield* Effect.promise(() => writeFile(join(earlyStateDir, 'state.json'), JSON.stringify({
      id: earlyAgentId,
      issueId,
      // PAN-1048 R2: legacy `runtime` removed; PAN-1055: persist the user-picked
      // harness only when set (see container-startup branch above for rationale).
      ...(effectiveHarness ? { harness: effectiveHarness } : {}),
      model: 'pending-work-spawn',
      status: 'starting',
      startedAt: new Date().toISOString(),
      workspace: workspacePath,
      role,
      message: 'Work agent spawn requested',
      ...(preSpawnStashRef ? { preSpawnStashRef } : {}),
      ...(preSpawnStashMessage ? { preSpawnStashMessage } : {}),
      ...(preSpawnBaselineHead ? { preSpawnBaselineHead } : {}),
    }, null, 2)));
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
    yield* Effect.promise(() => Effect.runPromise(eventStore.append({
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
    })));
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
    return yield* Effect.promise(async () => {
      const alive = await sessionExistsAsync(agentId);
      return jsonResponse({ alive });
    });
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
        const running = (await listRunningAgentsAsync()).filter(a => a.tmuxActive);
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
    const lifecycle = getWorkAgentLifecycleState(id);
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

    const lifecycle = getWorkAgentLifecycleState(id);
    const agentState = yield* Effect.promise(() => getAgentStateAsync(id));
    if (!agentState) {
      return jsonResponse({ error: `Agent ${id} not found`, lifecycle }, { status: 404 });
    }

    if (lifecycle.hasLiveTmuxSession) {
      return jsonResponse({ error: `Agent ${id} is running. Stop it first.`, lifecycle }, { status: 409 });
    }

    const previousSessionId = getLatestSessionId(id);
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

    // Kill zombie tmux session if exists
    yield* Effect.promise(() =>
      killSessionAsync(id)
        .catch(() => { /* no session to kill */ })
    );

    // Emit event so dashboard updates. PAN-1048 review feedback 004 (C1):
    // include issueId — without it AgentStoppedEvent fails Schema validation.
    yield* Effect.promise(() => Effect.runPromise(eventStore.append({
      type: 'agent.stopped',
      timestamp: new Date().toISOString(),
      payload: { agentId: id, issueId: agentState.issueId },
    })));

    console.log(`[reset-session] Cleared session for ${id} (was: ${previousSessionId.slice(0, 8)}...)`);
    invalidateAgentsCache();
    return jsonResponse({ success: true, agentId: id, previousSessionId, lifecycle: getWorkAgentLifecycleState(id) });
  })),
);

// ─── Route: POST /api/agents/:id/delivery-method ─────────────────────────────
// Updates the agent's delivery method (auto | channels | tmux) in state.json.

const postAgentDeliveryMethodRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/delivery-method',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;
    const { deliveryMethod } = body as { deliveryMethod?: 'auto' | 'channels' | 'tmux' };

    if (!deliveryMethod || !['auto', 'channels', 'tmux'].includes(deliveryMethod)) {
      return jsonResponse({ error: 'deliveryMethod must be auto, channels, or tmux' }, { status: 400 });
    }

    const agentState = yield* Effect.promise(() => getAgentStateAsync(id));
    if (!agentState) {
      return jsonResponse({ error: `Agent ${id} not found` }, { status: 404 });
    }

    yield* Effect.promise(() => setAgentDeliveryMethod(id, deliveryMethod));
    return jsonResponse({ success: true, agentId: id, deliveryMethod });
  })),
);

// ─── Route: POST /api/agents/:id/switch-model ────────────────────────────────
// Prepares an agent to restart on a different model:
//   1. Stops the agent if running
//   2. Clears saved session (session.id, sessions.json, claudeSessionId in runtime.json)
//   3. Updates model in state.json
// The caller (frontend) is responsible for spawning a fresh agent via POST /api/agents.

const postAgentSwitchModelRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/switch-model',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;

    const { model: newModel } = body as { model?: string; message?: string };
    if (!newModel || typeof newModel !== 'string' || !newModel.trim()) {
      return jsonResponse({ error: 'model is required' }, { status: 400 });
    }

    const agentState = yield* Effect.promise(() => getAgentStateAsync(id));
    if (!agentState) {
      return jsonResponse({ error: `Agent ${id} not found` }, { status: 404 });
    }

    const previousModel = agentState.model ?? '';
    const lifecycle = getWorkAgentLifecycleState(id);

    // Stop running agent if alive
    if (lifecycle.hasLiveTmuxSession) {
      yield* Effect.promise(() => stopAgentAsync(id));
      yield* Effect.promise(() => Effect.runPromise(eventStore.append({
        type: 'agent.stopped',
        timestamp: new Date().toISOString(),
        payload: { agentId: id, issueId: agentState.issueId },
      })));
    }

    const agentDir = getAgentDir(id);

    // Clear session tracking files
    yield* Effect.promise(() => rm(join(agentDir, 'session.id'), { force: true }));
    yield* Effect.promise(() => rm(join(agentDir, 'sessions.json'), { force: true }));

    // Clear claudeSessionId from runtime.json (preserve other fields)
    const runtimeFile = join(agentDir, 'runtime.json');
    if (existsSync(runtimeFile)) {
      try {
        const runtimeContent = yield* Effect.promise(() => readFile(runtimeFile, 'utf-8'));
        const runtime = JSON.parse(runtimeContent);
        delete runtime.claudeSessionId;
        yield* Effect.promise(() => writeFile(runtimeFile, JSON.stringify(runtime, null, 2)));
      } catch { /* non-fatal */ }
    }

    // Kill zombie tmux session if exists
    yield* Effect.promise(() => killSessionAsync(id).catch(() => { /* no session to kill */ }));

    // Update model in state.json
    const stateFile = join(agentDir, 'state.json');
    if (existsSync(stateFile)) {
      try {
        const stateContent = yield* Effect.promise(() => readFile(stateFile, 'utf-8'));
        const state = JSON.parse(stateContent);
        state.model = newModel.trim();
        yield* Effect.promise(() => writeFile(stateFile, JSON.stringify(state, null, 2)));
      } catch { /* non-fatal */ }
    }

    yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.model_switched', { previousModel, newModel }));
    invalidateAgentsCache();

    return jsonResponse({ success: true, agentId: id, previousModel, newModel });
  })),
);

export const agentsRouteLayer = Layer.mergeAll(
  getAgentsRoute,
  getAgentOutputRoute,
  getAgentConversationRoute,
  postAgentMessageRoute,
  deleteAgentRoute,
  getAgentHealthHistoryRoute,
  postAgentPokeRoute,
  getAgentPendingQuestionsRoute,
  postAgentAnswerQuestionRoute,
  postAgentHeartbeatRoute,
  postInternalAgentPermissionRequestRoute,
  postAgentPermissionResponseRoute,
  getAgentRuntimeRoute,
  getAgentActivityRoute,
  getAgentFilesRoute,
  getAgentTimelineRoute,
  postAgentSuspendRoute,
  postAgentResumeRoute,
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
  postAgentDeliveryMethodRoute,
);

export default agentsRouteLayer;

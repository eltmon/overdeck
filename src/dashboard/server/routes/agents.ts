import { jsonResponse } from "../http-helpers.js";
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
 *   GET    /api/agents/:id/handoffs
 *   GET    /api/agents/:id/cost
 *   POST   /api/agents
 */

import { exec, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, symlink, lstat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { getCloisterService } from '../../../lib/cloister/service.js';
import { loadCloisterConfig } from '../../../lib/cloister/config.js';
import { checkAllTriggers } from '../../../lib/cloister/triggers.js';
import { performHandoff } from '../../../lib/cloister/handoff.js';
import { readAgentHandoffEvents } from '../../../lib/cloister/handoff-logger.js';
import { getAgentHealth } from '../../../lib/cloister/health.js';
import { getRuntimeForAgent } from '../../../lib/runtimes/index.js';
import {
  getAgentState,
  getAgentRuntimeState,
  saveAgentRuntimeState,
  saveAgentState,
  getActivity,
  saveSessionId,
  getSessionId,
  getLatestSessionId,
  resumeAgent,
  messageAgent,
  stopAgent,
} from '../../../lib/agents.js';
import { hasPRDDraft } from '../../../lib/prd-draft.js';
import {
  PROJECT_DOCS_SUBDIR,
  PROJECT_PRDS_SUBDIR,
  PROJECT_PRDS_ACTIVE_SUBDIR,
  PROJECT_PRDS_COMPLETED_SUBDIR,
} from '../../../lib/paths.js';
import { resolveProjectFromIssue } from '../../../lib/projects.js';
import { loadWorkspaceMetadata as loadWorkspaceMetadataFn } from '../../../lib/remote/workspace-metadata.js';
import { buildResumePrompt } from '../../../lib/cloister/resume-prompt.js';
import { calculateCost, getPricing, type TokenUsage } from '../../../lib/cost.js';
import { normalizeModelName } from '../../../lib/cost-parsers/jsonl-parser.js';
import { getReviewStatus } from '../../../lib/review-status.js';
import { IssueLifecycle } from '../services/issue-lifecycle.js';
import {
  getClaudeProjectDir as getClaudeProjectDirShared,
  getActiveSessionPath as getActiveSessionPathShared,
  getAgentWorkspace as getAgentWorkspaceShared,
  getAgentJsonlPath as getAgentJsonlPathShared,
  getPendingQuestions as getPendingQuestionsShared,
  getAgentPendingQuestions as getAgentPendingQuestionsShared,
  type PendingQuestion,
} from '../../../lib/agent-enrichment.js';
import { EventStoreService } from '../services/domain-services.js';

const execAsync = promisify(exec);

// ─── Shared IssueDataService singleton ───────────────────────────────────────

function getIssueDataService(): import('../services/issue-data-service.js').IssueDataService {
  const { getSharedIssueService } = require('../services/issue-service-singleton.js');
  return getSharedIssueService();
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const AGENTS_CACHE_TTL_MS = 5000;
let agentsCache: { data: unknown[] | null; timestamp: number } = { data: null, timestamp: 0 };

// ─── Local helpers ────────────────────────────────────────────────────────────

// Read the request body as unknown JSON
const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? JSON.parse(text) : {};
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
  Effect.gen(function* () {
    return yield* Effect.promise(async () => {
        try {
        const now = Date.now();

        if (agentsCache.data && (now - agentsCache.timestamp) < AGENTS_CACHE_TTL_MS) {
          return jsonResponse(agentsCache.data);
        }

        const { stdout } = await execAsync('tmux list-sessions -F "#{session_name}|#{session_created}" 2>/dev/null || true');
        const agentLines = stdout
          .trim()
          .split('\n')
          .filter(line => line.startsWith('agent-') || line.startsWith('planning-'));

        const agentsDir = join(homedir(), '.panopticon', 'agents');
        const remoteAgentIds: string[] = [];
        const startingAgentIds: string[] = [];
        const failedAgentIds: string[] = [];

        if (existsSync(agentsDir)) {
          const dirs = (await readdir(agentsDir)).filter(d => d.startsWith('agent-') || d.startsWith('planning-'));
          for (const dir of dirs) {
            const inLocalList = agentLines.some(line => line.startsWith(dir + '|'));
            const remoteStateFile = join(agentsDir, dir, 'remote-state.json');
            if (existsSync(remoteStateFile)) {
              try {
                const state = JSON.parse(await readFile(remoteStateFile, 'utf-8'));
                if (state.location === 'remote' && state.status === 'running' && !inLocalList) {
                  remoteAgentIds.push(dir);
                }
              } catch {}
            }
            if (!inLocalList && !remoteAgentIds.includes(dir)) {
              const localStateFile = join(agentsDir, dir, 'state.json');
              if (existsSync(localStateFile)) {
                try {
                  const state = JSON.parse(await readFile(localStateFile, 'utf-8'));
                  if (state.status === 'starting') {
                    startingAgentIds.push(dir);
                  } else if (state.status === 'failed') {
                    failedAgentIds.push(dir);
                  }
                } catch {}
              }
            }
          }
        }

        const agents = await Promise.all(
          agentLines.map(async (line) => {
            const [name, created] = line.split('|');
            const startedAt = new Date(parseInt(created) * 1000).toISOString();
            const isPlanning = name.startsWith('planning-');
            const stateFile = join(homedir(), '.panopticon', 'agents', name, 'state.json');
            const healthFile = join(homedir(), '.panopticon', 'agents', name, 'health.json');
            let state: any = { runtime: 'claude', model: isPlanning ? 'opus' : 'sonnet', workspace: process.cwd() };
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

            let pendingQuestions = await getAgentPendingQuestions(name);
            if (pendingQuestions.length > 0 && startedAt) {
              const agentStartTime = new Date(startedAt).getTime();
              pendingQuestions = pendingQuestions.filter(q => {
                const qTime = new Date(q.timestamp).getTime();
                return !isNaN(qTime) && qTime >= agentStartTime;
              });
            }

            const runtimeState = getAgentRuntimeState(name);
            const isIdle = runtimeState?.state === 'idle' || (runtimeState?.currentTool === 'AskUserQuestion' && pendingQuestions.length === 0);

            const issueReviewStatus = getReviewStatus(issueId);
            const hasActiveSpecialist = issueReviewStatus?.reviewStatus === 'reviewing'
              || issueReviewStatus?.testStatus === 'testing'
              || issueReviewStatus?.mergeStatus === 'merging';

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
              runtime: state.runtime || 'claude',
              model: state.model || (isPlanning ? 'opus' : 'sonnet'),
              status: 'healthy' as const,
              startedAt,
              consecutiveFailures: health.consecutiveFailures || 0,
              killCount: health.killCount || 0,
              workspace: state.workspace || null,
              workspaceLocation,
              git: gitStatus,
              type: 'agent',
              agentPhase: isPlanning ? 'planning' : (state.phase || 'implementation'),
              hasPendingQuestion: !hasActiveSpecialist && (pendingQuestions.length > 0 || isIdle || runtimeState?.resolution === 'needs_input'),
              pendingQuestionCount: pendingQuestions.length,
              resolution: runtimeState?.resolution || 'working',
              resolutionCount: runtimeState?.resolutionCount || 0,
              contextPercent,
              initialContextPercent,
            };
          })
        );

        const remoteAgents = await Promise.all(
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
                agentPhase: isPlanning ? 'planning' : 'implementation',
                hasPendingQuestion: false,
                pendingQuestionCount: 0,
                remote: true,
              };
            } catch { return null; }
          })
        );

        const stoppedAgents: any[] = [];
        if (existsSync(agentsDir)) {
          const allDirs = (await readdir(agentsDir)).filter(d => d.startsWith('agent-') || d.startsWith('planning-'));
          const alreadyListed = new Set([
            ...agentLines.map(l => l.split('|')[0]),
            ...remoteAgentIds,
          ]);
          for (const dir of allDirs) {
            if (alreadyListed.has(dir)) continue;
            const stateFile = join(agentsDir, dir, 'state.json');
            if (!existsSync(stateFile)) continue;
            try {
              const state = JSON.parse(await readFile(stateFile, 'utf-8'));
              const runtimeFile = join(agentsDir, dir, 'runtime.json');
              let runtimeData: any = {};
              if (existsSync(runtimeFile)) {
                try { runtimeData = JSON.parse(await readFile(runtimeFile, 'utf-8')); } catch {}
              }
              const hasCompletedMarker = existsSync(join(agentsDir, dir, 'completed')) ||
                existsSync(join(agentsDir, dir, 'completed.processed'));
              const runtimeIdle = runtimeData.state === 'idle' || state.state === 'idle';
              const isStopped = state.status === 'stopped' || hasCompletedMarker ||
                (runtimeIdle && state.status !== 'starting');
              if (!isStopped) continue;
              const lastActivity = runtimeData.lastActivity || state.lastActivity;
              const stoppedAt = lastActivity ? new Date(lastActivity) : null;
              if (stoppedAt && (now - stoppedAt.getTime()) > 60 * 60 * 1000) continue;
              const isPlanning = dir.startsWith('planning-');
              const issueId = state.issueId?.toUpperCase() ||
                (isPlanning ? dir.replace('planning-', '') : dir.replace('agent-', '')).toUpperCase();
              stoppedAgents.push({
                id: dir,
                issueId,
                runtime: state.runtime || 'claude',
                model: state.model || (isPlanning ? 'opus' : 'sonnet'),
                status: 'stopped' as const,
                startedAt: state.startedAt || new Date().toISOString(),
                consecutiveFailures: 0,
                killCount: 0,
                workspace: state.workspace || null,
                workspaceLocation: 'local',
                git: null,
                type: 'agent',
                agentPhase: isPlanning ? 'planning' : (state.phase || 'implementation'),
                hasPendingQuestion: runtimeData.resolution === 'needs_input',
                pendingQuestionCount: 0,
                resolution: runtimeData.resolution || 'working',
                resolutionCount: runtimeData.resolutionCount || 0,
              });
            } catch {}
          }
        }

        const startingAgents = (await Promise.all(startingAgentIds.map(async dir => {
          const stateFile = join(agentsDir, dir, 'state.json');
          try {
            const state = JSON.parse(await readFile(stateFile, 'utf-8'));
            const isPlanning = dir.startsWith('planning-');
            const issueId = state.issueId?.toUpperCase() ||
              (isPlanning ? dir.replace('planning-', '') : dir.replace('agent-', '')).toUpperCase();
            return {
              id: dir,
              issueId,
              runtime: state.runtime || 'claude',
              model: state.model || (isPlanning ? 'opus' : 'sonnet'),
              status: 'starting' as const,
              startedAt: state.startedAt || new Date().toISOString(),
              consecutiveFailures: 0,
              killCount: 0,
              workspace: state.workspace || null,
              workspaceLocation: 'local',
              git: null,
              type: 'agent',
              agentPhase: isPlanning ? 'planning' : (state.phase || 'implementation'),
              hasPendingQuestion: false,
              pendingQuestionCount: 0,
              message: state.message || 'Starting...',
            };
          } catch { return null; }
        }))).filter(Boolean);

        const failedAgents = (await Promise.all(failedAgentIds.map(async dir => {
          const stateFile = join(agentsDir, dir, 'state.json');
          try {
            const state = JSON.parse(await readFile(stateFile, 'utf-8'));
            const isPlanning = dir.startsWith('planning-');
            const issueId = state.issueId?.toUpperCase() ||
              (isPlanning ? dir.replace('planning-', '') : dir.replace('agent-', '')).toUpperCase();
            return {
              id: dir,
              issueId,
              runtime: state.runtime || 'claude',
              model: state.model || (isPlanning ? 'opus' : 'sonnet'),
              status: 'failed' as const,
              startedAt: state.startedAt || new Date().toISOString(),
              consecutiveFailures: 0,
              killCount: 0,
              workspace: state.workspace || null,
              workspaceLocation: state.location || 'local',
              git: null,
              type: 'agent',
              agentPhase: isPlanning ? 'planning' : (state.phase || 'implementation'),
              hasPendingQuestion: false,
              pendingQuestionCount: 0,
              error: state.error || 'Unknown error',
            };
          } catch { return null; }
        }))).filter(Boolean);

        const allAgents = [...agents, ...remoteAgents.filter(Boolean), ...startingAgents, ...failedAgents, ...stoppedAgents];
        agentsCache = { data: allAgents, timestamp: now };
        return jsonResponse(allAgents);
        } catch (error: unknown) {
          console.error('Error listing agents:', error);
          return jsonResponse([]);
        }
      })
  }),
);

// ─── Route: GET /api/agents/:id/output ───────────────────────────────────────

const getAgentOutputRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/output',
  Effect.gen(function* () {
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
            const result = await execAsync(
              flyExecCmd(vmName, `tmux capture-pane -t '${id}' -p -S -${lines} 2>/dev/null || echo 'Session not found'`),
              { maxBuffer: 10 * 1024 * 1024, timeout: 15000 }
            );
            stdout = result.stdout;
          } else {
            const result = await execAsync(
              `tmux capture-pane -t "${id}" -p -S -${lines} 2>/dev/null || echo "Session not found"`,
              { maxBuffer: 10 * 1024 * 1024 }
            );
            stdout = result.stdout;
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
  }),
);

// ─── Route: POST /api/agents/:id/message ─────────────────────────────────────

const postAgentMessageRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/message',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;

    return yield* Effect.promise(async () => {
        try {
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
              const state = JSON.parse(await readFile(remoteStateFile, 'utf-8'));
              if (state.location === 'remote' && state.vmName) {
                isRemote = true;
                vmName = state.vmName;
              }
            } catch {}
          }

          if (isRemote && vmName) {
            const escapedMessage = message.replace(/\\/g, '\\\\').replace(/'/g, "'\\''").replace(/"/g, '\\"');
            await execAsync(
              flyExecCmd(vmName, `tmux send-keys -t '${id}' -l '${escapedMessage}' && tmux send-keys -t '${id}' Enter`),
              { timeout: 15000 }
            );
            return jsonResponse({ success: true, remote: true });
          } else {
            await messageAgent(id, message);
            return jsonResponse({ success: true });
          }
        } catch (error: unknown) {
          console.error('Error sending message:', error);
          return jsonResponse({ error: 'Failed to send message' }, { status: 500 });
        }
      })
  }),
);

// ─── Route: DELETE /api/agents/:id ───────────────────────────────────────────

const deleteAgentRoute = HttpRouter.add(
  'DELETE',
  '/api/agents/:id',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const eventStore = yield* EventStoreService;

    return yield* Effect.promise(async () => {
        try {
          stopAgent(id);
          await Effect.runPromise(eventStore.append({
            type: 'agent.stopped',
            timestamp: new Date().toISOString(),
            payload: { agentId: id },
          }));
          return jsonResponse({ success: true });
        } catch (error: unknown) {
          console.error('Error stopping agent:', error);
          return jsonResponse({ error: 'Failed to stop agent' }, { status: 500 });
        }
      })
  }),
);

// ─── Route: GET /api/agents/:id/health-history ───────────────────────────────

const getAgentHealthHistoryRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/health-history',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const request = yield* HttpServerRequest.HttpServerRequest;
    const urlOpt = HttpServerRequest.toURL(request);
    const hours = Option.isSome(urlOpt) ? (urlOpt.value.searchParams.get('hours') ?? '24') : '24';

    return yield* Effect.promise(async () => {
        try {
          const { getHealthHistory } = await import('../../../lib/database/health-events-db.js');
          const endTime = new Date();
          const startTime = new Date(endTime.getTime() - parseInt(hours) * 60 * 60 * 1000);
          const events = getHealthHistory(id, startTime.toISOString(), endTime.toISOString());
          return jsonResponse({
            agentId: id,
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            events,
          });
        } catch (error: unknown) {
          console.error('Error fetching health history:', error);
          return jsonResponse({ error: 'Failed to fetch health history' }, { status: 500 });
        }
      })
  }),
);

// ─── Route: POST /api/agents/:id/poke ────────────────────────────────────────

const postAgentPokeRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/poke',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;

    return yield* Effect.promise(async () => {
        try {
          const { message } = body as any;
          const defaultPokeMessage =
            "You seem to have been inactive for a while. If you're stuck:\n" +
            '1. Check your current task in STATE.md\n' +
            '2. Try an alternative approach if blocked\n' +
            '3. Ask for help if needed\n\n' +
            "What's your current status?";
          const pokeMsg = message || defaultPokeMessage;
          await messageAgent(id, pokeMsg);
          return jsonResponse({ success: true, message: 'Agent poked successfully' });
        } catch (error: unknown) {
          console.error('Error poking agent:', error);
          return jsonResponse({ error: 'Failed to poke agent' }, { status: 500 });
        }
      })
  }),
);

// ─── Route: GET /api/agents/:id/pending-questions ────────────────────────────

const getAgentPendingQuestionsRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/pending-questions',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';

    return yield* Effect.promise(async () => {
        try {
          const questions = await getAgentPendingQuestions(id);
          return jsonResponse({ pending: questions.length > 0, questions });
        } catch (error: unknown) {
          console.error('Error checking pending questions:', error);
          return jsonResponse({ pending: false, questions: [] });
        }
      })
  }),
);

// ─── Route: POST /api/agents/:id/answer-question ─────────────────────────────

const postAgentAnswerQuestionRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/answer-question',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;

    return yield* Effect.promise(async () => {
        try {
          const { answers } = body as any;
          if (!answers || !Array.isArray(answers) || answers.length === 0) {
            return jsonResponse({ error: 'answers array required' }, { status: 400 });
          }

          const pendingQuestions = await getAgentPendingQuestions(id);
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
              await execAsync(`tmux send-keys -t "${id}" "4"`);
              const escapedAnswer = answer.replace(/'/g, "'\\''");
              await execAsync(`tmux send-keys -t "${id}" '${escapedAnswer}'`);
              await execAsync(`tmux send-keys -t "${id}" C-m`);
            } else {
              const keyNumber = optionIndex + 1;
              await execAsync(`tmux send-keys -t "${id}" "${keyNumber}"`);
            }

            await execAsync(`tmux send-keys -t "${id}" Tab`);
            await delay(100);
          }

          await execAsync(`tmux send-keys -t "${id}" C-m`);
          return jsonResponse({ success: true });
        } catch (error: unknown) {
          console.error('Error sending answer:', error);
          return jsonResponse({ error: 'Failed to send answer' }, { status: 500 });
        }
      })
  }),
);

// ─── Route: POST /api/agents/:id/heartbeat ───────────────────────────────────

const postAgentHeartbeatRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/heartbeat',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;

    return yield* Effect.promise(async () => {
        try {
          const { state, tool, timestamp } = body as any;
          saveAgentRuntimeState(id, {
            state,
            lastActivity: timestamp || new Date().toISOString(),
            currentTool: tool,
          });
          return jsonResponse({ success: true });
        } catch (error: unknown) {
          console.error('Error saving heartbeat:', error);
          return jsonResponse({ error: 'Failed to save heartbeat' }, { status: 500 });
        }
      })
  }),
);

// ─── Route: GET /api/agents/:id/activity ─────────────────────────────────────

const getAgentActivityRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/activity',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const request = yield* HttpServerRequest.HttpServerRequest;
    const urlOpt = HttpServerRequest.toURL(request);
    const limitStr = Option.isSome(urlOpt) ? (urlOpt.value.searchParams.get('limit') ?? '100') : '100';
    const limit = parseInt(limitStr) || 100;

    return yield* Effect.promise(async () => {
        try {
          const activity = getActivity(id, limit);
          return jsonResponse({ activity });
        } catch (error: unknown) {
          console.error('Error reading activity:', error);
          return jsonResponse({ error: 'Failed to read activity' }, { status: 500 });
        }
      })
  }),
);

// ─── Route: GET /api/agents/:id/files ────────────────────────────────────────

const getAgentFilesRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/files',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';

    return yield* Effect.promise(async () => {
        try {
          const agentState = getAgentState(id);
          if (!agentState?.workspace) {
            return jsonResponse({ files: [] });
          }
          const workspacePath = agentState.workspace;
          if (!existsSync(workspacePath)) {
            return jsonResponse({ files: [] });
          }
          const { stdout } = await execAsync(
            'git diff --name-status HEAD 2>/dev/null || git status --porcelain 2>/dev/null || echo ""',
            { cwd: workspacePath, encoding: 'utf-8' }
          );
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
        } catch (error: unknown) {
          console.error('[god-view] files error:', error);
          return jsonResponse({ files: [] });
        }
      })
  }),
);

// ─── Route: GET /api/agents/:id/timeline ─────────────────────────────────────

const getAgentTimelineRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/timeline',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const request = yield* HttpServerRequest.HttpServerRequest;
    const urlOpt = HttpServerRequest.toURL(request);
    const limitStr = Option.isSome(urlOpt) ? (urlOpt.value.searchParams.get('limit') ?? '50') : '50';
    const limit = parseInt(limitStr) || 50;

    return yield* Effect.promise(async () => {
        try {
          const activity = getActivity(id, limit);
          const agentState = getAgentState(id);
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
        } catch (error: unknown) {
          console.error('[god-view] timeline error:', error);
          return jsonResponse({ timeline: [] });
        }
      })
  }),
);

// ─── Route: POST /api/agents/:id/suspend ─────────────────────────────────────

const postAgentSuspendRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/suspend',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;

    return yield* Effect.promise(async () => {
        try {
          const { sessionId } = body as any;
          const effectiveSessionId = sessionId || getSessionId(id);

          if (!effectiveSessionId) {
            return jsonResponse({ error: 'Session ID required for suspend' }, { status: 400 });
          }

          saveSessionId(id, effectiveSessionId);
          await execAsync(`tmux kill-session -t "${id}" 2>/dev/null || true`);
          saveAgentRuntimeState(id, {
            state: 'suspended',
            suspendedAt: new Date().toISOString(),
            sessionId: effectiveSessionId,
          });
          await Effect.runPromise(eventStore.append({
            type: 'agent.stopped',
            timestamp: new Date().toISOString(),
            payload: { agentId: id },
          }));

          return jsonResponse({ success: true });
        } catch (error: unknown) {
          console.error('Error suspending agent:', error);
          return jsonResponse({ error: 'Failed to suspend agent' }, { status: 500 });
        }
      })
  }),
);

// ─── Route: POST /api/agents/:id/resume ──────────────────────────────────────

const postAgentResumeRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/resume',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;

    return yield* Effect.promise(async () => {
        try {
          const { message } = body as any;
          const result = await resumeAgent(id, message);
          if (result.success) {
            return jsonResponse({ success: true });
          } else {
            return jsonResponse({ error: result.error }, { status: 400 });
          }
        } catch (error: unknown) {
          console.error('Error resuming agent:', error);
          return jsonResponse({ error: 'Failed to resume agent' }, { status: 500 });
        }
      })
  }),
);

// ─── Route: GET /api/agents/:id/cloister-health ──────────────────────────────

const getAgentCloisterHealthRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/cloister-health',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';

    return yield* Effect.promise(async () => {
        try {
          const service = getCloisterService();
          const health = service.getAgentHealth(id);
          if (!health) {
            return jsonResponse({ error: 'Agent not found or runtime not available' }, { status: 404 });
          }
          return jsonResponse(health);
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('Error getting agent health:', error);
          return jsonResponse({ error: 'Failed to get agent health: ' + msg }, { status: 500 });
        }
      })
  }),
);

// ─── Route: GET /api/agents/:id/handoff/suggestion ───────────────────────────

const getAgentHandoffSuggestionRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/handoff/suggestion',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';

    return yield* Effect.promise(async () => {
        try {
          const agentState = getAgentState(id);
          if (!agentState) {
            return jsonResponse({ error: 'Agent not found' }, { status: 404 });
          }

          const runtime = getRuntimeForAgent(id);
          if (!runtime) {
            return jsonResponse({ error: 'Runtime not found for agent' }, { status: 404 });
          }

          const health = getAgentHealth(id, runtime);
          const triggers = await checkAllTriggers(
            id,
            agentState.workspace,
            agentState.issueId,
            agentState.model,
            health,
            loadCloisterConfig()
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
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('Error getting handoff suggestion:', error);
          return jsonResponse({ error: 'Failed to get handoff suggestion: ' + msg }, { status: 500 });
        }
      })
  }),
);

// ─── Route: POST /api/agents/:id/handoff ─────────────────────────────────────

const postAgentHandoffRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/handoff',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;

    return yield* Effect.promise(async () => {
        try {
          const { toModel, reason } = body as any;
          if (!toModel) {
            return jsonResponse({ error: 'toModel is required' }, { status: 400 });
          }

          const result = await performHandoff(id, {
            targetModel: toModel,
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
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('Error executing handoff:', error);
          return jsonResponse({ error: 'Failed to execute handoff: ' + msg }, { status: 500 });
        }
      })
  }),
);

// ─── Route: GET /api/agents/:id/handoffs ─────────────────────────────────────

const getAgentHandoffsRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/handoffs',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';

    return yield* Effect.promise(async () => {
        try {
          const handoffs = readAgentHandoffEvents(id);
          return jsonResponse({ handoffs });
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('Error getting agent handoffs:', error);
          return jsonResponse({ error: 'Failed to get agent handoffs: ' + msg }, { status: 500 });
        }
      })
  }),
);

// ─── Route: GET /api/agents/:id/cost ─────────────────────────────────────────

const getAgentCostRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/cost',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';

    return yield* Effect.promise(async () => {
        try {
          const agentState = getAgentState(id);
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
            const projectDirName = `-${workspacePath.replace(/^\//, '').replace(/\//g, '-')}`;
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
                const indexContent = JSON.parse(await readFile(sessionsIndexPath, 'utf-8'));
                for (const sessionEntry of (indexContent.entries || [])) {
                  if (sessionEntry?.fullPath && existsSync(sessionEntry.fullPath)) {
                    await parseJsonlCost(sessionEntry.fullPath);
                  }
                }
              } catch {}
            }

            if (inputTokens === 0 && existsSync(projectDir)) {
              try {
                const files = (await readdir(projectDir)).filter(f => f.endsWith('.jsonl'));
                for (const file of files) {
                  await parseJsonlCost(join(projectDir, file));
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
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('Error getting agent cost:', error);
          return jsonResponse({ error: 'Failed to get agent cost: ' + msg }, { status: 500 });
        }
      })
  }),
);

// ─── Route: POST /api/agents (start agent) ───────────────────────────────────

const postAgentsRoute = HttpRouter.add(
  'POST',
  '/api/agents',
  Effect.gen(function* () {
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;
    const lifecycle = yield* IssueLifecycle;

    return yield* Effect.promise(async () => {
        try {
        const { issueId, projectId } = body as any;

        if (!issueId) {
          return jsonResponse({ error: 'issueId required' }, { status: 400 });
        }

        const issueLower = issueId.toLowerCase();

        const workspaceMetadata = loadWorkspaceMetadataFn(issueId);
        const isRemote = workspaceMetadata?.location === 'remote';

        const issuePrefix = issueId.split('-')[0];
        const projectPath = getProjectPath(projectId, issuePrefix);

        const workspaceExists = existsSync(join(projectPath, 'workspaces', `feature-${issueLower}`));
        const prdPath = join(projectPath, PROJECT_DOCS_SUBDIR, PROJECT_PRDS_SUBDIR, PROJECT_PRDS_ACTIVE_SUBDIR, `${issueLower}-plan.md`);
        const hasPrd = existsSync(prdPath);
        const hasDraftPrd = hasPRDDraft(issueId);

        if (!hasPrd && !hasDraftPrd && !workspaceExists) {
          const completedPrdPath = join(projectPath, PROJECT_DOCS_SUBDIR, PROJECT_PRDS_SUBDIR, PROJECT_PRDS_COMPLETED_SUBDIR, `${issueLower}-plan.md`);
          const hasCompletedPrd = existsSync(completedPrdPath);
          if (!hasCompletedPrd) {
            return jsonResponse({
              error: `No PRD found for ${issueId}. Create a PRD before starting work.`,
              hint: 'Use "pan work plan" to create a PRD draft, then start work.',
              issueId,
            }, { status: 422 });
          }
        }

        const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
        if (!existsSync(workspacePath)) {
          try {
            const nodeDir = dirname(process.execPath);
            await execAsync(
              `pan workspace create ${issueId} --local`,
              { cwd: projectPath, encoding: 'utf-8', timeout: 60000, env: { ...process.env, PATH: `${nodeDir}:${process.env.PATH}` } }
            );
          } catch (wsErr) {
            return jsonResponse({
              error: `Failed to create workspace for ${issueId}: ${(wsErr as Error).message}`,
              hint: 'Try creating the workspace manually: pan workspace create ' + issueId + ' --local',
            }, { status: 500 });
          }
        }

        const workspacePlanningDir = join(workspacePath, '.planning');
        const legacyPlanningDir = join(projectPath, '.planning', issueLower);
        const homePlanningDir = join(homedir(), '.planning', issueLower);

        let planningDir: string | null = null;
        if (existsSync(workspacePlanningDir)) {
          planningDir = workspacePlanningDir;
        } else if (existsSync(legacyPlanningDir)) {
          planningDir = legacyPlanningDir;
        } else if (existsSync(homePlanningDir)) {
          planningDir = homePlanningDir;
        }

        if (planningDir && planningDir !== workspacePlanningDir) {
          try {
            await execAsync(`cp -r "${planningDir}" "${workspacePlanningDir}"`, { encoding: 'utf-8' });
            planningDir = workspacePlanningDir;
          } catch {}
        }

        const workspaceBeadsDir = join(workspacePath, '.beads');
        if (!existsSync(workspaceBeadsDir)) {
          const projectRootBeadsDir = join(projectPath, '.beads');
          if (existsSync(projectRootBeadsDir)) {
            try {
              await execAsync(`cp -r "${projectRootBeadsDir}" "${workspaceBeadsDir}"`, { encoding: 'utf-8' });
            } catch {}
          }
        }

        const planPath = join(workspacePath, '.planning', 'plan.vbrief.json');
        const planningComplete = join(workspacePath, '.planning', '.planning-complete');
        const hasPlan = existsSync(planPath);
        const isComplete = existsSync(planningComplete);

        if (!hasPlan || !isComplete) {
          const reason = !hasPlan
            ? 'No plan.vbrief.json found — planning has not run for this issue.'
            : 'Planning started but did not complete (.planning-complete marker missing).';
          return jsonResponse({
            error: reason,
            hint: 'Run planning first (click Plan button or use /plan skill). The planning agent produces a vBRIEF plan which is then converted to beads automatically.',
            issueId,
          }, { status: 422 });
        }

        try {
          const { readPlan } = await import('../../../lib/vbrief/io.js');
          const planDoc = readPlan(planPath);
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
          const { stdout: bdOutput } = await execAsync(
            `bd list --json -l ${issueId.toLowerCase()} --status all --limit 1`,
            { cwd: workspacePath, encoding: 'utf-8', timeout: 10000 }
          );
          const bdTasks = JSON.parse(bdOutput.trim() || '[]');
          hasBeads = bdTasks.length > 0;
        } catch {}

        if (!hasBeads) {
          return jsonResponse({
            error: `Plan exists but no beads tasks found for ${issueId}. createBeadsFromVBrief may have failed during planning.`,
            hint: 'Re-run planning or manually trigger beads creation from the plan.',
            issueId,
          }, { status: 422 });
        }

        if (planningDir) {
          try {
            const gitRoot = planningDir.includes('/workspaces/')
              ? workspacePath
              : projectPath;
            await execAsync(`git add -f .planning/`, { cwd: gitRoot, encoding: 'utf-8' });
            if (existsSync(join(gitRoot, '.beads'))) {
              await execAsync(`git add .beads/`, { cwd: gitRoot, encoding: 'utf-8' });
            }
            if (existsSync(join(gitRoot, 'STATE.md'))) {
              await execAsync(`git add STATE.md`, { cwd: gitRoot, encoding: 'utf-8' });
            }
            try {
              await execAsync(`git diff --cached --quiet`, { cwd: gitRoot, encoding: 'utf-8' });
            } catch {
              await execAsync(`git commit -m "Planning artifacts for ${issueId} before agent start"`, { cwd: gitRoot, encoding: 'utf-8' });
              const pushChild = spawn('git', ['push'], { cwd: gitRoot, detached: true, stdio: 'ignore' });
              pushChild.unref();
            }
          } catch {}
        }

        const planningPromptPath = join(workspacePlanningDir, 'PLANNING_PROMPT.md');
        if (existsSync(planningPromptPath)) {
          try {
            await rename(planningPromptPath, planningPromptPath + '.archived');
          } catch {}
        }

        if (isRemote && workspaceMetadata) {
          const { spawnRemoteAgent } = await import('../../../lib/remote/remote-agents.js');
          const { createFlyProviderFromConfig } = await import('../../../lib/remote/index.js');
          const { loadConfig: loadPanConfig } = await import('../../../lib/config.js');
          const fly = createFlyProviderFromConfig(loadPanConfig().remote);
          await fly.syncAllCredentials(workspaceMetadata.vmName);

          const { buildWorkAgentPrompt, getTrackerContext } = await import('../../../lib/cloister/work-agent-prompt.js');
          const trackerContext = await getTrackerContext(issueId, workspacePath);
          const agentPrompt = buildWorkAgentPrompt({
            issueId,
            env: 'REMOTE',
            workspacePath: '/workspace',
            skipDynamicContext: true,
            trackerContext,
          });

          const state = await spawnRemoteAgent({
            issueId,
            workspace: workspaceMetadata,
            prompt: agentPrompt,
          });

          // Update issue status via IssueLifecycle service (PAN-449)
          await Effect.runPromise(
            lifecycle.transitionTo(issueId, 'in_progress').pipe(Effect.catch(() => Effect.void))
          );

          await Effect.runPromise(eventStore.append({
            type: 'agent.started',
            timestamp: new Date().toISOString(),
            payload: { agentId: issueId, issueId },
          }));
          await Effect.runPromise(eventStore.append({
            type: 'issue.statusChanged',
            timestamp: new Date().toISOString(),
            payload: { issueId, status: 'In Progress', canonicalStatus: 'in_progress' },
          }));
          try { getIssueDataService().patchIssue(issueId, { status: 'In Progress', canonicalStatus: 'in_progress' }); } catch { /* non-fatal */ }
          return jsonResponse({
            success: true,
            message: `Starting remote agent for ${issueId}`,
            remote: true,
            vmName: workspaceMetadata.vmName,
            agentId: state.id,
            projectPath,
          });
        }

        // Local workspace
        const devScript = join(workspacePath, 'dev');
        const hasPlanning = existsSync(join(workspacePath, '.planning'));
        const phase = (body as any).phase || (hasPlanning ? 'implementation' : 'exploration');

        const agentSessionName = `agent-${issueLower}`;

        // Check if we can resume a stopped agent with a saved session
        const existingAgentState = getAgentState(agentSessionName);
        const savedSessionId = getLatestSessionId(agentSessionName);

        if (existingAgentState && savedSessionId && (existingAgentState.status === 'stopped' || existingAgentState.status === 'completed')) {
          // Kill any zombie tmux session before resuming
          try {
            await execAsync(`tmux kill-session -t ${agentSessionName} 2>/dev/null`, { encoding: 'utf-8' });
          } catch { /* No existing session — good */ }

          // Remove completed marker so the agent can work again
          const completedFile = join(homedir(), '.panopticon', 'agents', agentSessionName, 'completed');
          try { await rm(completedFile, { force: true }); } catch { /* non-fatal */ }

          // Build resume prompt with user message if provided
          const agentDir = join(homedir(), '.panopticon', 'agents', agentSessionName);
          const resumeLauncher = join(agentDir, 'resume-launcher.sh');
          const resumePromptFile = join(agentDir, 'resume-prompt.md');
          const userMessage = (body as any).message || undefined;
          const resumePrompt = buildResumePrompt(workspacePath, issueId, agentDir, userMessage);
          await writeFile(resumePromptFile, resumePrompt);

          // Resume the existing Claude session — keeps full conversation history and session continuity.
          // Start with --resume (interactive), then send the message via tmux after startup.
          // Note: -p means "print mode" which exits after one response — NOT what we want for agents.
          const resumeContent = `#!/bin/bash\nexec claude --resume "${savedSessionId}" --dangerously-skip-permissions\n`;
          await writeFile(resumeLauncher, resumeContent, { mode: 0o755 });

          // Spawn tmux session with resume command
          const escapedCwd = workspacePath.replace(/"/g, '\\"');
          await execAsync(
            `tmux new-session -d -s ${agentSessionName} -c "${escapedCwd}" -e PANOPTICON_AGENT_ID=${agentSessionName} -e PANOPTICON_ISSUE_ID=${issueId} -e PANOPTICON_SESSION_TYPE=${phase} -e CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false "bash ${resumeLauncher}"`,
            { encoding: 'utf-8' }
          );

          console.log(`[start-agent] Resumed ${agentSessionName} session ${savedSessionId.slice(0, 8)}...`);

          // Send the resume prompt via tmux after Claude starts up
          // Use sendKeysAsync (load-buffer + paste-buffer pattern) for reliable delivery
          const { sendKeysAsync } = await import('../../../lib/tmux.js');
          (async () => {
            // Wait for Claude to initialize and show the prompt
            await new Promise(r => setTimeout(r, 5000));
            try {
              await sendKeysAsync(agentSessionName, resumePrompt);
              console.log(`[start-agent] Sent resume prompt to ${agentSessionName}`);
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`[start-agent] Failed to send resume prompt to ${agentSessionName}: ${msg}`);
            }
          })();

          // Update agent state
          existingAgentState.status = 'running';
          existingAgentState.lastActivity = new Date().toISOString();
          saveAgentState(existingAgentState);

          saveAgentRuntimeState(agentSessionName, {
            state: 'active',
            resumedAt: new Date().toISOString(),
          });

          // Transition issue to "In Progress"
          await Effect.runPromise(
            lifecycle.transitionTo(issueId, 'in_progress').pipe(Effect.catch(() => Effect.void))
          );

          Effect.runSync(eventStore.append({
            type: 'agent.started',
            timestamp: new Date().toISOString(),
            payload: {
              agentId: agentSessionName,
              issueId,
              resumed: true,
              agent: {
                id: agentSessionName,
                issueId: existingAgentState.issueId,
                workspace: existingAgentState.workspace,
                runtime: existingAgentState.runtime,
                model: existingAgentState.model,
                status: 'running',
                startedAt: existingAgentState.startedAt,
                lastActivity: existingAgentState.lastActivity,
                phase: existingAgentState.phase,
              },
            },
          }));
          Effect.runSync(eventStore.append({
            type: 'issue.statusChanged',
            timestamp: new Date().toISOString(),
            payload: { issueId, status: 'In Progress', canonicalStatus: 'in_progress' },
          }));
          try { getIssueDataService().patchIssue(issueId, { status: 'In Progress', canonicalStatus: 'in_progress' }); } catch { /* non-fatal */ }

          return jsonResponse({
            success: true,
            message: `Resumed agent for ${issueId} (session ${savedSessionId.slice(0, 8)}...)`,
            resumed: true,
            agentId: agentSessionName,
            projectPath,
          });
        }

        // Kill any zombie tmux session from a previous crash
        try {
          await execAsync(`tmux has-session -t ${agentSessionName} 2>/dev/null`, { encoding: 'utf-8' });
          // Session exists — kill it so we can start fresh
          await execAsync(`tmux kill-session -t ${agentSessionName} 2>/dev/null`, { encoding: 'utf-8' });
          console.log(`[start-agent] Killed stale tmux session ${agentSessionName}`);
        } catch { /* No existing session — good */ }

        // Spawn pan work issue command
        const spawnPanCommand = (args: string[], cwd?: string): string => {
          const activityId = `activity-${Date.now()}`;
          const child = spawn('pan', args, {
            cwd: cwd || workspacePath,
            detached: true,
            stdio: 'ignore',
          });
          child.unref();
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
            await execAsync('docker info >/dev/null 2>&1', { encoding: 'utf-8' });
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

            const featureName = await getComposeProjectName(issueId, projectPath);
            let containersReady = false;

            try {
              const { stdout: existing } = await execAsync(
                `docker ps --filter "name=${featureName}" --format "{{.Names}}|{{.Status}}"`,
                { encoding: 'utf-8' }
              );
              const runningContainers = existing.trim().split('\n').filter(Boolean);
              const allHealthy = runningContainers.length > 0 && runningContainers.every(line => {
                const status = line.split('|')[1] || '';
                return status.includes('Up') && (!status.includes('(') || status.includes('(healthy)'));
              });
              if (allHealthy) containersReady = true;
            } catch {}

            if (!containersReady) {
              const earlyAgentId = `agent-${issueLower}`;
              const earlyStateDir = join(homedir(), '.panopticon', 'agents', earlyAgentId);
              await mkdir(earlyStateDir, { recursive: true });
              await writeFile(join(earlyStateDir, 'state.json'), JSON.stringify({
                id: earlyAgentId,
                issueId,
                status: 'starting',
                startedAt: new Date().toISOString(),
                workspace: workspacePath,
                message: 'Waiting for containers to start...',
              }, null, 2));

              const containerActivityId = `containers-${Date.now()}`;

              // Start containers in background and spawn agent when ready
              (async () => {
                try {
                  const containerUid = process.getuid?.() ?? 1000;
                  const containerGid = process.getgid?.() ?? 1000;
                  const containerChild = spawn('./dev', ['all'], {
                    cwd: workspacePath,
                    stdio: 'ignore',
                    env: { ...process.env, UID: String(containerUid), GID: String(containerGid), DOCKER_USER: `${containerUid}:${containerGid}` },
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

                  spawnPanCommand(['work', 'issue', issueId, '--phase', phase], workspacePath);
                  await updateIssueStatus();
                } catch (err) {
                  console.error(`[start-agent] Background container startup failed for ${issueId}:`, err);
                }
              })();

              await Effect.runPromise(eventStore.append({
                type: 'issue.statusChanged',
                timestamp: new Date().toISOString(),
                payload: { issueId, status: 'In Progress', canonicalStatus: 'in_progress' },
              }));
              try { getIssueDataService().patchIssue(issueId, { status: 'In Progress', canonicalStatus: 'in_progress' }); } catch { /* non-fatal */ }
              return jsonResponse({
                success: true,
                message: `Starting containers and agent for ${issueId} (this may take a few minutes)`,
                startingContainers: true,
                containerActivityId,
                agentId: earlyAgentId,
                projectPath,
              });
            }
          }
        }

        // Containers already ready or no containers needed
        const activityId = spawnPanCommand(['work', 'issue', issueId, '--phase', phase], workspacePath);
        await updateIssueStatus();

        await Effect.runPromise(eventStore.append({
          type: 'agent.started',
          timestamp: new Date().toISOString(),
          payload: { agentId: issueId, issueId },
        }));
        await Effect.runPromise(eventStore.append({
          type: 'issue.statusChanged',
          timestamp: new Date().toISOString(),
          payload: { issueId, status: 'In Progress', canonicalStatus: 'in_progress' },
        }));
        try { getIssueDataService().patchIssue(issueId, { status: 'In Progress', canonicalStatus: 'in_progress' }); } catch { /* non-fatal */ }
        return jsonResponse({
          success: true,
          message: `Starting agent for ${issueId}`,
          activityId,
          projectPath,
        });
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('Error starting agent:', error);
          return jsonResponse({ error: 'Failed to start agent: ' + msg }, { status: 500 });
        }
      })
  }),
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
      try {
        await execAsync(`tmux has-session -t ${agentId} 2>/dev/null`, { encoding: 'utf-8' });
        return jsonResponse({ alive: true });
      } catch {
        return jsonResponse({ alive: false });
      }
    });
  }),
);

export const agentsRouteLayer = Layer.mergeAll(
  getAgentsRoute,
  getAgentOutputRoute,
  postAgentMessageRoute,
  deleteAgentRoute,
  getAgentHealthHistoryRoute,
  postAgentPokeRoute,
  getAgentPendingQuestionsRoute,
  postAgentAnswerQuestionRoute,
  postAgentHeartbeatRoute,
  getAgentActivityRoute,
  getAgentFilesRoute,
  getAgentTimelineRoute,
  postAgentSuspendRoute,
  postAgentResumeRoute,
  getAgentCloisterHealthRoute,
  getAgentHandoffSuggestionRoute,
  postAgentHandoffRoute,
  getAgentHandoffsRoute,
  getAgentCostRoute,
  postAgentsRoute,
  getAgentTmuxAliveRoute,
);

export default agentsRouteLayer;

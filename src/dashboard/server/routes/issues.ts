import { jsonResponse } from "../http-helpers.js";
import { httpHandler } from './http-handler.js';
/**
 * Issues route module — Effect HttpRouter.Layer (PAN-428 B6)
 *
 * Implements all /api/issues/* endpoints from the Express server:
 *   GET  /api/issues
 *   GET  /api/issues/:id/analyze
 *   POST /api/issues/:id/plan
 *   POST /api/issues/:issueId/close
 *   POST /api/issues/:id/start-planning
 *   POST /api/issues/:id/abort-planning
 *   POST /api/issues/:id/complete-planning
 *   POST /api/issues/:id/abort
 *   POST /api/issues/:id/reset
 *   POST /api/issues/:id/cancel
 *   POST /api/issues/:id/reopen
 *   POST /api/issues/:id/move-status
 *   POST /api/issues/:id/cleanup-workspace
 *   POST /api/issues/:id/deep-wipe
 *   POST /api/issues/:id/close-out
 *   GET  /api/issues/:id/beads
 *   POST /api/issues/:id/beads/:beadId/inspect
 *   GET  /api/issues/:id/costs
 */

import { exec, execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawnPlanningSession, type PlanningIssue } from '../../../lib/planning/spawn-planning-session.js';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { withBdMutex } from '../../../lib/bd-mutex.js';
import { spawnInspectAgent } from '../../../lib/cloister/inspect-agent.js';
import { createInFlightGuard } from '../../../lib/cloister/in-flight-guard.js';

import { Duration, Effect, Layer, Option, Stream } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { extractTeamPrefix, findProjectByTeamSync, resolveProjectFromIssueSync } from '../../../lib/projects.js';
import { extractPrefixSync, parseIssueIdSync } from '../../../lib/issue-id.js';
import { isPlanningComplete, readPlanSync } from '../../../lib/vbrief/io.js';
import { appendContinueSessionEntryForIssue } from '../../../lib/vbrief/lifecycle-io.js';
import {
  completePlanningForIssue,
} from '../../../lib/overdeck/planning-promotion.js';
import {
  abortPlanningForIssue,
  getPlanningState,
  restartFromPlan,
  startPlanningForIssue,
} from '../../../lib/overdeck/planning-sessions.js';
import { generateTasksForIssue } from '../../../lib/overdeck/task-generation.js';
import { loadWorkspaceMetadataSync as loadWorkspaceMetadataStatic } from '../../../lib/remote/workspace-metadata.js';
import { resolveGitHubIssueSync as resolveGitHubIssueShared, resolveTrackerTypeSync } from '../../../lib/tracker-utils.js';
import { clearReviewStatus, getReviewStatusSync } from '../review-status.js';
import { rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { validateOrigin } from './origin-validation.js';
import { reopenWorkspaceState } from '../../../lib/reopen.js';
import { getGitHubConfig, getRallyConfig } from '../services/tracker-config.js';
import { syncCacheSync, getCostsForIssueSync } from '../../../lib/costs/index.js';
import { IssueDataService } from '../services/issue-data-service.js';
import { getSharedIssueService } from '../services/issue-service-singleton.js';
import { CacheService } from '../services/cache-service.js';
import { EventStoreService } from '../services/domain-services.js';
import { resolveIssueHeadlineCost } from '../services/issue-cost-resolver.js';
import { getCachedRunningAgents } from '../services/running-agents-cache.js';
import { invalidateAgentsCache } from './agents.js';
import { IssueLifecycle, type IssueState } from '../services/issue-lifecycle.js';
import { LinearClient } from '../services/linear-client.js';
import { GitHubClient, type GitHubClientError, type GitHubClientShape, type GitHubIssue } from '../services/github-client.js';
import { RallyClient } from '../services/rally-client.js';
import { TrackerApiError } from '../services/typed-errors.js';
import { killSession, listSessionNames, sessionExists } from '../../../lib/tmux.js';
import { getAgentState, getAgentStateSync, saveAgentStateSync, getProviderAuthMode, normalizeAgentId } from '../../../lib/agents.js';
import { loadRemoteAgentState } from '../../../lib/remote/remote-agents.js';
import { saveAgentStateAndEmitEvent, saveAgentStateAndEmitEventProgram } from '../services/agent-projection.js';
import { countPendingAskUserQuestionsForAgent } from '../../../lib/agent-enrichment.js';
import { canUseHarnessSync } from '../../../lib/harness-policy.js';
import { emitActivityEntrySync, emitActivityTtsSync } from '../../../lib/activity-logger.js';
import type { LifecycleContext, StepResult, WorkflowResult } from '../../../lib/lifecycle/types.js';
import { withConcurrencyLimit } from '../../../lib/concurrency.js';
import { operatorInterventionEvent } from '../../../lib/operator-interventions.js';
import {
  getCachedResourceAllocatedIssues,
  getResourceDetailIdentifiers,
  sanitizeResourceAllocatedIssues,
} from '../services/resource-discovery.js';
import {
  fetchIssueCheckRuns,
  fetchIssuePullRequest,
  fetchIssuePullRequestDetails,
  fetchIssuePullRequestDiff,
} from '../../../lib/overdeck/pull-requests.js';
import { fetchIssueDiscussions } from '../../../lib/overdeck/discussions.js';
import {
  cleanupAgentStateDirs,
  cleanupWorkspaceForIssue,
  copySettingsToWorkspace,
  deepWipeIssue,
  removeCompletionMarker,
} from '../../../lib/overdeck/workspace-hygiene.js';
import { runDestructiveIssueLifecycle } from '../../../lib/overdeck/issue-transitions.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// ─── Shared IssueDataService singleton ───────────────────────────────────────
// Started by main.ts on boot. Updates flow through the ReadModel via
// onIssuesChanged callback → event store → WebSocket RPC.

function getIssueDataService(): IssueDataService {
  return getSharedIssueService();
}

// ─── Local helpers ────────────────────────────────────────────────────────────

function isGitHubIssue(issueId: string): {
  isGitHub: boolean;
  owner?: string;
  repo?: string;
  number?: number;
} {
  const resolved = resolveGitHubIssueShared(issueId);
  if (resolved.isGitHub) {
    return { isGitHub: true, owner: resolved.owner, repo: resolved.repo, number: resolved.number };
  }
  return { isGitHub: false };
}

function getGitHubLocalPaths(): Record<string, string> {
  const ghConfig = getGitHubConfig();
  if (!ghConfig) return {};
  const out: Record<string, string> = {};
  for (const r of ghConfig.repos) {
    const localPath = (r as { localPath?: unknown }).localPath;
    if (typeof localPath === 'string') {
      out[`${r.owner}/${r.repo}`] = localPath;
    }
  }
  return out;
}

function getProjectPath(linearProjectId?: string, issuePrefix?: string): string {
  if (issuePrefix) {
    const issueId = `${issuePrefix}-1`;
    const resolved = resolveProjectFromIssueSync(issueId);
    if (resolved) return resolved.projectPath;
  }
  if (issuePrefix) {
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

async function pathIsDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

// ─── Route: GET /api/issues ───────────────────────────────────────────────────

const getIssuesRoute = HttpRouter.add(
  'GET',
  '/api/issues',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const urlOpt = HttpServerRequest.toURL(request);
    if (Option.isNone(urlOpt)) {
      return jsonResponse({ error: 'Bad Request' }, { status: 400 });
    }
    const searchParams = urlOpt.value.searchParams;
    const cycle = searchParams.get('cycle') ?? undefined;
    const includeCompleted = searchParams.get('includeCompleted') === 'true';

    const issueDataService = getIssueDataService();
    const issues = issueDataService.getIssues({ cycle, includeCompleted });
    return jsonResponse(issues);
  })),
);

// ─── Route: GET /api/issues/:id/analyze ──────────────────────────────────────

const getIssueAnalyzeRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/analyze',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const linear = yield* LinearClient;

    const issue = yield* Effect.promise(() =>
      Effect.runPromise(linear.getIssue(id).pipe(Effect.catch(() => Effect.succeed(null)))),
    );

    if (!issue) {
      return jsonResponse({ error: 'Issue not found' }, { status: 404 });
    }

    const desc = (issue.description || '').toLowerCase();
    const title = issue.title.toLowerCase();
    const combined = `${title} ${desc}`;

    const reasons: string[] = [];
    const subsystems: string[] = [];
    let estimatedTasks = 1;

    if (combined.includes('frontend') || combined.includes('ui') || combined.includes('component')) subsystems.push('frontend');
    if (combined.includes('backend') || combined.includes('api') || combined.includes('endpoint')) subsystems.push('backend');
    if (combined.includes('database') || combined.includes('migration') || combined.includes('schema')) subsystems.push('database');
    if (combined.includes('test') || combined.includes('e2e') || combined.includes('playwright')) subsystems.push('tests');

    if (subsystems.length > 1) {
      reasons.push(`Multiple subsystems involved: ${subsystems.join(', ')}`);
      estimatedTasks += subsystems.length;
    }

    const ambiguousPatterns = ['should we', 'maybe', 'or', 'consider', 'option', 'approach', 'tbd', 'unclear'];
    for (const pattern of ambiguousPatterns) {
      if (combined.includes(pattern)) { reasons.push('Requirements may be ambiguous'); break; }
    }

    const architecturePatterns = ['refactor', 'architecture', 'redesign', 'migrate', 'integration', 'authentication'];
    for (const pattern of architecturePatterns) {
      if (combined.includes(pattern)) {
        reasons.push(`Architecture decision needed: ${pattern}`);
        estimatedTasks += 2;
        break;
      }
    }

    if (desc.length > 500) { reasons.push('Detailed description suggests complexity'); estimatedTasks += 1; }

    const labels = issue.labels.map((l) => l.name);
    const complexLabels = ['complex', 'large', 'epic', 'multi-phase', 'architecture'];
    for (const label of labels) {
      if (complexLabels.some((cl: string) => label.toLowerCase().includes(cl))) {
        reasons.push(`Label indicates complexity: ${label}`);
        estimatedTasks += 2;
      }
    }

    const isComplex = reasons.length >= 2 || subsystems.length > 1 || estimatedTasks >= 4;

    return jsonResponse({
      issue: {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description,
        status: issue.state.name,
        priority: issue.priority,
        url: issue.url,
        labels,
      },
      complexity: {
        isComplex,
        reasons,
        subsystems,
        estimatedTasks: Math.max(estimatedTasks, subsystems.length + 1),
      },
    });
  })),
);

// ─── Route: POST /api/issues/:issueId/close ──────────────────────────────────

const postIssueCloseRoute = HttpRouter.add(
  'POST',
  '/api/issues/:issueId/close',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;

    const { reason } = body as any;
    const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);

    const { close: closeWorkflow } = yield* Effect.promise(() => import('../../../lib/lifecycle/index.js'));
    const githubCheck = isGitHubIssue(issueId);

    const issueDataService = getIssueDataService();
    const issueSource = issueDataService.getIssueSource(issueId);

    const ctx: any = {
      issueId,
      projectPath,
      ...(githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number
        ? { github: { owner: githubCheck.owner, repo: githubCheck.repo, number: githubCheck.number } }
        : {}),
    };

    if (issueSource === 'rally') {
      const rallyConfig = getRallyConfig();
      if (rallyConfig) {
        ctx.rally = {
          apiKey: rallyConfig.apiKey,
          server: rallyConfig.server,
          workspace: rallyConfig.workspace,
          project: rallyConfig.project,
        };
      }
    }

    const result = yield* closeWorkflow(ctx, { reason });

    if (githubCheck.isGitHub) {
      execAsync('pan sync', { encoding: 'utf-8', timeout: 30000 }).catch(() => {});
    }

    // Invalidate tracker caches (fire and forget)
    if (githubCheck.isGitHub) {
      issueDataService.invalidateTracker('github').catch(() => {});
    } else if (issueSource === 'rally') {
      issueDataService.invalidateTracker('rally').catch(() => {});
    } else {
      issueDataService.invalidateTracker('linear').catch(() => {});
    }

    if (result.success) {
      yield* eventStore.append({
        type: 'issues.updated',
        timestamp: new Date().toISOString(),
        payload: { issueId },
      });
    }

    return jsonResponse({
      success: result.success,
      message: result.success
        ? `Closed ${issueId}${reason ? ': ' + reason : ''}`
        : `Close failed for ${issueId}`,
      steps: result.steps,
    });
  })),
);

// ─── Route: POST /api/issues/:id/start-planning ──────────────────────────────

const postIssueStartPlanningRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/start-planning',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;
    const linear = yield* LinearClient;
    const github = yield* GitHubClient;
    const rally = yield* RallyClient;
    const lifecycle = yield* IssueLifecycle;

    return yield* startPlanningForIssue({ id, body, eventStore, linear, github, rally, lifecycle });
  })),
);

// ─── Route: POST /api/issues/:id/abort-planning ──────────────────────────────

const postIssueAbortPlanningRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/abort-planning',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const body = yield* readJsonBody;
    const lifecycle = yield* IssueLifecycle;
    const linear = yield* LinearClient;
    const eventStore = yield* EventStoreService;

    return yield* abortPlanningForIssue({ id, body, lifecycle, linear, eventStore });
  })),
);

// ─── Route: POST /api/issues/:id/complete-planning ───────────────────────────

const postIssueCompletePlanningRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/complete-planning',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;
    const linear = yield* LinearClient;
    const lifecycle = yield* IssueLifecycle;
    return yield* Effect.promise(() => completePlanningForIssue({
      request,
      id,
      body,
      eventStore,
      linear,
      lifecycle,
    }));
  })),
);

// ─── Route: POST /api/issues/:id/abort ───────────────────────────────────────

const postIssueAbortRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/abort',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const eventStore = yield* EventStoreService;

    // PAN-1908: capture agent state before destruction so the stopped event can
    // be projected through the transactional boundary after the reset succeeds.
    const workAgentId = `agent-${id.toLowerCase()}`;
    const planningAgentId = `planning-${id.toLowerCase()}`;
    const workAgentStateBeforeAbort = yield* getAgentState(workAgentId);

    const result = yield* Effect.promise(() => runDestructiveIssueLifecycle(id, 'reset', { deleteWorkspace: true }));

    if (result.success) {
      // PAN-1908: write-through projection for the real work agent.
      if (workAgentStateBeforeAbort) {
        yield* saveAgentStateAndEmitEventProgram(workAgentStateBeforeAbort, {
          type: 'agent.stopped',
          timestamp: new Date().toISOString(),
          payload: { agentId: workAgentId, issueId: workAgentStateBeforeAbort.issueId },
        }).pipe(Effect.catch(() => Effect.void));
      }
      // Planning sessions are not agents in the runtime registry; keep raw emit.
      yield* eventStore.append({
        type: 'agent.stopped',
        timestamp: new Date().toISOString(),
        payload: { agentId: planningAgentId },
      } as any).pipe(Effect.catch(() => Effect.void));
      yield* eventStore.append({
        type: 'issue.statusChanged',
        timestamp: new Date().toISOString(),
        payload: { issueId: id, status: 'Todo', canonicalStatus: 'todo' },
      });
      yield* eventStore.append({
        type: 'workspace.destroyed',
        timestamp: new Date().toISOString(),
        payload: { issueId: id },
      });
      try { getIssueDataService().patchIssue(id, { status: 'Todo', canonicalStatus: 'todo' }); } catch { /* non-fatal */ }
    }

    const responseBody = {
      success: result.success,
      message: result.success ? `Reset ${id} to Todo` : `Reset completed with errors for ${id}`,
      cleanupLog: result.cleanupLog,
      error: result.error,
    };
    return result.success
      ? jsonResponse(responseBody)
      : jsonResponse(responseBody, { status: 500 });
  })),
);

// ─── Route: POST /api/issues/:id/reset ───────────────────────────────────────

const postIssueResetRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/reset',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;

    const { deleteWorkspace = true } = body as any || {};

    // PAN-1908: capture agent state before destruction so the stopped event can
    // be projected through the transactional boundary after the reset succeeds.
    const workAgentId = `agent-${id.toLowerCase()}`;
    const planningAgentId = `planning-${id.toLowerCase()}`;
    const workAgentStateBeforeReset = yield* getAgentState(workAgentId);

    const encoder = new TextEncoder();
    const nodeStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const sendEvent = (data: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        sendEvent({ type: 'started', issueId: id });

        await Effect.runPromise(eventStore.append({
          type: 'workspace.wipe_started',
          timestamp: new Date().toISOString(),
          payload: { issueId: id },
        }));

        const result = await runDestructiveIssueLifecycle(id, 'reset', {
          deleteWorkspace,
          onProgress: sendEvent,
        });

        if (result.success) {
          // PAN-1908: write-through projection for the real work agent.
          if (workAgentStateBeforeReset) {
            try {
              saveAgentStateAndEmitEvent(workAgentStateBeforeReset, {
                type: 'agent.stopped',
                timestamp: new Date().toISOString(),
                payload: { agentId: workAgentId, issueId: workAgentStateBeforeReset.issueId },
              });
            } catch { /* non-fatal */ }
          }
          // Planning sessions are not agents in the runtime registry; keep raw emit.
          try {
            await Effect.runPromise(eventStore.append({
              type: 'agent.stopped',
              timestamp: new Date().toISOString(),
              payload: { agentId: planningAgentId },
            } as any));
          } catch { /* non-fatal */ }
          await Effect.runPromise(eventStore.append({
            type: 'issue.statusChanged',
            timestamp: new Date().toISOString(),
            payload: { issueId: id, status: 'Todo', canonicalStatus: 'todo' },
          }));
          await Effect.runPromise(eventStore.append({
            type: 'workspace.destroyed',
            timestamp: new Date().toISOString(),
            payload: { issueId: id },
          }));
          try { getIssueDataService().patchIssue(id, { status: 'Todo', canonicalStatus: 'todo' }); } catch { /* non-fatal */ }
          sendEvent({ type: 'complete', message: `Reset completed for ${id}` });
        } else {
          sendEvent({ type: 'error', error: result.error || 'Reset failed' });
        }
        controller.close();
      },
    });

    const effectStream = Stream.fromReadableStream<Uint8Array, unknown>({
      evaluate: () => nodeStream,
      onError: (err) => err,
    });

    return HttpServerResponse.stream(effectStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  })),
);

// ─── Route: POST /api/issues/:id/cancel ──────────────────────────────────────

const postIssueCancelRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/cancel',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;

    const { wipeWorkspace = true } = body as any;
    const result = yield* Effect.promise(() => runDestructiveIssueLifecycle(id, 'cancel', { deleteWorkspace: wipeWorkspace }));

    if (result.success) {
      yield* eventStore.append({
        type: 'issue.statusChanged',
        timestamp: new Date().toISOString(),
        payload: { issueId: id, status: 'Canceled', canonicalStatus: 'canceled' },
      });
      try { getIssueDataService().patchIssue(id, { status: 'Canceled', canonicalStatus: 'canceled' }); } catch { /* non-fatal */ }
    }

    const responseBody = {
      success: result.success,
      message: result.success ? `Canceled ${id}` : `Cancel completed with errors for ${id}`,
      cleanupLog: result.cleanupLog,
      error: result.error,
    };
    return result.success
      ? jsonResponse(responseBody)
      : jsonResponse(responseBody, { status: 500 });
  })),
);

// ─── Route: POST /api/issues/:id/reopen ──────────────────────────────────────

const postIssueReopenRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/reopen',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }

    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;

    const body = yield* readJsonBody;
    const lifecycle = yield* IssueLifecycle;
    const linear = yield* LinearClient;
    const eventStore = yield* EventStoreService;

    const { reason: _reason } = body as any || {};
    const githubCheck = isGitHubIssue(id);

    const issueDataService = getIssueDataService();
    const issueSource = issueDataService.getIssueSource(id);

    const reviewStatus = getReviewStatusSync(id.toUpperCase());
    const cachedIssue = issueDataService.getIssues()
      .find((issue: any) => String(issue.identifier ?? issue.id ?? '').toUpperCase() === id.toUpperCase());
    const reopenToVerifying = reviewStatus?.mergeStatus === 'merged' || cachedIssue?.mergeStatus === 'merged';
    const targetState: IssueState = reopenToVerifying ? 'verifying_on_main' : 'in_progress';
    const targetCanonicalStatus = targetState;

    let newState = reopenToVerifying ? 'Verifying on Main' : 'In Progress';
    let issueIdentifier = id;

    yield* lifecycle.transitionTo(id, targetState).pipe(Effect.catch(() => Effect.void));

    if (issueSource === 'rally') {
      issueDataService.invalidateTracker('rally').catch(() => {});
      if (!reopenToVerifying) newState = 'Open';

    } else if (githubCheck.isGitHub) {
      if (!reopenToVerifying) {
        yield* lifecycle.removeLabel(id, 'done').pipe(Effect.catch(() => Effect.void));
        yield* lifecycle.removeLabel(id, 'needs-close-out').pipe(Effect.catch(() => Effect.void));
        yield* lifecycle.removeLabel(id, 'merged').pipe(Effect.catch(() => Effect.void));
      }

      // Reopen closed (not merged) PR for the feature branch if one exists
      yield* Effect.promise(async () => {
        try {
          const branchName = `feature/${id.toLowerCase()}`;
          const { stdout } = await execAsync(
            `gh pr list --head ${branchName} --state closed --json number,mergedAt --limit 1`,
            { encoding: 'utf-8', timeout: 15000 }
          );
          const prs = JSON.parse(stdout.trim() || '[]');
          if (prs.length > 0 && !prs[0].mergedAt) {
            await execAsync(`gh pr reopen ${prs[0].number}`, { encoding: 'utf-8', timeout: 15000 });
            console.log(`[reopen] Reopened PR #${prs[0].number} for ${id}`);
          }
        } catch (err: any) {
          console.warn(`[reopen] Could not reopen PR for ${id}: ${err.message}`);
        }
      });

      issueDataService.invalidateTracker('github').catch(() => {});
      if (!reopenToVerifying) newState = 'In Progress';

    } else {
      const updatedIssue = yield* linear.getIssue(id).pipe(Effect.catch(() => Effect.succeed(null)));
      issueIdentifier = updatedIssue?.identifier ?? id;
      if (!reopenToVerifying) newState = updatedIssue?.state.name ?? 'In Progress';
      issueDataService.invalidateTracker('linear').catch(() => {});
    }

    // Reset specialist pipeline state, post-merge state, and agent markers (all non-fatal)
    yield* Effect.promise(async () => {
      // Reset specialist pipeline state, remove from queues, and update continue file
      // via reopenWorkspaceState (shared logic with `pan reopen` CLI command)
      try {
        const teamPrefix = extractTeamPrefix(id);
        const projectConfig = teamPrefix ? findProjectByTeamSync(teamPrefix) : null;
        const projectPath = projectConfig?.path || '';
        const workspacePath = projectPath
          ? join(projectPath, 'workspaces', `feature-${id.toLowerCase()}`)
          : '';
        if (workspacePath) {
          await Effect.runPromise(reopenWorkspaceState(id.toUpperCase(), workspacePath, { reason: (body as any)?.reason }));
        } else {
          // Fallback: no workspace path, just clear review status
          clearReviewStatus(id.toUpperCase());
        }
      } catch { /* non-fatal */ }

      // Reset post-merge state
      try {
        const { resetPostMergeState } = await import('../../../lib/cloister/merge-agent.js');
        resetPostMergeState(id);
        resetPostMergeState(id.toUpperCase());
      } catch { /* non-fatal */ }

      // Clear agent completion markers so Deacon doesn't re-dispatch to specialists
      try {
        const agentDir = join(homedir(), '.overdeck', 'agents', `agent-${id.toLowerCase()}`);
        for (const marker of ['completed', 'completed.processed']) {
          const markerPath = join(agentDir, marker);
          await removeCompletionMarker(markerPath);
          if (!existsSync(markerPath)) console.log(`[reopen] Cleared ${marker} marker for ${id}`);
        }
      } catch { /* non-fatal */ }
    });

    // Recreate beads from vBRIEF plan if workspace exists but beads are missing
    const beadsRecreated = yield* Effect.promise(async (): Promise<boolean> => {
      try {
        const issueLower = id.toLowerCase();
        const teamPrefix = extractTeamPrefix(id);
        const projectConfig = teamPrefix ? findProjectByTeamSync(teamPrefix) : null;
        const projectPath = projectConfig?.path || '';
        if (projectPath) {
          const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
          const { createBeadsFromVBrief } = await import('../../../lib/vbrief/beads.js');
          if (existsSync(workspacePath) && await Effect.runPromise(findPlan(workspacePath))) {
            try {
              const { stdout: bdCheck } = await Effect.runPromise(withBdMutex(() => Effect.promise(() => execFileAsync(
                'bd',
                ['list', '--json', '-l', issueLower, '--limit', '1'],
                { cwd: workspacePath, encoding: 'utf-8', timeout: 10000 },
              ))));
              const existing = JSON.parse(bdCheck.trim() || '[]');
              if (existing.length === 0) {
                const result = await Effect.runPromise(createBeadsFromVBrief(workspacePath));
                if (result.created.length > 0) {
                  console.log(`[reopen] Recreated ${result.created.length} beads for ${id} from vBRIEF plan`);
                  return true;
                }
              }
            } catch { /* Non-fatal — beads recreation is best-effort */ }
          }
        }
      } catch { /* non-fatal */ }
      return false;
    });

    yield* eventStore.append({
      type: 'issue.statusChanged',
      timestamp: new Date().toISOString(),
      payload: { issueId: issueIdentifier, status: newState, canonicalStatus: targetCanonicalStatus },
    });
    // Emit pipeline reset so frontend read model clears the stale readyForMerge badge
    yield* eventStore.append({
      type: 'pipeline.status_changed',
      timestamp: new Date().toISOString(),
      payload: {
        issueId: issueIdentifier,
        status: {
          issueId: issueIdentifier,
          reviewStatus: 'pending',
          testStatus: 'pending',
          readyForMerge: false,
        },
      },
    });
    try { getIssueDataService().patchIssue(issueIdentifier, { status: newState, canonicalStatus: targetCanonicalStatus }); } catch { /* non-fatal */ }

    return jsonResponse({
      success: true,
      message: `Issue ${id} reopened and moved to ${newState}${beadsRecreated ? ' (beads recreated from plan)' : ''}`,
      issueId: issueIdentifier,
      newState,
      resetSummary: null,
      agentRunning: false,
      nextStep: `Start an agent: pan start ${id}`,
    });
  })),
);

// ─── Route: POST /api/issues/:id/restart-from-plan ────────────────────────────

const postIssueRestartFromPlanRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/restart-from-plan',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const lifecycle = yield* IssueLifecycle;
    const eventStore = yield* EventStoreService;

    return yield* restartFromPlan({ id, lifecycle, eventStore });
  })),
);

// ─── Route: POST /api/issues/:id/move-status ─────────────────────────────────

const postIssueMoveStatusRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/move-status',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;
    const lifecycle = yield* IssueLifecycle;

    const { targetStatus, syncToTracker = false } = body as any || {};

    const validStatuses = ['backlog', 'todo', 'in_progress', 'in_review', 'done'];
    if (!targetStatus || !validStatuses.includes(targetStatus)) {
      return jsonResponse(
        { error: `Invalid targetStatus. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 },
      );
    }

    const { updateShadowState } = yield* Effect.promise(() => import('../../../lib/shadow-state.js'));

    const canonicalToIssueState: Record<string, 'open' | 'in_progress' | 'closed'> = {
      backlog: 'open', todo: 'open', in_progress: 'in_progress', in_review: 'in_progress', done: 'closed',
    };
    const issueState = canonicalToIssueState[targetStatus];

    const shadowResult = yield* updateShadowState(id, issueState, 'dashboard-drag-drop', targetStatus);

    const issueDataService = getIssueDataService();
    // Refresh the in-memory shadow-state cache so subsequent getIssues() calls
    // see this drag-drop change without hitting the disk.
    yield* Effect.promise(() => issueDataService.refreshShadowStatesCache());
    const issueSource = issueDataService.getIssueSource(id);
    const githubCheck = isGitHubIssue(id);

    if (syncToTracker) {
      // Map canonical status to IssueState for the lifecycle service
      const canonicalToLifecycleState: Record<string, IssueState> = {
        backlog: 'open', todo: 'open', in_progress: 'in_progress', in_review: 'in_review', done: 'closed',
      };
      const lifecycleState = canonicalToLifecycleState[targetStatus];

      if (lifecycleState) {
        yield* lifecycle.transitionTo(id, lifecycleState).pipe(
          Effect.catch((err) =>
            Effect.sync(() => console.error(`Tracker sync failed for ${id}:`, String(err))),
          ),
        );
      }
    }

    // Invalidate tracker caches
    if (githubCheck.isGitHub) {
      issueDataService.invalidateTracker('github').catch(() => {});
    } else if (issueSource === 'rally') {
      issueDataService.invalidateTracker('rally').catch(() => {});
    } else {
      issueDataService.invalidateTracker('linear').catch(() => {});
    }

    const canonicalToDisplay: Record<string, string> = {
      backlog: 'Backlog', todo: 'Todo', in_progress: 'In Progress',
      in_review: 'In Review', done: 'Done',
    };

    const displayStatus = canonicalToDisplay[targetStatus] || targetStatus;
    yield* eventStore.append({
      type: 'issue.statusChanged',
      timestamp: new Date().toISOString(),
      payload: { issueId: id, status: displayStatus, canonicalStatus: targetStatus },
    });

    try { issueDataService.patchIssue(id, { status: displayStatus, canonicalStatus: targetStatus }); } catch { /* non-fatal */ }

    return jsonResponse({
      success: true,
      message: `Issue ${id} moved to ${targetStatus}`,
      issueId: id,
      newStatus: targetStatus,
      syncToTracker,
      shadowState: shadowResult,
    });
  })),
);

// ─── Route: POST /api/issues/:id/cleanup-workspace ───────────────────────────

const postIssueCleanupWorkspaceRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/cleanup-workspace',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const rawId = params['id'] ?? '';
    const eventStore = yield* EventStoreService;
    return yield* Effect.promise(() => cleanupWorkspaceForIssue(rawId, eventStore));
  })),
);

// ─── Route: POST /api/issues/:id/deep-wipe ───────────────────────────────────

const postIssueDeepWipeRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/deep-wipe',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;
    return yield* Effect.promise(() => deepWipeIssue(id, body, eventStore));
  })),
);

// ─── Route: POST /api/issues/:id/copy-settings ───────────────────────────────

const postIssueCopySettingsRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/copy-settings',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    return yield* Effect.promise(() => copySettingsToWorkspace(id));
  })),
);

function buildCloseOutContext(id: string): LifecycleContext | null {
  const resolvedProject = resolveProjectFromIssueSync(id);
  if (!resolvedProject) return null;

  const githubCheck = isGitHubIssue(id);
  return {
    issueId: id,
    projectPath: resolvedProject.projectPath,
    projectName: resolvedProject.projectName,
    ...(githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number
      ? { github: { owner: githubCheck.owner, repo: githubCheck.repo, number: githubCheck.number } }
      : {}),
  };
}

function closeOutFailureResponse(result: WorkflowResult) {
  const failedStep = result.steps.find((s: StepResult) => !s.success && !s.skipped);
  return jsonResponse({
    ...result,
    error: failedStep?.error ?? 'Close-out workflow failed',
    failedStep,
  }, { status: 422 });
}

const CLOSED_OUT_CACHE_WORKFLOW_LABELS = new Set([
  'in-review',
  'in-progress',
  'needs-close-out',
  'verifying-on-main',
]);

function buildClosedOutCacheLabels(labels: string[]): string[] {
  return [
    ...labels.filter((label) => {
      const normalized = label.toLowerCase();
      return normalized !== 'closed-out' && !CLOSED_OUT_CACHE_WORKFLOW_LABELS.has(normalized);
    }),
    'closed-out',
  ];
}

function sanitizeCloseOutError(error: unknown): string {
  console.error('Close-out route failed:', error);
  return 'Internal server error';
}

function getCachedIssueForCloseOut(issueDataService: IssueDataService, issueId: string): any | undefined {
  return issueDataService.getIssues().find(
    (issue: any) => String(issue.identifier ?? issue.id ?? '').toUpperCase() === issueId.toUpperCase(),
  );
}

function isCachedIssueClosedOut(issue: any | undefined): boolean {
  return Array.isArray(issue?.labels)
    && issue.labels.some((label: unknown) => String(label).toLowerCase() === 'closed-out');
}

function closeOutAlreadyCompletedResult(issueId: string): WorkflowResult {
  return {
    workflow: 'close-out',
    issueId,
    success: true,
    steps: [{ step: 'close-out:idempotent', success: true, skipped: true, details: ['Issue already closed out'] }],
    duration: 0,
  };
}

// ─── Route: POST /api/issues/:id/close-out ───────────────────────────────────

const postIssueCloseOutRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/close-out',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }

    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;

    const ctx = buildCloseOutContext(id);
    if (!ctx) {
      return jsonResponse({ error: `Could not resolve project for ${id}` }, { status: 404 });
    }

    const eventStore = yield* EventStoreService;
    const issueDataService = getIssueDataService();
    if (isCachedIssueClosedOut(getCachedIssueForCloseOut(issueDataService, id))) {
      return jsonResponse(closeOutAlreadyCompletedResult(id));
    }
    const issueSource = issueDataService.getIssueSource(id);

    if (issueSource === 'rally') {
      const rallyConfig = getRallyConfig();
      if (rallyConfig) {
        ctx.rally = {
          apiKey: rallyConfig.apiKey,
          server: rallyConfig.server,
          workspace: rallyConfig.workspace,
          project: rallyConfig.project,
        };
      }
    }

    const closeOutResult = yield* Effect.promise(async () => {
      try {
        const { closeOut } = await import('../../../lib/lifecycle/index.js');
        // PAN-1249: closeOut returns Effect<WorkflowResult>; bridge to Promise.
        const result = await Effect.runPromise(closeOut(ctx));
        return { ok: true as const, result };
      } catch (error) {
        return { ok: false as const, error };
      }
    });

    if (!closeOutResult.ok) {
      return jsonResponse({ error: sanitizeCloseOutError(closeOutResult.error) }, { status: 500 });
    }

    const result = closeOutResult.result;
    if (!result.success) {
      return closeOutFailureResponse(result);
    }

    let newLabels: string[] = ['closed-out'];
    try {
      const cachedIssues = issueDataService.getIssues();
      const cachedIssue = cachedIssues.find(
        (i: any) => (i.identifier || '').toUpperCase() === id.toUpperCase()
      );
      const currentLabels: string[] = cachedIssue?.labels || [];
      newLabels = buildClosedOutCacheLabels(currentLabels);
      issueDataService.patchIssue(id, {
        status: 'Done',
        state: 'done',
        canonicalStatus: 'done',
        targetCanonicalState: 'done',
        mergeStatus: undefined,
        labels: newLabels,
      });
    } catch { /* non-fatal */ }

    yield* eventStore.append({
      type: 'issue.statusChanged',
      timestamp: new Date().toISOString(),
      payload: { issueId: id, status: 'Done', state: 'done', canonicalStatus: 'done', labels: newLabels },
    });

    issueDataService.invalidateTracker('github').catch(() => {});
    issueDataService.invalidateTracker('linear').catch(() => {});
    issueDataService.invalidateTracker('rally').catch(() => {});

    return jsonResponse(result);
  })),
);

const MAX_BULK_CLOSE_OUT = 50;

const VALID_TMUX_NAME_RE = /^[a-zA-Z0-9._-]+$/;

/** Normalize an issue ID to a planning session name, mirroring normalizeAgentId logic. */
function normalizePlanningId(issueId: string): string {
  if (issueId.startsWith('planning-')) return issueId;
  return `planning-${issueId.toLowerCase()}`;
}

function isInactiveAgentStatus(status: string | undefined): boolean {
  return status === 'dead' || status === 'stopped' || status === 'failed';
}

function isPausedMergedAgentSafe(agentState: { paused?: boolean } | null | undefined, allowPausedMerged: boolean): boolean {
  return allowPausedMerged && agentState?.paused === true;
}

async function hasActiveAgentForIssue(issueId: string, allowPausedMerged = false): Promise<boolean> {
  const agentId = normalizeAgentId(issueId);
  const planningId = normalizePlanningId(issueId);

  return Effect.runPromise(Effect.gen(function* () {
    // Only query tmux for valid session names (GitHub IDs like owner/repo#123 produce invalid names)
    if (VALID_TMUX_NAME_RE.test(agentId) && (yield* sessionExists(agentId))) return true;
    if (VALID_TMUX_NAME_RE.test(planningId) && (yield* sessionExists(planningId))) return true;

    const agentState = yield* getAgentState(agentId);
    if (agentState && !isInactiveAgentStatus(agentState.status) && !isPausedMergedAgentSafe(agentState, allowPausedMerged)) return true;

    const planningState = yield* getAgentState(planningId);
    if (planningState && !isInactiveAgentStatus(planningState.status) && !isPausedMergedAgentSafe(planningState, allowPausedMerged)) return true;

    return false;
  }));
}

// ─── Route: POST /api/issues/bulk-close-out ──────────────────────────────────

/** Validate issue ID format (PAN-123, TEAM-456, or GitHub owner/repo#number) */
function isValidIssueId(id: string): boolean {
  if (typeof id !== 'string') return false;
  // Linear-style: PREFIX-123
  if (/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(id)) return true;
  // GitHub-style: owner/repo#number (alphanumeric, hyphens, underscores, periods only)
  if (/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+#\d+$/.test(id)) return true;
  return false;
}

const postIssuesBulkCloseOutRoute = HttpRouter.add(
  'POST',
  '/api/issues/bulk-close-out',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;

    const text = yield* request.text;
    const body: Record<string, unknown> = (() => { try { return text ? JSON.parse(text) : {}; } catch { return {}; } })();
    const rawIssueIds = Array.isArray(body.issueIds) ? body.issueIds : [];
    const issueIds = [...new Set(rawIssueIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))];

    // Input validation
    if (issueIds.length === 0) {
      return jsonResponse({ error: 'issueIds array is required' }, { status: 400 });
    }
    if (issueIds.length > MAX_BULK_CLOSE_OUT) {
      return jsonResponse({ error: `Maximum ${MAX_BULK_CLOSE_OUT} issues allowed` }, { status: 400 });
    }

    const invalidIds = issueIds.filter(id => !isValidIssueId(id));
    if (invalidIds.length > 0) {
      return jsonResponse({ error: `Invalid issue ID format: ${invalidIds.join(', ')}` }, { status: 400 });
    }

    const eventStore = yield* EventStoreService;
    const { closeOut } = yield* Effect.promise(() => import('../../../lib/lifecycle/index.js'));
    const issueDataService = getIssueDataService();

    // Pre-validate all issues: run agent checks in parallel, then build contexts.
    // CloseOut runs with bounded concurrency (max 3) to avoid unbounded
    // resource use while keeping git index-lock risk low for independent issues.
    type CloseOutTask = { id: string; ctx: LifecycleContext } | { id: string; skipped: true; error: string };
    const tasks: CloseOutTask[] = [];

    const agentChecks = yield* withConcurrencyLimit(
      issueIds.map(id => Effect.promise(async () => {
        const cachedIssue = issueDataService.getIssues().find(
          (issue: any) => (issue.identifier || '').toUpperCase() === id.toUpperCase(),
        );
        const reviewStatus = getReviewStatusSync(id.toUpperCase());
        const allowPausedMerged = reviewStatus?.mergeStatus === 'merged' || cachedIssue?.mergeStatus === 'merged';
        const hasActiveAgent = await hasActiveAgentForIssue(id, allowPausedMerged);
        return { id, hasActiveAgent };
      })),
      10
    );

    for (const { id, hasActiveAgent } of agentChecks) {
      if (hasActiveAgent) {
        tasks.push({ id, skipped: true, error: 'Skipped: active agent running' });
        continue;
      }

      const githubCheck = isGitHubIssue(id);
      let projectPath = '';

      if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
        const localPaths = getGitHubLocalPaths();
        projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`] || '';
      }
      if (!projectPath) {
        const issuePrefix = extractPrefixSync(id);
        if (issuePrefix) {
          projectPath = getProjectPath(undefined, issuePrefix);
        }
      }
      if (!projectPath) {
        tasks.push({ id, skipped: true, error: `Could not resolve project path for ${id}` });
        continue;
      }

      const ctx: LifecycleContext = {
        issueId: id,
        projectPath,
        ...(githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number
          ? { github: { owner: githubCheck.owner, repo: githubCheck.repo, number: githubCheck.number } }
          : {}),
      };

      const issueSource = issueDataService.getIssueSource(id);
      if (issueSource === 'rally') {
        const rallyConfig = getRallyConfig();
        if (rallyConfig) {
          ctx.rally = {
            apiKey: rallyConfig.apiKey,
            server: rallyConfig.server,
            workspace: rallyConfig.workspace,
            project: rallyConfig.project,
          };
        }
      }

      tasks.push({ id, ctx });
    }

    const closeOutTasks = tasks
      .filter((t): t is { id: string; ctx: LifecycleContext } => !('skipped' in t))
      .map(({ id, ctx }) => Effect.promise(async () => {
        try {
          const closeResult = await Effect.runPromise(closeOut(ctx));
          return { id, closeResult };
        } catch (error) {
          const closeResult: WorkflowResult = {
            workflow: 'close-out',
            issueId: id,
            success: false,
            steps: [{
              step: 'close-out',
              success: false,
              skipped: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }],
            duration: 0,
          };
          return { id, closeResult };
        }
      }));

    const closeOutResults = yield* withConcurrencyLimit(closeOutTasks, 3);

    const results: Array<{ issueId: string; success: boolean; error?: string; skipped: boolean }> = [];
    for (const { id, closeResult } of closeOutResults) {
      if (closeResult.success) {
        let newLabels: string[] = ['closed-out'];
        try {
          const cachedIssues = issueDataService.getIssues();
          const cachedIssue = cachedIssues.find(
            (i: any) => (i.identifier || '').toUpperCase() === id.toUpperCase()
          );
          const currentLabels: string[] = cachedIssue?.labels || [];
          newLabels = buildClosedOutCacheLabels(currentLabels);
          issueDataService.patchIssue(id, {
            status: 'Done',
            state: 'done',
            canonicalStatus: 'done',
            targetCanonicalState: 'done',
            mergeStatus: undefined,
            labels: newLabels,
          });
        } catch (e) {
          console.error('Failed to patch issue status:', e);
        }
        yield* eventStore.append({
          type: 'issue.statusChanged',
          timestamp: new Date().toISOString(),
          payload: { issueId: id, status: 'Done', state: 'done', canonicalStatus: 'done', labels: newLabels },
        });
      }

      const failedStep = closeResult.steps.find((s: StepResult) => !s.success);
      results.push({
        issueId: id,
        success: closeResult.success,
        error: closeResult.success ? undefined : failedStep?.error,
        skipped: false,
      });
    }

    for (const task of tasks) {
      if ('skipped' in task) {
        results.push({ issueId: task.id, success: false, error: task.error, skipped: true });
      }
    }

    // Invalidate trackers once if any issue closed successfully
    const anySucceeded = results.some(r => r.success);
    if (anySucceeded) {
      issueDataService.invalidateTracker('github').catch((e: Error) => { console.error('Failed to invalidate github tracker:', e); });
      issueDataService.invalidateTracker('linear').catch((e: Error) => { console.error('Failed to invalidate linear tracker:', e); });
    }

    return jsonResponse({ results });
  })),
);

// ─── Route: GET /api/issues/:id/beads ────────────────────────────────────────

const getIssueBeadsRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/beads',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }

    const issueLower = id.toLowerCase();
    const githubCheck = isGitHubIssue(id);
    let projectPath = '';

    if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
      const localPaths = getGitHubLocalPaths();
      projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`] || '';
    }
    if (!projectPath) {
      const issuePrefix = extractPrefixSync(id) ?? id.split('-')[0];
      try { projectPath = getProjectPath(undefined, issuePrefix); } catch { projectPath = ''; }
    }

    const workspacePath = projectPath ? join(projectPath, 'workspaces', `feature-${issueLower}`) : '';

    // Check for remote workspace (reads non-fatal state files)
    const { isRemoteWorkspace, remoteVmName } = yield* Effect.promise(async (): Promise<{ isRemoteWorkspace: boolean; remoteVmName: string | null }> => {
      const planningSessionName = `planning-${issueLower}`;
      try {
        const remoteState = loadRemoteAgentState(planningSessionName);
        if (remoteState?.vmName) return { isRemoteWorkspace: true, remoteVmName: remoteState.vmName };
      } catch { /* Ignore */ }

      try {
        const remoteMetadataPath = join(homedir(), '.overdeck', 'agents', planningSessionName, 'remote-workspace.json');
        if (existsSync(remoteMetadataPath)) {
          const remoteMetadata = JSON.parse(await readFile(remoteMetadataPath, 'utf-8'));
          if (remoteMetadata.vmName) return { isRemoteWorkspace: true, remoteVmName: remoteMetadata.vmName };
        }
      } catch { /* Ignore parse errors */ }

      try {
        const wsMetadata = loadWorkspaceMetadataStatic(id);
        if (wsMetadata?.vmName) return { isRemoteWorkspace: true, remoteVmName: wsMetadata.vmName };
      } catch { /* Not a remote workspace */ }

      return { isRemoteWorkspace: false, remoteVmName: null };
    });

    // Try local beads query (non-fatal on bd error)
    const { beads, querySource } = yield* Effect.promise(async (): Promise<{ beads: any[]; querySource: string }> => {
      try {
        const bdSearchDir = (workspacePath && existsSync(workspacePath)) ? workspacePath : (projectPath || homedir());
        const { stdout } = await Effect.runPromise(withBdMutex(() => Effect.promise(() => execFileAsync('bd', ['list', '--json', '-l', id.toLowerCase(), '--status', 'all', '--limit', '0'], {
          cwd: bdSearchDir,
          encoding: 'utf-8',
          timeout: 10000,
        }))));
        return { beads: JSON.parse(stdout || '[]'), querySource: 'local' };
      } catch (bdError: any) {
        console.error('bd search failed:', bdError.message);
        return { beads: [], querySource: 'local' };
      }
    });

    const tasks = beads.map((bead: any) => ({
      id: bead.id,
      title: bead.title,
      status: bead.status,
      type: bead.issue_type || bead.type || 'task',
      blockedBy: bead.blocked_by || [],
      createdAt: bead.created_at,
      startedAt: bead.started_at,
      updatedAt: bead.updated_at,
      closedAt: bead.closed_at,
      labels: bead.labels || [],
      priority: bead.priority,
    }));

    tasks.sort((a: any, b: any) => {
      if (a.priority !== b.priority) return (a.priority || 4) - (b.priority || 4);
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    // Suppress unused variable warning — remoteVmName available for callers if needed
    void remoteVmName;

    return jsonResponse({
      tasks,
      workspacePath,
      count: tasks.length,
      source: querySource,
      isRemote: isRemoteWorkspace,
    });
  })),
);

// ─── Route: POST /api/issues/:id/beads/:beadId/inspect ───────────────────────

function isValidBeadId(beadId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(beadId);
}

const postIssueBeadInspectRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/beads/:beadId/inspect',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;

    const params = yield* HttpRouter.params;
    const id = (params['id'] ?? '').toUpperCase();
    const beadId = params['beadId'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    if (!beadId.trim()) {
      return jsonResponse({ error: 'Missing bead ID' }, { status: 400 });
    }
    if (!isValidBeadId(beadId)) {
      return jsonResponse({ error: 'Invalid bead ID' }, { status: 400 });
    }

    const body = yield* readJsonBody;
    const project = resolveProjectFromIssueSync(id);
    if (!project) {
      return jsonResponse({ error: `Could not resolve project for ${id}` }, { status: 404 });
    }

    const issueLower = id.toLowerCase();
    const workspace = join(project.projectPath, 'workspaces', `feature-${issueLower}`);
    const workspaceExists = yield* Effect.promise(() => pathIsDirectory(workspace));
    if (!workspaceExists) {
      return jsonResponse({ error: `No workspace found for ${id}` }, { status: 404 });
    }

    const result = yield* spawnInspectAgent({
      projectKey: project.projectKey,
      projectPath: project.projectPath,
      issueId: id,
      beadId,
      workspace,
      branch: `feature/${issueLower}`,
    }, { deep: (body as { deep?: unknown }).deep === true });

    if (!result.success) {
      return jsonResponse({ success: false, error: result.error ?? result.message }, { status: 500 });
    }

    if (result.skipped) {
      return jsonResponse({ success: true, skipped: true, message: result.message, tmuxSession: result.tmuxSession });
    }

    return jsonResponse({ success: true, runId: result.runId, tmuxSession: result.tmuxSession });
  })),
);

// ─── Route: GET /api/issues/:id/planning-state ───────────────────────────────
//
// Lightweight summary of an issue's planning artifacts:
//   { hasPlan, hasBeads, beadsCount }
// Used by kanban cards to color the vBRIEF/Tasks chips and decide whether to
// show "Generate Tasks" instead of "Tasks". Cheap so it can be polled per-card.

const getIssuePlanningStateRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/planning-state',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }

    return yield* getPlanningState(id);
  })),
);

// ─── Route: POST /api/issues/:id/generate-tasks ──────────────────────────────
//
// Runs createBeadsFromVBrief() against the workspace. Same logic as
// `pan plan finalize`, exposed so the
// dashboard can offer a one-click "Generate Tasks" action when a vBRIEF plan
// exists but beads were never created (e.g. plans authored before the
// agent-driven finalize flow shipped).

const postIssueGenerateTasksRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/generate-tasks',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }

    return yield* generateTasksForIssue(id);
  })),
);

const getIssuePrRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/pr',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const result = yield* Effect.promise(() => fetchIssuePullRequest(id));
    return jsonResponse(result);
  })),
);

const getIssuePrDiffRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/pr/diff',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const result = yield* Effect.promise(() => fetchIssuePullRequestDiff(id));
    return jsonResponse(result);
  })),
);

const getIssuePrDetailsRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/pr/details',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const result = yield* Effect.promise(() => fetchIssuePullRequestDetails(id));
    return jsonResponse(result);
  })),
);

const getIssueCheckRunsRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/check-runs',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const result = yield* Effect.promise(() => fetchIssueCheckRuns(id));
    return jsonResponse(result);
  })),
);

const getIssueDiscussionsRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/discussions',
  httpHandler(Effect.gen(function* () {
    const linear = yield* LinearClient;
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }

    const linearGetIssueId = async (ref: string): Promise<string | null> => {
      try {
        const issue = await Effect.runPromise(linear.getIssue(ref));
        return issue.id;
      } catch {
        return null;
      }
    };
    const linearGetComments = async (uuid: string) => {
      try {
        const comments = await Effect.runPromise(linear.getComments(uuid));
        return comments.map((c) => ({
          author: c.author,
          body: c.body,
          createdAt: c.createdAt,
        }));
      } catch {
        return [];
      }
    };

    const result = yield* Effect.promise(() =>
      fetchIssueDiscussions(id, { linearGetIssueId, linearGetComments }),
    );
    return jsonResponse(result);
  })),
);

// ─── Route: GET /api/issues/:id/costs ────────────────────────────────────────

const getIssueCostsRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/costs',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!parseIssueIdSync(id)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }

    const issueData = getCostsForIssueSync(id);
    const agents = yield* Effect.promise(() => getCachedRunningAgents());
    const resolvedCost = resolveIssueHeadlineCost({
      issueId: id,
      aggregateCost: issueData?.totalCost,
      agents,
    });

    if (!issueData) {
      return jsonResponse({
        issueId: id.toUpperCase(),
        totalCost: 0,
        resolvedTotalCost: resolvedCost.resolvedTotalCost,
        aggregateCost: resolvedCost.aggregateCost,
        liveCost: resolvedCost.liveCost,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        models: {},
        providers: {},
        byModel: {},
        sessions: [],
        byStage: {},
        budget: undefined,
        budgetWarning: false,
      });
    }

    return jsonResponse({
      issueId: id.toUpperCase(),
      totalCost: issueData.totalCost,
      resolvedTotalCost: resolvedCost.resolvedTotalCost,
      aggregateCost: resolvedCost.aggregateCost,
      liveCost: resolvedCost.liveCost,
      totalTokens: issueData.inputTokens + issueData.outputTokens + issueData.cacheReadTokens + issueData.cacheWriteTokens,
      inputTokens: issueData.inputTokens,
      outputTokens: issueData.outputTokens,
      cacheReadTokens: issueData.cacheReadTokens,
      cacheWriteTokens: issueData.cacheWriteTokens,
      models: issueData.models,
      providers: issueData.providers,
      byModel: Object.fromEntries(
        Object.entries(issueData.models).map(([model, stats]: [string, any]) => [
          model,
          { cost: stats.cost, tokens: stats.tokens },
        ])
      ),
      sessions: (issueData as unknown as { sessions?: unknown[] }).sessions ?? [],
      byStage: Object.fromEntries(
        Object.entries(issueData.stages || {}).map(([stage, stats]: [string, any]) => [
          stage,
          { cost: stats.cost, tokens: stats.tokens },
        ])
      ),
      budget: issueData.budget,
      budgetWarning: issueData.budgetWarning,
      lastUpdated: issueData.lastUpdated,
    });
  })),
);

const getResourceAllocatedIssuesRoute = HttpRouter.add(
  'GET',
  '/api/issues/resource-allocated',
  httpHandler(Effect.gen(function* () {
    const issues = yield* Effect.tryPromise({
      try: async () => sanitizeResourceAllocatedIssues(await getCachedResourceAllocatedIssues()),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
    return jsonResponse(issues);
  })),
);

const getIssueResourceDetailsRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/resource-details',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const rawId = params['id'] ?? '';
    const parsedIssueId = parseIssueIdSync(rawId);
    if (!parsedIssueId) {
      return jsonResponse({ error: 'Invalid issue id: ' + rawId }, { status: 400 });
    }
    const id = parsedIssueId.raw.toUpperCase();

    const details = yield* Effect.tryPromise({
      try: () => getResourceDetailIdentifiers(id),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });

    if (!details) {
      return jsonResponse({ error: `No resource details found for ${id}` }, { status: 404 });
    }

    return jsonResponse(details);
  })),
);

// ─── Compose all routes into a single Layer ───────────────────────────────────

export const issuesRouteLayer = Layer.mergeAll(
  getIssuesRoute,
  getIssueAnalyzeRoute,
  postIssueCloseRoute,
  postIssueStartPlanningRoute,
  postIssueAbortPlanningRoute,
  postIssueCompletePlanningRoute,
  postIssueAbortRoute,
  postIssueResetRoute,
  postIssueCancelRoute,
  postIssueReopenRoute,
  postIssueRestartFromPlanRoute,
  postIssueMoveStatusRoute,
  postIssueCleanupWorkspaceRoute,
  postIssueDeepWipeRoute,
  postIssueCopySettingsRoute,
  postIssueCloseOutRoute,
  postIssuesBulkCloseOutRoute,
  getIssueBeadsRoute,
  postIssueBeadInspectRoute,
  getIssuePlanningStateRoute,
  postIssueGenerateTasksRoute,
  getIssueCostsRoute,
  getResourceAllocatedIssuesRoute,
  getIssueResourceDetailsRoute,
  getIssuePrRoute,
  getIssuePrDiffRoute,
  getIssuePrDetailsRoute,
  getIssueCheckRunsRoute,
  getIssueDiscussionsRoute,
);

export default issuesRouteLayer;

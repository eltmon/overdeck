import { jsonResponse } from "../http-helpers.js";
import { httpHandler } from './http-handler.js';
/**
 * Issues route module — Effect HttpRouter.Layer (PAN-428 B6)
 *
 * Implements all /api/issues/* endpoints from the Express server:
 *   GET  /api/issues
 *   GET  /api/issues/:id/analyze
 *   POST /api/issues/:id/plan
 *   GET  /api/issues/:id/handoffs
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
 *   GET  /api/issues/:id/costs
 */

import { exec, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { spawnPlanningSession, type PlanningIssue } from '../../../lib/planning/spawn-planning-session.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Effect, Layer, Option, Stream } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { extractTeamPrefix, findProjectByTeam, resolveProjectFromIssue } from '../../../lib/projects.js';
import { extractPrefix } from '../../../lib/issue-id.js';
import { loadWorkspaceMetadata as loadWorkspaceMetadataStatic } from '../../../lib/remote/workspace-metadata.js';
import { resolveGitHubIssue as resolveGitHubIssueShared, resolveTrackerType } from '../../../lib/tracker-utils.js';
import { clearReviewStatus } from '../review-status.js';
import { reopenWorkspaceState } from '../../../lib/reopen.js';
import { getGitHubConfig, getRallyConfig } from '../services/tracker-config.js';
import { syncCache, getCostsForIssue } from '../../../lib/costs/index.js';
import { readIssueHandoffEvents } from '../../../lib/cloister/handoff-logger.js';
import { IssueDataService } from '../services/issue-data-service.js';
import { CacheService } from '../services/cache-service.js';
import { EventStoreService } from '../services/domain-services.js';
import { IssueLifecycle, type IssueState } from '../services/issue-lifecycle.js';
import { LinearClient } from '../services/linear-client.js';
import { GitHubClient } from '../services/github-client.js';
import { RallyClient } from '../services/rally-client.js';
import { killSessionAsync, listSessionNamesAsync, sessionExistsAsync } from '../../../lib/tmux.js';
import { canonicalPrdSubdir } from '../../../lib/prd-locations.js';

const execAsync = promisify(exec);

// ─── Shared IssueDataService singleton ───────────────────────────────────────
// Started by main.ts on boot. Updates flow through the ReadModel via
// onIssuesChanged callback → event store → WebSocket RPC.

function getIssueDataService(): IssueDataService {
  // Use the shared singleton — started by server.ts on boot
  const { getSharedIssueService } = require('../services/issue-service-singleton.js');
  return getSharedIssueService();
}

// ─── Exported async cleanup helpers (used by routes + tests) ─────────────────

export async function cleanupAgentStateDirs(dirs: string[]): Promise<void> {
  for (const dir of dirs) {
    if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
  }
}

export async function removeCompletionMarker(markerPath: string): Promise<void> {
  if (existsSync(markerPath)) await rm(markerPath);
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
    if (r.localPath) {
      out[`${r.owner}/${r.repo}`] = r.localPath;
    }
  }
  return out;
}

function getProjectPath(linearProjectId?: string, issuePrefix?: string): string {
  if (issuePrefix) {
    const issueId = `${issuePrefix}-1`;
    const resolved = resolveProjectFromIssue(issueId);
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

async function closeIssuePullRequest(issueId: string, reason = 'Canceled via Panopticon'): Promise<string[]> {
  const githubCheck = isGitHubIssue(issueId);
  if (!githubCheck.isGitHub || !githubCheck.owner || !githubCheck.repo) {
    return ['No GitHub PR to close'];
  }

  const branchName = `feature/${issueId.toLowerCase()}`;
  try {
    const { stdout: prListRaw } = await execAsync(
      `gh pr list --repo ${githubCheck.owner}/${githubCheck.repo} --head "${branchName}" --state open --json number --jq '.[0].number'`,
      { encoding: 'utf-8', timeout: 15000 },
    );
    const prNumber = prListRaw.trim();
    if (!prNumber) {
      return ['No open PR found for branch'];
    }

    await execAsync(
      `gh pr close ${prNumber} --repo ${githubCheck.owner}/${githubCheck.repo} --comment "${reason}"`,
      { encoding: 'utf-8', timeout: 15000 },
    );
    try {
      const { setReviewStatus } = await import('../../../lib/review-status.js');
      setReviewStatus(issueId.toUpperCase(), { prUrl: undefined });
    } catch { /* non-fatal — validator catches this downstream */ }
    return [`Closed PR #${prNumber} on ${githubCheck.owner}/${githubCheck.repo}`];
  } catch (err: any) {
    return [`PR close warning: ${err.message}`];
  }
}

function buildLifecycleContext(id: string, issueSource: string | undefined) {
  const issuePrefix = extractTeamPrefix(id);
  const projectPath = getProjectPath(undefined, issuePrefix);
  const projectConfig = findProjectByTeam(issuePrefix);
  const githubCheck = isGitHubIssue(id);

  const ctx: any = {
    issueId: id,
    projectPath,
    projectName: projectConfig?.name || '',
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

  return { ctx, projectConfig, githubCheck };
}

async function runDestructiveIssueLifecycle(
  id: string,
  mode: 'reset' | 'cancel',
  opts: { deleteWorkspace?: boolean; onProgress?: (data: Record<string, unknown>) => void } = {},
): Promise<{ success: boolean; cleanupLog: string[]; error?: string }> {
  const cleanupLog: string[] = [];
  const issueDataService = getIssueDataService();
  const issueSource = issueDataService.getIssueSource(id);
  const { ctx, projectConfig } = buildLifecycleContext(id, issueSource);
  const deleteWorkspace = opts.deleteWorkspace ?? true;

  cleanupLog.push(...await closeIssuePullRequest(
    id,
    mode === 'cancel' ? 'Canceled via Panopticon' : 'Reset to Todo via Panopticon',
  ));

  const { resetToTodo, cancelIssueWorkflow } = await import('../../../lib/lifecycle/index.js');
  const workflow = mode === 'cancel' ? cancelIssueWorkflow : resetToTodo;
  const result = await workflow(ctx, {
    deleteWorkspace,
    deleteBranches: deleteWorkspace,
    resetIssue: true,
    workspaceConfig: projectConfig?.workspace,
    projectName: projectConfig?.name || '',
    onProgress: opts.onProgress ? (event) => opts.onProgress?.({ type: 'progress', ...event }) : undefined,
  });

  cleanupLog.push(...result.steps.flatMap((step: any) => step.details || [step.error].filter(Boolean)));

  try {
    clearReviewStatus(id.toUpperCase());
    cleanupLog.push('Cleared review status');
  } catch { /* non-fatal */ }

  try {
    const { resetPostMergeState } = await import('../../../lib/cloister/merge-agent.js');
    resetPostMergeState(id);
    resetPostMergeState(id.toUpperCase());
    cleanupLog.push('Cleared merge state');
  } catch { /* non-fatal */ }

  const issueDataServiceAfter = getIssueDataService();
  issueDataServiceAfter.invalidateTracker('github').catch(() => {});
  issueDataServiceAfter.invalidateTracker('linear').catch(() => {});
  issueDataServiceAfter.invalidateTracker('rally').catch(() => {});

  return {
    success: result.success,
    cleanupLog,
    error: result.success ? undefined : result.steps.find((s: any) => !s.success && !s.skipped)?.error,
  };
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

// ─── Route: POST /api/issues/:id/plan ────────────────────────────────────────

const postIssuePlanRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/plan',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;
    const linear = yield* LinearClient;

    const { answers, tasks } = body as any;

    if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
      return jsonResponse({ error: 'Tasks are required' }, { status: 400 });
    }

    const issue = yield* Effect.promise(() =>
      Effect.runPromise(linear.getIssue(id).pipe(Effect.catch(() => Effect.succeed(null)))),
    );

    if (!issue) {
      return jsonResponse({ error: 'Issue not found' }, { status: 404 });
    }

    const issuePrefix = extractPrefix(issue.identifier) ?? issue.identifier.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);

    const { findPRDFiles, analyzeComplexity, executePlan } = yield* Effect.promise(() =>
      import('../../../lib/planning/plan-utils.js'),
    );

    const prdFiles = yield* Effect.promise(() => findPRDFiles(issue.identifier, projectPath));

    const planIssue = {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description || undefined,
      url: issue.url,
    };

    const complexity = analyzeComplexity(planIssue, prdFiles);

    const decisions: Array<{ question: string; answer: string }> = [];
    if (answers) {
      if (answers.scope) decisions.push({ question: 'Scope', answer: answers.scope });
      if (answers.approach) decisions.push({ question: 'Technical approach', answer: answers.approach });
      if (answers.edgeCases) decisions.push({ question: 'Edge cases', answer: answers.edgeCases });
      if (answers.testing?.length > 0) decisions.push({ question: 'Testing', answer: answers.testing.join(', ') });
      if (answers.outOfScope) decisions.push({ question: 'Out of scope', answer: answers.outOfScope });
    }

    const result = yield* Effect.promise(() =>
      executePlan(planIssue, tasks, decisions, projectPath, { commitAndPush: true, prdFiles }),
    );

    return jsonResponse({
      success: true,
      complexity,
      existingPRDs: prdFiles.length > 0 ? prdFiles.map((f: string) => f.replace(projectPath, '.')) : undefined,
      tasks,
      files: {
        state: result.files.state.replace(projectPath, '.'),
        prd: result.files.prd ? result.files.prd.replace(projectPath, '.') : undefined,
      },
      prdCommitted: result.prdCommitted,
    });
  })),
);

// ─── Route: GET /api/issues/:id/handoffs ─────────────────────────────────────

const getIssueHandoffsRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/handoffs',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['id'] ?? '';
    const handoffs = readIssueHandoffEvents(issueId);
    return jsonResponse({ handoffs });
  })),
);

// ─── Route: POST /api/issues/:issueId/close ──────────────────────────────────

const postIssueCloseRoute = HttpRouter.add(
  'POST',
  '/api/issues/:issueId/close',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;

    const { reason } = body as any;
    const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];
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

    const result = yield* Effect.promise(() => closeWorkflow(ctx, { reason }));

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
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;
    const linear = yield* LinearClient;
    const github = yield* GitHubClient;
    const rally = yield* RallyClient;
    const lifecycle = yield* IssueLifecycle;

    const {
      skipWorkspace = false,
      startDocker = false,
      workspaceLocation = 'local',
      shadowMode = false,
      model: modelOverride,
      effort,
    } = body as any;

    console.log(`[start-planning] START for ${id}, workspaceLocation=${workspaceLocation}, shadow=${shadowMode}`);

    // Check if a work agent is already running
    const issueLowerForCheck = id.toLowerCase();
    const tmuxSessions = yield* Effect.promise(() => listSessionNamesAsync());
    const workAgentSession = tmuxSessions.find((s: string) => s === `agent-${issueLowerForCheck}`);
    if (workAgentSession) {
      return jsonResponse({
        error: `Cannot start planning: work agent already running for ${id.toUpperCase()}`,
        hint: 'Stop the agent first or use the terminal view to interact with it',
        existingSession: workAgentSession,
      }, { status: 409 });
    }

    const trackerTypeForIssue = resolveTrackerType(id);
    const githubCheck = isGitHubIssue(id);

    let issue: {
      id: string;
      identifier: string;
      title: string;
      description: string;
      url: string;
      source: 'linear' | 'github' | 'rally';
      comments?: Array<{ author: string; body: string; createdAt: string }>;
    };
    let newStateName = 'In Planning';

    if (trackerTypeForIssue === 'github' && githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number) {
      const { owner, repo, number } = githubCheck as { owner: string; repo: string; number: number };
      const ghIssue = yield* Effect.promise(() =>
        Effect.runPromise(github.getIssue(owner, repo, number).pipe(Effect.catch((e) => Effect.fail(e)))),
      );

      const ghConfig = getGitHubConfig();
      const repoConfig = ghConfig?.repos.find((r: any) => r.owner === owner && r.repo === repo);
      const prefix = repoConfig?.prefix || repo.toUpperCase();

      const ghComments = yield* Effect.promise(() =>
        Effect.runPromise(
          github.getComments(owner, repo, number, 50).pipe(
            Effect.map((cs) => cs.map((c) => ({ author: c.user, body: c.body, createdAt: c.createdAt }))),
            Effect.catch(() => Effect.succeed([] as Array<{ author: string; body: string; createdAt: string }>)),
          ),
        ),
      );

      issue = {
        id: `github-${owner}-${repo}-${number}`,
        identifier: `${prefix}-${number}`,
        title: ghIssue.title,
        description: ghIssue.body || '',
        url: ghIssue.htmlUrl,
        source: 'github',
        comments: ghComments.length > 0 ? ghComments : undefined,
        labels: ghIssue.labels ?? [],
      };

      // Add "planning" label (ensure it exists, then apply to issue)
      yield* Effect.promise(() =>
        Effect.runPromise(lifecycle.addLabel(id, 'planning').pipe(Effect.catch(() => Effect.void))),
      );

    } else if (trackerTypeForIssue === 'rally') {
      const rallyIssue = yield* Effect.promise(() =>
        Effect.runPromise(
          rally.getIssue(id).pipe(
            Effect.catchTag('TrackerNotConfigured', () =>
              Effect.fail(new Error('RALLY_API_KEY not configured. Set it in ~/.panopticon.env')),
            ),
          ),
        ),
      );

      issue = {
        id: rallyIssue.id,
        identifier: rallyIssue.ref,
        title: rallyIssue.title,
        description: rallyIssue.description || '',
        url: rallyIssue.url,
        source: 'rally',
      };

    } else {
      // Linear
      const linearIssue = yield* Effect.promise(() =>
        Effect.runPromise(
          linear.getIssue(id).pipe(
            Effect.catchTag('TrackerNotConfigured', () =>
              Effect.fail(new Error('LINEAR_API_KEY not configured')),
            ),
          ),
        ),
      );

      issue = {
        id: linearIssue.id,
        identifier: linearIssue.identifier,
        title: linearIssue.title,
        description: linearIssue.description || '',
        url: linearIssue.url,
        source: 'linear',
      };

      // Transition to "In Planning" state
      yield* Effect.promise(() =>
        Effect.runPromise(lifecycle.transitionTo(id, 'in_planning').pipe(Effect.catch(() => Effect.void))),
      );
    }

    const issuePrefix = extractPrefix(issue.identifier) ?? issue.identifier.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const issueLower = issue.identifier.toLowerCase();
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
    const sessionName = `planning-${issueLower}`;

    yield* eventStore.append({
      type: 'workspace.created',
      timestamp: new Date().toISOString(),
      payload: { issueId: id, workspacePath },
    });
    yield* eventStore.append({
      type: 'planning.started',
      timestamp: new Date().toISOString(),
      payload: { issueId: id, sessionName },
    });
    yield* eventStore.append({
      type: 'issue.statusChanged',
      timestamp: new Date().toISOString(),
      payload: { issueId: issue.identifier, status: newStateName, canonicalStatus: 'in_progress' },
    });

    // Write preliminary agent state so status endpoint knows planning is starting
    const agentStateDir = join(homedir(), '.panopticon', 'agents', sessionName);
    yield* Effect.promise(() => mkdir(agentStateDir, { recursive: true }));
    yield* Effect.promise(() => writeFile(join(agentStateDir, 'state.json'), JSON.stringify({
      id: sessionName,
      issueId: issue.identifier,
      workspace: workspacePath,
      status: 'starting',
      startedAt: new Date().toISOString(),
      type: 'planning',
      location: workspaceLocation,
    }, null, 2)));

    try { getIssueDataService().patchIssue(issue.identifier, { status: newStateName, canonicalStatus: 'in_progress' }); } catch { /* non-fatal */ }

    // SSE stream: await spawnPlanningSession and stream progress events
    const encoder = new TextEncoder();
    const nodeStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        const sendEvent = (data: Record<string, unknown>) => {
          if (closed) {
            console.warn(`[start-planning] SSE event dropped (stream closed):`, JSON.stringify(data).slice(0, 200));
            return;
          }
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch (err: any) {
            console.error(`[start-planning] SSE enqueue failed:`, err.message);
            closed = true;
          }
        };

        console.log(`[start-planning] SSE stream opened for ${id}`);

        // Send initial metadata
        sendEvent({
          type: 'started',
          issue: {
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            newState: newStateName,
            source: issue.source,
          },
          workspace: { path: workspacePath },
          sessionName,
        });

        try {
          const result = await spawnPlanningSession({
            issue: issue as PlanningIssue,
            workspacePath,
            projectPath,
            sessionName,
            workspaceLocation: workspaceLocation as 'local' | 'remote',
            startDocker: body.startDocker,
            shadowMode,
            model: modelOverride || undefined,
            effort: effort || undefined,
            onProgress: (event) => {
              console.log(`[start-planning] Progress: step=${event.step} label="${event.label}" status=${event.status} detail="${event.detail}"`);
              sendEvent({ type: 'progress', ...event });
            },
          });

          if (result.success) {
            console.log(`[start-planning] SSE complete for ${id}, sessionName=${sessionName}`);
            sendEvent({ type: 'complete', sessionName });
          } else {
            console.error(`[start-planning] SSE error for ${id}: ${result.error}`);
            sendEvent({ type: 'error', error: result.error });
          }
        } catch (streamErr: any) {
          console.error(`[start-planning] SSE stream exception for ${id}:`, streamErr);
          sendEvent({ type: 'error', error: streamErr.message || 'Unexpected error during setup' });
        }

        closed = true;
        try { controller.close(); } catch { /* already closed */ }
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

// ─── Route: POST /api/issues/:id/abort-planning ──────────────────────────────

const postIssueAbortPlanningRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/abort-planning',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;
    const lifecycle = yield* IssueLifecycle;
    const linear = yield* LinearClient;
    const eventStore = yield* EventStoreService;

    const { deleteWorkspace } = body as any;
    const githubCheck = isGitHubIssue(id);

    let revertedState = 'Todo';
    let issueIdentifier: string | undefined;
    let sessionName: string = `planning-${id.toLowerCase()}`;

    if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number) {
      issueIdentifier = id;
      sessionName = `planning-${id.toLowerCase()}`;
      // Remove planning label via IssueLifecycle
      yield* lifecycle.removeLabel(id, 'planning').pipe(Effect.catch(() => Effect.void));
      revertedState = 'Todo (label removed)';
    } else {
      // Resolve issue identifier and session name via LinearClient, then transition to 'open' (Todo)
      const linearIssue = yield* linear.getIssue(id).pipe(Effect.catch(() => Effect.succeed(null)));

      if (linearIssue) {
        issueIdentifier = linearIssue.identifier;
        sessionName = `planning-${linearIssue.identifier.toLowerCase()}`;
      }

      yield* lifecycle.transitionTo(id, 'open').pipe(Effect.catch(() => Effect.void));
      revertedState = 'Todo';
    }

    // Kill tmux sessions
    yield* Effect.promise(() => killSessionAsync(sessionName).catch(() => {}));
    yield* Effect.promise(() => killSessionAsync(`planning-${id.toLowerCase()}`).catch(() => {}));

    // Clean up agent state files (non-fatal, so absorbed inside the promise)
    const agentStateDir = join(homedir(), '.panopticon', 'agents', sessionName);
    const workAgentStateDir = issueIdentifier
      ? join(homedir(), '.panopticon', 'agents', `agent-${issueIdentifier.toLowerCase()}`)
      : join(homedir(), '.panopticon', 'agents', `agent-${id.toLowerCase()}`);

    yield* Effect.promise(() =>
      cleanupAgentStateDirs([agentStateDir, workAgentStateDir]).catch((cleanupErr: unknown) => {
        console.log('[abort-planning] Warning: Could not clean up agent state:', cleanupErr);
      })
    );

    let workspaceDeleted = false;
    let workspaceError: string | undefined;

    if (deleteWorkspace && issueIdentifier) {
      const wipeResult = yield* Effect.promise(async (): Promise<{ deleted: boolean; error?: string }> => {
        try {
          let projectPath: string | undefined;
          if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
            const localPaths = getGitHubLocalPaths();
            projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`];
          }
          if (!projectPath) {
            const prefix = extractPrefix(issueIdentifier!) ?? issueIdentifier!.split('-')[0].toUpperCase();
            const projConfig = findProjectByTeam(prefix);
            if (projConfig) projectPath = projConfig.path;
          }

          if (projectPath) {
            const featureWorkspacePath = join(projectPath, 'workspaces', `feature-${issueIdentifier!.toLowerCase()}`);
            const plainWorkspacePath = join(projectPath, 'workspaces', issueIdentifier!.toLowerCase());
            const workspacePath = existsSync(featureWorkspacePath) ? featureWorkspacePath : plainWorkspacePath;

            if (existsSync(workspacePath)) {
              await execAsync(`pan workspace destroy ${issueIdentifier!.toLowerCase()} --force`, {
                cwd: projectPath,
                encoding: 'utf-8',
                timeout: 120000,
                maxBuffer: 10 * 1024 * 1024,
              });
              return { deleted: true };
            } else {
              return { deleted: false, error: 'Workspace not found' };
            }
          } else {
            return { deleted: false, error: 'Could not determine project path' };
          }
        } catch (err: any) {
          return { deleted: false, error: err.message };
        }
      });
      workspaceDeleted = wipeResult.deleted;
      workspaceError = wipeResult.error;
    }

    yield* eventStore.append({
      type: 'issue.statusChanged',
      timestamp: new Date().toISOString(),
      payload: { issueId: issueIdentifier || id, status: revertedState, canonicalStatus: 'todo' },
    });
    yield* eventStore.append({
      type: 'workspace.aborted',
      timestamp: new Date().toISOString(),
      payload: { issueId: issueIdentifier || id, sessionName },
    });
    try { getIssueDataService().patchIssue(issueIdentifier || id, { status: revertedState, canonicalStatus: 'todo' }); } catch { /* non-fatal */ }

    return jsonResponse({
      success: true,
      issueId: id,
      revertedState,
      sessionKilled: true,
      workspaceDeleted,
      workspacePreserved: !deleteWorkspace && !workspaceDeleted,
      workspaceError,
    });
  })),
);

// ─── Route: POST /api/issues/:id/complete-planning ───────────────────────────

const postIssueCompletePlanningRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/complete-planning',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;
    const linear = yield* LinearClient;
    const lifecycle = yield* IssueLifecycle;

    const skipKill = (body as any)?.skipKill === true;
    const sessionName = `planning-${id.toLowerCase()}`;
    const issueLower = id.toLowerCase();

    console.log(`[complete-planning] CALLED for ${id} (skipKill=${skipKill})`);

    // Detect remote planning session (non-fatal reads)
    const { isRemotePlanning, remoteVmName } = yield* Effect.promise(async (): Promise<{ isRemotePlanning: boolean; remoteVmName: string | null }> => {
      let isRemotePlanning = false;
      let remoteVmName: string | null = null;
      try {
        const agentStateDir = join(homedir(), '.panopticon', 'agents', sessionName);
        const stateJsonPath = join(agentStateDir, 'state.json');
        if (existsSync(stateJsonPath)) {
          const agentState = JSON.parse(await readFile(stateJsonPath, 'utf-8'));
          if (agentState.location === 'remote' && agentState.vmName) {
            isRemotePlanning = true;
            remoteVmName = agentState.vmName;
          }
        }
        if (!isRemotePlanning) {
          const remoteMetadataPath = join(homedir(), '.panopticon', 'agents', sessionName, 'remote-workspace.json');
          if (existsSync(remoteMetadataPath)) {
            const remoteMetadata = JSON.parse(await readFile(remoteMetadataPath, 'utf-8'));
            if (remoteMetadata.vmName) {
              isRemotePlanning = true;
              remoteVmName = remoteMetadata.vmName;
            }
          }
        }
      } catch { /* Not a remote session */ }
      return { isRemotePlanning, remoteVmName };
    });

    if (!skipKill) {
      yield* Effect.promise(() => killSessionAsync(sessionName).catch(() => {}));
    }

    // Mark planning agent as stopped so KanbanBoard shows "Start Agent" instead of "Watch Planning"
    yield* Effect.promise(async () => {
      try {
        const planningStateDir = join(homedir(), '.panopticon', 'agents', sessionName);
        const planningStatePath = join(planningStateDir, 'state.json');
        if (existsSync(planningStatePath)) {
          const planningState = JSON.parse(await readFile(planningStatePath, 'utf-8'));
          planningState.status = 'stopped';
          planningState.stoppedAt = new Date().toISOString();
          await writeFile(planningStatePath, JSON.stringify(planningState, null, 2), 'utf-8');
          console.log(`[complete-planning] Marked ${sessionName} as stopped`);
        }
      } catch { /* Non-fatal — agent status is cosmetic */ }
    });

    // Determine project path
    const githubCheck = isGitHubIssue(id);
    let projectPath = '';

    if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
      const localPaths = getGitHubLocalPaths();
      projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`] || '';
    }
    if (!projectPath) {
      const teamPrefix = extractTeamPrefix(id);
      const projectConfig = teamPrefix ? findProjectByTeam(teamPrefix) : null;
      projectPath = projectConfig?.path || '';
    }

    // Git operations: write planning marker, commit, push (complex nested async — kept as async block)
    const { pushed: gitPushed, beadsWarning } = yield* Effect.promise(async (): Promise<{ pushed: boolean; beadsWarning: string | null }> => {
      if (!projectPath) return { pushed: false, beadsWarning: null };

      const workspacePlanningDir = join(projectPath, 'workspaces', `feature-${issueLower}`, '.planning');
      const legacyPlanningDir = join(projectPath, '.planning', issueLower);

      let planningDir = '';
      if (existsSync(workspacePlanningDir)) planningDir = workspacePlanningDir;
      else if (existsSync(legacyPlanningDir)) planningDir = legacyPlanningDir;

      if (!planningDir) return { pushed: false, beadsWarning: null };

      try {
        const gitRoot = planningDir.includes('/workspaces/')
          ? join(projectPath, 'workspaces', `feature-${issueLower}`)
          : projectPath;

        // Beads are created by the planning agent via `pan plan-finalize`, which also
        // writes .planning/.planning-complete. By the time this endpoint runs, the marker
        // and beads are expected to already exist. We do not create beads here — fixing
        // the planning prompt is the right place to enforce that contract.
        const beadsWarning: string | null = null;

        // Auto-copy planning artifacts to docs/prds/active/<issue-id>/ (skip if already exist).
        // MUST use canonicalPrdSubdir() (lowercase) — passing the raw `id` previously stranded
        // PRDs in uppercase directories that downstream readers/archivers couldn't find.
        try {
          const issueActiveDir = canonicalPrdSubdir(gitRoot, id, 'active');
          await mkdir(issueActiveDir, { recursive: true });
          const stateMd = join(planningDir, 'STATE.md');
          const planVbrief = join(planningDir, 'plan.vbrief.json');
          const destStateMd = join(issueActiveDir, 'STATE.md');
          const destPlanVbrief = join(issueActiveDir, 'plan.vbrief.json');
          if (existsSync(stateMd)) {
            const stateMdExists = await access(destStateMd).then(() => true).catch(() => false);
            if (!stateMdExists) {
              await copyFile(stateMd, destStateMd);
              console.log(`[complete-planning] Copied STATE.md to ${destStateMd}`);
            }
          }
          if (existsSync(planVbrief)) {
            const vbriefExists = await access(destPlanVbrief).then(() => true).catch(() => false);
            if (!vbriefExists) {
              await copyFile(planVbrief, destPlanVbrief);
              console.log(`[complete-planning] Copied plan.vbrief.json to ${destPlanVbrief}`);
            }
          }
        } catch (copyErr: any) {
          console.warn(`[complete-planning] Artifact copy failed (non-fatal): ${copyErr.message}`);
        }

        // Sync beads
        try {
          await execAsync('bd sync 2>/dev/null || true', { cwd: gitRoot, encoding: 'utf-8', timeout: 10000 });
        } catch { /* bd might not be installed */ }

        // The .planning-complete marker is written by `pan plan-finalize` from the
        // planning agent, not here. The Done button is gated on its existence, so by
        // the time this endpoint fires the marker is already on disk.

        // Git operations
        const isGitRepo = existsSync(join(gitRoot, '.git'));
        if (!isGitRepo) {
          await execAsync('git init', { cwd: gitRoot, encoding: 'utf-8' });
        }

        await execAsync('git add -f .planning/', { cwd: gitRoot, encoding: 'utf-8' });
        if (existsSync(join(gitRoot, '.beads'))) {
          await execAsync('git add .beads/', { cwd: gitRoot, encoding: 'utf-8' });
        }

        try {
          await execAsync('git diff --cached --quiet', { cwd: gitRoot, encoding: 'utf-8' });
        } catch {
          await execAsync(`git commit -m "Complete planning for ${id}"`, { cwd: gitRoot, encoding: 'utf-8' });
        }

        try {
          const { stdout: remotes } = await execAsync('git remote', { cwd: gitRoot, encoding: 'utf-8' });
          if (remotes.trim()) {
            const pushChild = spawn('git', ['push'], { cwd: gitRoot, detached: true, stdio: 'ignore' });
            pushChild.unref();
            return { pushed: true, beadsWarning };
          } else {
            return { pushed: true, beadsWarning };
          }
        } catch { /* Non-fatal */ }
      } catch (gitErr) {
        console.error('Git commit/push failed:', gitErr);
      }
      return { pushed: false, beadsWarning: null };
    });

    // Update Linear/GitHub issue state
    let newState = 'Planned';

    // Skip status reset if a work agent is already running — complete-planning fires after
    // planning finishes, but the user may have already clicked "Start Agent". Resetting the
    // issue to Planned would undo that and flash the card back to To Do.
    const workAgentSession = `agent-${issueLower}`;
    const workAgentAlreadyRunning = yield* Effect.promise(() => sessionExistsAsync(workAgentSession));
    if (workAgentAlreadyRunning) {
      console.log(`[complete-planning] Work agent ${workAgentSession} is already running — skipping status reset to Planned`);
    }

    // For Linear: check if already in a 'started' state — if so, skip the transition
    let skipStateUpdate = workAgentAlreadyRunning;
    if (!skipStateUpdate && !githubCheck?.isGitHub) {
      const currentIssue = yield* linear.getIssue(id).pipe(Effect.catch(() => Effect.succeed(null)));
      if (currentIssue?.state.name && currentIssue.state.name.toLowerCase() !== 'in planning' && currentIssue.state.name.toLowerCase() !== 'planning') {
        // Check if already in a "started" state by seeing if it's not an unstarted/planning state
        const stateType = yield* linear.getTeamStates(currentIssue.team.id).pipe(
          Effect.map((states) => states.find((s) => s.id === currentIssue.state.id)?.type ?? ''),
          Effect.catch(() => Effect.succeed('')),
        );
        if (stateType === 'started') {
          skipStateUpdate = true;
        }
      }
    }

    if (!skipStateUpdate) {
      if (githubCheck.isGitHub) {
        // GitHub: remove 'planning' label, add 'planned' label
        yield* lifecycle.removeLabel(id, 'planning').pipe(Effect.catch(() => Effect.void));
        yield* lifecycle.addLabel(id, 'planned').pipe(Effect.catch(() => Effect.void));
      } else {
        // Linear: transition to 'open' (maps to unstarted — Planned/Todo/Ready)
        const updatedIssue = yield* linear.getIssue(id).pipe(Effect.catch(() => Effect.succeed(null)));
        yield* lifecycle.transitionTo(id, 'open').pipe(Effect.catch(() => Effect.void));
        // Re-fetch to get new state name for response
        const refreshed = yield* linear.getIssue(id).pipe(Effect.catch(() => Effect.succeed(null)));
        newState = refreshed?.state.name ?? (updatedIssue?.state.name ?? 'Planned');
      }
    } else {
      newState = 'Skipped (already in progress)';
    }

    yield* eventStore.append({
      type: 'planning.sync',
      timestamp: new Date().toISOString(),
      payload: { issueId: id, status: 'completed' },
    });

    const completeCanonical = newState === 'Skipped (already in progress)' ? 'in_progress' : 'todo';
    yield* eventStore.append({
      type: 'issue.statusChanged',
      timestamp: new Date().toISOString(),
      payload: { issueId: id, status: newState, canonicalStatus: completeCanonical },
    });
    try { getIssueDataService().patchIssue(id, { status: newState, canonicalStatus: completeCanonical }); } catch { /* non-fatal */ }

    // Suppress unused variable warning — remoteVmName used for remote session cleanup if added later
    void isRemotePlanning; void remoteVmName;

    return jsonResponse({
      success: true,
      issueId: id,
      newState,
      gitPushed,
      ...(beadsWarning ? { beadsWarning } : {}),
      message: gitPushed
        ? 'Planning complete and pushed to git - ready for execution'
        : 'Planning complete - ready for execution',
    });
  })),
);

// ─── Route: POST /api/issues/:id/abort ───────────────────────────────────────

const postIssueAbortRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/abort',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const eventStore = yield* EventStoreService;

    const result = yield* Effect.promise(() => runDestructiveIssueLifecycle(id, 'reset', { deleteWorkspace: true }));

    if (result.success) {
      for (const agentId of [`agent-${id.toLowerCase()}`, `planning-${id.toLowerCase()}`]) {
        yield* eventStore.append({
          type: 'agent.stopped',
          timestamp: new Date().toISOString(),
          payload: { agentId },
        } as any).pipe(Effect.catch(() => Effect.void));
      }
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
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;

    const { deleteWorkspace = true } = body as any || {};
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
          for (const agentId of [`agent-${id.toLowerCase()}`, `planning-${id.toLowerCase()}`]) {
            try {
              await Effect.runPromise(eventStore.append({
                type: 'agent.stopped',
                timestamp: new Date().toISOString(),
                payload: { agentId },
              } as any));
            } catch { /* non-fatal */ }
          }
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
    const body = yield* readJsonBody;
    const lifecycle = yield* IssueLifecycle;
    const linear = yield* LinearClient;
    const eventStore = yield* EventStoreService;

    const { reason: _reason } = body as any || {};
    const githubCheck = isGitHubIssue(id);

    const issueDataService = getIssueDataService();
    const issueSource = issueDataService.getIssueSource(id);

    let newState = 'In Progress';
    let issueIdentifier = id;

    // Transition to 'in_progress' via IssueLifecycle (handles all three trackers)
    yield* lifecycle.transitionTo(id, 'in_progress').pipe(Effect.catch(() => Effect.void));

    if (issueSource === 'rally') {
      issueDataService.invalidateTracker('rally').catch(() => {});
      newState = 'Open';

    } else if (githubCheck.isGitHub) {
      // Also clean up done/needs-close-out/merged labels and ensure in-progress is set
      yield* lifecycle.removeLabel(id, 'done').pipe(Effect.catch(() => Effect.void));
      yield* lifecycle.removeLabel(id, 'needs-close-out').pipe(Effect.catch(() => Effect.void));
      yield* lifecycle.removeLabel(id, 'merged').pipe(Effect.catch(() => Effect.void));

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
      newState = 'In Progress';

    } else {
      // Linear: fetch updated state name
      const updatedIssue = yield* linear.getIssue(id).pipe(Effect.catch(() => Effect.succeed(null)));
      issueIdentifier = updatedIssue?.identifier ?? id;
      newState = updatedIssue?.state.name ?? 'In Progress';
      issueDataService.invalidateTracker('linear').catch(() => {});
    }

    // Reset specialist pipeline state, post-merge state, and agent markers (all non-fatal)
    yield* Effect.promise(async () => {
      // Reset specialist pipeline state, remove from queues, and update STATE.md
      // via reopenWorkspaceState (shared logic with `pan reopen` CLI command)
      try {
        const teamPrefix = extractTeamPrefix(id);
        const projectConfig = teamPrefix ? findProjectByTeam(teamPrefix) : null;
        const projectPath = projectConfig?.path || '';
        const workspacePath = projectPath
          ? join(projectPath, 'workspaces', `feature-${id.toLowerCase()}`)
          : '';
        if (workspacePath) {
          await reopenWorkspaceState(id.toUpperCase(), workspacePath, { reason: (body as any)?.reason });
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
        const agentDir = join(homedir(), '.panopticon', 'agents', `agent-${id.toLowerCase()}`);
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
        const projectConfig = teamPrefix ? findProjectByTeam(teamPrefix) : null;
        const projectPath = projectConfig?.path || '';
        if (projectPath) {
          const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
          const { findPlan } = await import('../../../lib/vbrief/io.js');
          const { createBeadsFromVBrief } = await import('../../../lib/vbrief/beads.js');
          if (existsSync(workspacePath) && findPlan(workspacePath)) {
            try {
              const { stdout: bdCheck } = await execAsync(
                `bd list --json -l ${issueLower} --limit 1`,
                { cwd: workspacePath, encoding: 'utf-8', timeout: 10000 },
              );
              const existing = JSON.parse(bdCheck.trim() || '[]');
              if (existing.length === 0) {
                const result = await createBeadsFromVBrief(workspacePath);
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
      payload: { issueId: issueIdentifier, status: newState, canonicalStatus: 'in_progress' },
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
    try { getIssueDataService().patchIssue(issueIdentifier, { status: newState, canonicalStatus: 'in_progress' }); } catch { /* non-fatal */ }

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

// ─── Route: POST /api/issues/:id/move-status ─────────────────────────────────

const postIssueMoveStatusRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/move-status',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
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

    const shadowResult = yield* Effect.promise(() => updateShadowState(id, issueState, 'dashboard-drag-drop', targetStatus));

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
    const id = params['id'] ?? '';
    const cleanupLog: string[] = [];
    const eventStore = yield* EventStoreService;

    const issueLower = id.toLowerCase();
    const githubCheck = isGitHubIssue(id);

    let projectRoot: string | null = null;
    if (githubCheck.isGitHub) {
      const localPaths = getGitHubLocalPaths();
      const repoKey = `${githubCheck.owner}/${githubCheck.repo}`;
      projectRoot = localPaths[repoKey] || null;
    }
    if (!projectRoot) {
      const teamPrefix = extractTeamPrefix(id);
      const projectConfig = teamPrefix ? findProjectByTeam(teamPrefix) : null;
      projectRoot = projectConfig?.path || null;
    }

    // Git worktree/workspace and agent dir cleanup (all async with meaningful branching on error)
    yield* Effect.promise(async () => {
      if (projectRoot) {
        const workspacePath = join(projectRoot, 'workspaces', `feature-${issueLower}`);
        try {
          const worktreeList = await execAsync('git worktree list --porcelain', { cwd: projectRoot, encoding: 'utf-8' });
          if (worktreeList.stdout.includes(workspacePath)) {
            await execAsync(`git worktree remove "${workspacePath}" --force`, { cwd: projectRoot, encoding: 'utf-8' });
            cleanupLog.push(`Removed git worktree: ${workspacePath}`);
          } else if (existsSync(workspacePath)) {
            await execAsync(`rm -rf "${workspacePath}"`, { encoding: 'utf-8' });
            cleanupLog.push(`Removed directory: ${workspacePath}`);
          }
        } catch {
          if (existsSync(workspacePath)) {
            await execAsync(`rm -rf "${workspacePath}"`, { encoding: 'utf-8' });
            cleanupLog.push(`Removed directory: ${workspacePath}`);
          }
        }

        const branchName = `feature/${issueLower}`;
        try {
          await execAsync(`git branch -D "${branchName}" 2>/dev/null || true`, { cwd: projectRoot, encoding: 'utf-8' });
          cleanupLog.push(`Deleted local branch: ${branchName}`);
        } catch { /* Branch might not exist */ }
      }

      const agentDir = join(homedir(), '.panopticon', 'agents', `agent-${issueLower}`);
      if (existsSync(agentDir)) {
        await execAsync(`rm -rf "${agentDir}"`, { encoding: 'utf-8' });
        cleanupLog.push(`Removed agent state: ${agentDir}`);
      }
    });

    yield* eventStore.append({
      type: 'workspace.deleted',
      timestamp: new Date().toISOString(),
      payload: { issueId: id },
    });

    return jsonResponse({
      success: true,
      message: `Workspace cleaned up for ${id}`,
      cleanupLog,
    });
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

    const { deleteWorkspace = true } = body as any || {};
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
          for (const agentId of [`agent-${id.toLowerCase()}`, `planning-${id.toLowerCase()}`]) {
            try {
              await Effect.runPromise(eventStore.append({
                type: 'agent.stopped',
                timestamp: new Date().toISOString(),
                payload: { agentId },
              } as any));
            } catch { /* non-fatal */ }
          }
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

// ─── Route: POST /api/issues/:id/close-out ───────────────────────────────────

const postIssueCloseOutRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/close-out',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const eventStore = yield* EventStoreService;

    const { closeOut } = yield* Effect.promise(() => import('../../../lib/lifecycle/index.js'));
    const githubCheck = isGitHubIssue(id);
    let projectPath = '';

    if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
      const localPaths = getGitHubLocalPaths();
      projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`] || '';
    }
    if (!projectPath) {
      const issuePrefix = extractPrefix(id) ?? id.split('-')[0].toUpperCase();
      projectPath = getProjectPath(undefined, issuePrefix);
    }
    if (!projectPath) {
      return jsonResponse({ error: `Could not resolve project path for ${id}` }, { status: 400 });
    }

    const ctx: any = {
      issueId: id,
      projectPath,
      ...(githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number
        ? { github: { owner: githubCheck.owner, repo: githubCheck.repo, number: githubCheck.number } }
        : {}),
    };

    const issueDataService = getIssueDataService();
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

    const result = yield* Effect.promise(() => closeOut(ctx));

    if (result.success) {
      issueDataService.invalidateTracker('github').catch(() => {});
      issueDataService.invalidateTracker('linear').catch(() => {});
      yield* eventStore.append({
        type: 'issue.statusChanged',
        timestamp: new Date().toISOString(),
        payload: { issueId: id, status: 'Done', canonicalStatus: 'done' },
      });
      try { issueDataService.patchIssue(id, { status: 'Done', canonicalStatus: 'done' }); } catch { /* non-fatal */ }
    }

    return jsonResponse({
      success: result.success,
      issueId: result.issueId,
      steps: result.steps.map((s: any) => ({
        name: s.step,
        status: s.success ? (s.skipped ? 'skipped' : 'passed') : 'failed',
        message: s.error || (s.details ? s.details.join('; ') : undefined),
      })),
      error: result.success ? undefined : result.steps.find((s: any) => !s.success)?.error,
    });
  })),
);

// ─── Route: GET /api/issues/:id/beads ────────────────────────────────────────

const getIssueBeadsRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/beads',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';

    const issueLower = id.toLowerCase();
    const githubCheck = isGitHubIssue(id);
    let projectPath = '';

    if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
      const localPaths = getGitHubLocalPaths();
      projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`] || '';
    }
    if (!projectPath) {
      const issuePrefix = extractPrefix(id) ?? id.split('-')[0];
      try { projectPath = getProjectPath(undefined, issuePrefix); } catch { projectPath = ''; }
    }

    const workspacePath = projectPath ? join(projectPath, 'workspaces', `feature-${issueLower}`) : '';

    // Check for remote workspace (reads non-fatal state files)
    const { isRemoteWorkspace, remoteVmName } = yield* Effect.promise(async (): Promise<{ isRemoteWorkspace: boolean; remoteVmName: string | null }> => {
      let isRemoteWorkspace = false;
      let remoteVmName: string | null = null;

      const sessionName = `planning-${issueLower}`;
      const agentStateDir = join(homedir(), '.panopticon', 'agents', sessionName);

      const stateJsonPath = join(agentStateDir, 'state.json');
      if (existsSync(stateJsonPath)) {
        try {
          const agentState = JSON.parse(await readFile(stateJsonPath, 'utf-8'));
          if (agentState.location === 'remote' && agentState.vmName) {
            isRemoteWorkspace = true;
            remoteVmName = agentState.vmName;
          }
        } catch { /* Ignore parse errors */ }
      }

      if (!isRemoteWorkspace) {
        const remoteMetadataPath = join(agentStateDir, 'remote-workspace.json');
        if (existsSync(remoteMetadataPath)) {
          try {
            const remoteMetadata = JSON.parse(await readFile(remoteMetadataPath, 'utf-8'));
            if (remoteMetadata.vmName) {
              isRemoteWorkspace = true;
              remoteVmName = remoteMetadata.vmName;
            }
          } catch { /* Ignore parse errors */ }
        }
      }

      if (!isRemoteWorkspace) {
        try {
          const wsMetadata = loadWorkspaceMetadataStatic(id);
          if (wsMetadata?.vmName) {
            isRemoteWorkspace = true;
            remoteVmName = wsMetadata.vmName;
          }
        } catch { /* Not a remote workspace */ }
      }

      return { isRemoteWorkspace, remoteVmName };
    });

    // Try local beads query (non-fatal on bd error)
    const { beads, querySource } = yield* Effect.promise(async (): Promise<{ beads: any[]; querySource: string }> => {
      try {
        const bdSearchDir = (workspacePath && existsSync(workspacePath)) ? workspacePath : (projectPath || homedir());
        const { stdout } = await execAsync(`bd list --json -l "${id.toLowerCase()}" --status all --limit 0`, {
          cwd: bdSearchDir,
          encoding: 'utf-8',
          timeout: 10000,
        });
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
    const issueLower = id.toLowerCase();

    const githubCheck = isGitHubIssue(id);
    let projectPath = '';
    if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
      const localPaths = getGitHubLocalPaths();
      projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`] || '';
    }
    if (!projectPath) {
      const issuePrefix = extractPrefix(id) ?? id.split('-')[0];
      try { projectPath = getProjectPath(undefined, issuePrefix); } catch { projectPath = ''; }
    }

    const workspacePath = projectPath
      ? join(projectPath, 'workspaces', `feature-${issueLower}`)
      : '';
    const planPath = workspacePath ? join(workspacePath, '.planning', 'plan.vbrief.json') : '';
    const hasPlan = !!planPath && existsSync(planPath);
    const planningComplete = workspacePath && existsSync(join(workspacePath, '.planning', '.planning-complete'));

    // bd query is best-effort: a missing/broken database must NOT prevent the
    // chip from coloring vBRIEF correctly. Errors are swallowed inside the
    // promise so Effect.promise never sees a rejection.
    const beadsCount = workspacePath && existsSync(workspacePath)
      ? yield* Effect.promise(async () => {
          try {
            const { stdout } = await execAsync(
              `bd list --json -l "${issueLower}" --status all --limit 0`,
              { cwd: workspacePath, encoding: 'utf-8', timeout: 8000 },
            );
            const arr = JSON.parse(stdout || '[]');
            return Array.isArray(arr) ? arr.length : 0;
          } catch {
            return 0;
          }
        })
      : 0;

    return jsonResponse({
      hasPlan,
      hasBeads: beadsCount > 0,
      beadsCount,
      planningComplete,
      workspacePath,
    });
  })),
);

// ─── Route: POST /api/issues/:id/generate-tasks ──────────────────────────────
//
// Runs createBeadsFromVBrief() against the workspace, then writes the
// .planning-complete marker. Same logic as `pan plan-finalize`, exposed so the
// dashboard can offer a one-click "Generate Tasks" action when a vBRIEF plan
// exists but beads were never created (e.g. plans authored before the
// agent-driven finalize flow shipped).

const postIssueGenerateTasksRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/generate-tasks',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const issueLower = id.toLowerCase();

    const githubCheck = isGitHubIssue(id);
    let projectPath = '';
    if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
      const localPaths = getGitHubLocalPaths();
      projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`] || '';
    }
    if (!projectPath) {
      const issuePrefix = extractPrefix(id) ?? id.split('-')[0];
      try { projectPath = getProjectPath(undefined, issuePrefix); } catch { projectPath = ''; }
    }

    if (!projectPath) {
      return jsonResponse({ success: false, error: `Could not resolve project path for ${id}` }, 404);
    }

    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
    const planPath = join(workspacePath, '.planning', 'plan.vbrief.json');
    if (!existsSync(planPath)) {
      return jsonResponse(
        { success: false, error: `No vBRIEF plan at ${planPath} — run planning first.` },
        409,
      );
    }

    const { createBeadsFromVBrief } = yield* Effect.promise(() => import('../../../lib/vbrief/beads.js'));
    const result = yield* Effect.promise(() => createBeadsFromVBrief(workspacePath));

    if (!result.success || result.created.length === 0) {
      const errors = result.errors.length > 0 ? result.errors : ['Beads creation produced no tasks'];
      return jsonResponse({ success: false, created: result.created, errors }, 500);
    }

    const markerPath = join(workspacePath, '.planning', '.planning-complete');
    yield* Effect.promise(() => writeFile(markerPath, '', 'utf-8'));

    return jsonResponse({
      success: true,
      created: result.created,
      count: result.created.length,
    });
  })),
);

// ─── Route: GET /api/issues/:id/costs ────────────────────────────────────────

const getIssueCostsRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/costs',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';

    syncCache();
    const issueData = getCostsForIssue(id);

    if (!issueData) {
      return jsonResponse({
        issueId: id.toUpperCase(),
        totalCost: 0,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        models: {},
        providers: {},
        byModel: {},
        byStage: {},
        budget: undefined,
        budgetWarning: false,
      });
    }

    return jsonResponse({
      issueId: id.toUpperCase(),
      totalCost: issueData.totalCost,
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

// ─── Compose all routes into a single Layer ───────────────────────────────────

export const issuesRouteLayer = Layer.mergeAll(
  getIssuesRoute,
  getIssueAnalyzeRoute,
  postIssuePlanRoute,
  getIssueHandoffsRoute,
  postIssueCloseRoute,
  postIssueStartPlanningRoute,
  postIssueAbortPlanningRoute,
  postIssueCompletePlanningRoute,
  postIssueAbortRoute,
  postIssueResetRoute,
  postIssueCancelRoute,
  postIssueReopenRoute,
  postIssueMoveStatusRoute,
  postIssueCleanupWorkspaceRoute,
  postIssueDeepWipeRoute,
  postIssueCloseOutRoute,
  getIssueBeadsRoute,
  getIssuePlanningStateRoute,
  postIssueGenerateTasksRoute,
  getIssueCostsRoute,
);

export default issuesRouteLayer;

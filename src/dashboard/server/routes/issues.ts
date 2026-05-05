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
 *   GET  /api/issues/:id/costs
 */

import { exec, execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnPlanningSession, type PlanningIssue } from '../../../lib/planning/spawn-planning-session.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { withBdMutex } from '../utils/bd-mutex.js';

import { Effect, Layer, Option, Stream } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { extractTeamPrefix, findProjectByTeam, resolveProjectFromIssue } from '../../../lib/projects.js';
import { extractPrefix, parseIssueId } from '../../../lib/issue-id.js';
import { findPlan, isPlanningComplete, readPlan } from '../../../lib/vbrief/io.js';
import { appendContinueSessionEntryForIssue } from '../../../lib/vbrief/lifecycle-io.js';
import { asPanSpecDocument, findSpecByIssue, writeSpec, writeSpecForIssue } from '../../../lib/pan-dir/index.js';
import { loadWorkspaceMetadata as loadWorkspaceMetadataStatic } from '../../../lib/remote/workspace-metadata.js';
import { resolveGitHubIssue as resolveGitHubIssueShared, resolveTrackerType } from '../../../lib/tracker-utils.js';
import { clearReviewStatus } from '../review-status.js';
import { reopenWorkspaceState } from '../../../lib/reopen.js';
import { getGitHubConfig, getRallyConfig } from '../services/tracker-config.js';
import { syncCache, getCostsForIssue } from '../../../lib/costs/index.js';
import { IssueDataService } from '../services/issue-data-service.js';
import { getSharedIssueService } from '../services/issue-service-singleton.js';
import { CacheService } from '../services/cache-service.js';
import { EventStoreService } from '../services/domain-services.js';
import { resolveIssueHeadlineCost } from '../services/issue-cost-resolver.js';
import { getCachedRunningAgents } from '../services/running-agents-cache.js';
import { invalidateAgentsCache } from './agents.js';
import { IssueLifecycle, type IssueState } from '../services/issue-lifecycle.js';
import { LinearClient } from '../services/linear-client.js';
import { GitHubClient } from '../services/github-client.js';
import { RallyClient } from '../services/rally-client.js';
import { killSessionAsync, listSessionNamesAsync, sessionExistsAsync } from '../../../lib/tmux.js';
import { getAgentStateAsync, normalizeAgentId } from '../../../lib/agents.js';
import { emitActivityEntry, emitActivityTts } from '../../../lib/activity-logger.js';
import type { LifecycleContext, StepResult } from '../../../lib/lifecycle/types.js';
import {
  getCachedResourceAllocatedIssues,
  getResourceDetailIdentifiers,
  sanitizeResourceAllocatedIssues,
} from '../services/resource-discovery.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// ─── Shared IssueDataService singleton ───────────────────────────────────────
// Started by main.ts on boot. Updates flow through the ReadModel via
// onIssuesChanged callback → event store → WebSocket RPC.

function getIssueDataService(): IssueDataService {
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

/** Map Rally child-issue service contract into the planning-context shape. */
export function buildChildStoriesFromRally(
  children: readonly { ref: string; title: string; status: string; description: string }[],
): Array<{ ref: string; title: string; status: string; description: string }> {
  return children.map((c) => ({
    ref: c.ref,
    title: c.title,
    status: c.status,
    description: c.description || '',
  }));
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
    const { stdout: prListRaw } = await execFileAsync(
      'gh',
      [
        'pr', 'list',
        '--repo', `${githubCheck.owner}/${githubCheck.repo}`,
        '--head', branchName,
        '--state', 'open',
        '--json', 'number',
        '--jq', '.[0].number',
      ],
      { encoding: 'utf-8', timeout: 15000 },
    );
    const prNumber = prListRaw.trim();
    if (!prNumber) {
      return ['No open PR found for branch'];
    }

    await execFileAsync(
      'gh',
      [
        'pr', 'close', prNumber,
        '--repo', `${githubCheck.owner}/${githubCheck.repo}`,
        '--comment', reason,
      ],
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

function isOrphanedIssue(issue: { status?: string; state?: string; rawTrackerState?: string; completedAt?: string | null }): boolean {
  const status = issue.status?.toLowerCase() ?? '';
  const state = issue.state?.toLowerCase() ?? '';
  const rawTrackerState = issue.rawTrackerState?.toLowerCase() ?? '';
  return Boolean(
    issue.completedAt
    || status.includes('closed')
    || status.includes('done')
    || status.includes('completed')
    || state.includes('closed')
    || state.includes('done')
    || state.includes('completed')
    || rawTrackerState.includes('closed')
    || rawTrackerState.includes('done')
    || rawTrackerState.includes('completed'),
  );
}

function getIssueForCleanup(issueId: string) {
  const issueDataService = getIssueDataService();
  return issueDataService.getIssues({ includeCompleted: true }).find((issue: any) => {
    const identifier = typeof issue?.identifier === 'string' ? issue.identifier : '';
    return identifier.toUpperCase() === issueId.toUpperCase();
  }) as {
    status?: string;
    state?: string;
    rawTrackerState?: string;
    completedAt?: string | null;
  } | undefined;
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

  // vBRIEF lifecycle transition for cancel (PAN-946): move to cancelled/ on main.
  if (mode === 'cancel') {
    try {
      const { transitionVBriefOnMain } = await import('../../../lib/vbrief/lifecycle-io.js');
      const tx = await transitionVBriefOnMain(
        ctx.projectPath,
        id,
        'cancelled',
        'cancelled',
        `scope: cancel ${id.toUpperCase()} vBRIEF`,
      );
      if (tx.moved) cleanupLog.push(`vBRIEF moved ${tx.fromDir} → cancelled`);
      if (tx.committed) cleanupLog.push(`Committed vBRIEF cancellation on main`);
    } catch (err: any) {
      cleanupLog.push(`vBRIEF cancel transition failed (non-fatal): ${err?.message ?? err}`);
    }
  }

  // Kill canonical reviewer/synthesis tmux sessions (PAN-915). They persist
  // across review rounds to preserve context, so reset/cancel/deep-wipe is the
  // right place to tear them down — the issue is going back to Todo or being
  // canceled outright.
  try {
    const { killAllReviewerSessions } = await import('../../../lib/cloister/review-agent.js');
    const { resolveProjectFromIssue } = await import('../../../lib/projects.js');
    const resolved = resolveProjectFromIssue(id);
    const projectKey = resolved?.projectKey;
    if (projectKey) {
      const { killed } = await killAllReviewerSessions(projectKey, id.toUpperCase());
      if (killed.length > 0) {
        cleanupLog.push(`Killed ${killed.length} reviewer session(s)`);
      }
    }
  } catch (err) {
    cleanupLog.push(`Reviewer session cleanup failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }

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

    // Clear agents cache so the next dashboard poll sees the new planning agent
    invalidateAgentsCache();

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
      artifactType?: string;
      childStories?: Array<{ ref: string; title: string; status: string; description: string }>;
    };
    let newStateName = 'In Planning';

    if (trackerTypeForIssue === 'github' && githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number) {
      const { owner, repo, number } = githubCheck as { owner: string; repo: string; number: number };
      const ghIssue = yield* github.getIssue(owner, repo, number);

      const ghConfig = getGitHubConfig();
      const repoConfig = ghConfig?.repos.find((r: any) => r.owner === owner && r.repo === repo);
      const prefix = repoConfig?.prefix || repo.toUpperCase();

      const ghComments = yield* github.getComments(owner, repo, number, 50).pipe(
        Effect.map((cs) => cs.map((c) => ({ author: c.user, body: c.body, createdAt: c.createdAt }))),
        Effect.catch(() => Effect.succeed([] as Array<{ author: string; body: string; createdAt: string }>)),
      );

      issue = {
        id: `github-${owner}-${repo}-${number}`,
        identifier: `${prefix}-${number}`,
        title: ghIssue.title,
        description: ghIssue.body || '',
        url: ghIssue.htmlUrl,
        source: 'github',
        comments: ghComments.length > 0 ? ghComments : undefined,
      };

      // Add "planning" label (ensure it exists, then apply to issue)
      yield* lifecycle.addLabel(id, 'planning').pipe(Effect.catch(() => Effect.void));

    } else if (trackerTypeForIssue === 'rally') {
      const rallyIssue = yield* rally.getIssue(id);

      // Fetch child stories for Rally Features
      let childStories: Array<{ ref: string; title: string; status: string; description: string }> = [];
      if (rallyIssue.artifactType?.includes('PortfolioItem')) {
        const children = yield* rally.getChildIssues(id).pipe(
          Effect.catch(() => Effect.succeed([] as readonly { ref: string; title: string; status: string; description: string }[])),
        );
        childStories = buildChildStoriesFromRally(children);
      }

      issue = {
        id: rallyIssue.id,
        identifier: rallyIssue.ref,
        title: rallyIssue.title,
        description: rallyIssue.description || '',
        url: rallyIssue.url,
        source: 'rally',
        artifactType: rallyIssue.artifactType,
        childStories: childStories.length > 0 ? childStories : undefined,
      };

    } else {
      // Linear
      const linearIssue = yield* linear.getIssue(id);

      issue = {
        id: linearIssue.id,
        identifier: linearIssue.identifier,
        title: linearIssue.title,
        description: linearIssue.description || '',
        url: linearIssue.url,
        source: 'linear',
      };

      // Transition to "In Planning" state
      yield* lifecycle.transitionTo(id, 'in_planning').pipe(Effect.catch(() => Effect.void));
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
      agentPhase: 'planning',
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
      revertedState = 'Todo';
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
              await execFileAsync('pan', ['workspace', 'destroy', issueIdentifier!.toLowerCase(), '--force'], {
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

    // Clear agents cache so the dashboard stops showing the planning agent as active
    invalidateAgentsCache();

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
      yield* Effect.promise(async () => {
        try {
          await killSessionAsync(sessionName);
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          if (!/can't find session|session not found|no session found/i.test(msg)) {
            console.error(`[complete-planning] kill-session failed for ${sessionName}:`, msg);
          }
        }
      });
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

      const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
      const workspacePlanPath = findPlan(workspacePath);

      let gitRoot = '';
      if (workspacePlanPath) gitRoot = workspacePath;

      if (!gitRoot) return { pushed: false, beadsWarning: null };

      try {

        // Beads are created by the planning agent via `pan plan-finalize`.
        // By the time this endpoint runs, the workspace spec and beads are expected
        // to already exist. We do not create beads here — fixing the planning
        // prompt is the right place to enforce that contract.
        const beadsWarning: string | null = null;

        // Copy the workspace vBRIEF into the project root's canonical
        // .pan/specs/ store with root status=proposed, then commit that spec on
        // main with `scope: propose <ID> vBRIEF`.
        try {
          const upperIssueId = id.toUpperCase();
          if (!workspacePlanPath) {
            throw new Error(`No workspace vBRIEF found for ${upperIssueId}`);
          }

          const workspaceDoc = readPlan(workspacePlanPath);
          const canonicalFilename = workspaceDoc.plan.metadata?.canonicalFilename;
          const existingSpec = findSpecByIssue(projectPath, upperIssueId);
          const proposed = existingSpec
            ? (() => {
                const nextDoc = asPanSpecDocument(workspaceDoc, 'proposed');
                writeSpec(existingSpec.path, nextDoc);
                return { path: existingSpec.path, filename: existingSpec.filename };
              })()
            : writeSpecForIssue(projectPath, workspaceDoc, 'proposed', canonicalFilename);
          console.log(`[complete-planning] Wrote pan spec to ${proposed.path}`);

          const filesToStage = [`.pan/specs/${proposed.filename}`];

          try {
            const { stdout: branchStdout } = await execAsync(
              'git rev-parse --abbrev-ref HEAD',
              { cwd: projectPath, encoding: 'utf-8' },
            );
            const currentBranch = branchStdout.trim();
            if (currentBranch === 'main') {
              const quoted = filesToStage.map(f => `"${f}"`).join(' ');
              await execAsync(`git add -- ${quoted}`, { cwd: projectPath, encoding: 'utf-8' });
              try {
                await execAsync(`git diff --cached --quiet -- ${quoted}`, { cwd: projectPath, encoding: 'utf-8' });
              } catch {
                await execAsync(
                  `git commit -m "scope: propose ${upperIssueId} vBRIEF" -- ${quoted}`,
                  { cwd: projectPath, encoding: 'utf-8' },
                );
                console.log(`[complete-planning] Committed pan spec on main for ${upperIssueId}`);
                try {
                  const { stdout: remotes } = await execAsync('git remote', { cwd: projectPath, encoding: 'utf-8' });
                  if (remotes.trim()) {
                    const pushChild = spawn('git', ['push'], { cwd: projectPath, detached: true, stdio: 'ignore' });
                    pushChild.unref();
                  }
                } catch { /* push failed — no remote or auth — non-fatal */ }
              }
            } else {
              console.log(`[complete-planning] Project root not on main (${currentBranch}) — pan spec updated on disk but not committed on main`);
            }
          } catch (gitErr: any) {
            console.warn(`[complete-planning] pan spec commit failed (non-fatal): ${gitErr?.message ?? gitErr}`);
          }
        } catch (copyErr: any) {
          console.warn(`[complete-planning] pan spec update failed (non-fatal): ${copyErr?.message ?? copyErr}`);
        }

        // Sync beads
        try {
          await withBdMutex(() => execAsync('bd sync 2>/dev/null || true', { cwd: gitRoot, encoding: 'utf-8', timeout: 10000 }));
        } catch { /* bd might not be installed */ }

        // The proposed planning state is written by `pan plan-finalize` from the
        // planning agent, not here. The Done button is gated on that workspace
        // state, so by the time this endpoint fires it is already on disk.

        // Git operations
        const isGitRepo = existsSync(join(gitRoot, '.git'));
        if (!isGitRepo) {
          await execAsync('git init', { cwd: gitRoot, encoding: 'utf-8' });
        }

        if (existsSync(join(gitRoot, '.pan'))) {
          await execAsync('git add -f .pan/', { cwd: gitRoot, encoding: 'utf-8' });
        }
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

    // Clear agents cache so the dashboard stops showing the planning agent as active
    invalidateAgentsCache();

    // Emit activity + TTS for planning completion
    emitActivityEntry({
      source: 'planning-agent',
      level: 'info',
      message: `${id} planning complete — ready for work`,
      issueId: id,
    });
    emitActivityTts({
      utterance: `${id} planning complete, ready for work`,
      priority: 2,
      issueId: id,
    });

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
      // Reset specialist pipeline state, remove from queues, and update continue file
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
              const { stdout: bdCheck } = await withBdMutex(() => execAsync(
                `bd list --json -l ${issueLower} --limit 1`,
                { cwd: workspacePath, encoding: 'utf-8', timeout: 10000 },
              ));
              const existing = JSON.parse(bdCheck.trim() || '[]');
              if (existing.length === 0) {
                const result = await withBdMutex(() => createBeadsFromVBrief(workspacePath));
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

// ─── Route: POST /api/issues/:id/restart-from-plan ────────────────────────────

const postIssueRestartFromPlanRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/restart-from-plan',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const lifecycle = yield* IssueLifecycle;
    const eventStore = yield* EventStoreService;
    const issueLower = id.toLowerCase();

    // 1. Resolve workspace path
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

    if (!workspacePath || !existsSync(workspacePath)) {
      return jsonResponse({ success: false, error: 'Workspace not found' }, { status: 404 });
    }

    // 2. Kill work agent tmux session and remove agent state dir
    yield* Effect.promise(async () => {
      const workAgentSession = `agent-${issueLower}`;
      try {
        if (await sessionExistsAsync(workAgentSession)) {
          await killSessionAsync(workAgentSession);
          console.log(`[restart-from-plan] Killed work agent session ${workAgentSession}`);
        }
      } catch { /* non-fatal */ }
      const agentStateDir = join(homedir(), '.panopticon', 'agents', `agent-${issueLower}`);
      if (existsSync(agentStateDir)) {
        try {
          await rm(agentStateDir, { recursive: true, force: true });
          console.log(`[restart-from-plan] Removed agent state dir ${agentStateDir}`);
        } catch { /* non-fatal */ }
      }
    });

    // 2b. Clean up stale specialist artifacts (.pan/ and feedback) that survive git resets
    yield* Effect.promise(async () => {
      const dirsToClean = [
        join(workspacePath, '.pan', 'review'),
        join(workspacePath, '.pan', 'prompts'),
        join(workspacePath, '.pan', 'events'),
        join(workspacePath, '.pan', 'feedback'),
      ];
      for (const dir of dirsToClean) {
        if (existsSync(dir)) {
          try {
            await rm(dir, { recursive: true, force: true });
            console.log(`[restart-from-plan] Cleaned ${dir}`);
          } catch { /* non-fatal */ }
        }
      }
    });

    // 3. Find the planning commit and reset to it.
    //
    // Planning commits come from two sources:
    //   - complete-planning endpoint: "Complete planning for PAN-XXX"
    //   - agent start flow: "chore: planning artifacts for PAN-XXX before agent start"
    // Fall back to finding the commit that added `.pan/spec.vbrief.json`.
    //
    // If no planning commit is found, we DO NOT auto-clean. The previous
    // behaviour used a broad git-clean fallback that
    // silently destroyed `.devcontainer/`, `.env`, `node_modules/`, and
    // anything else untracked — see PAN-955/956. The fix is to surface a
    // structured error pointing the user at `pan workspace deep-clean <id>`,
    // which they invoke from a TTY after seeing what would be deleted.
    type ResetOutcome =
      | { success: true; commit: string; method: string }
      | {
          success: false;
          code: 'DANGEROUS_OP_BLOCKED';
          operation: 'git_clean';
          reason: string;
          recovery: string;
        }
      | { success: false; error: string };

    const resetResult = yield* Effect.promise(async (): Promise<ResetOutcome> => {
      try {
        const { runGitResetHard } = await import('../../../lib/safety/dangerous-git-ops.js');

        async function findPlanningCommit(grep: string, label: string): Promise<{ sha: string; method: string } | null> {
          try {
            const { stdout } = await execAsync(
              `git log --grep="${grep.replace(/"/g, '\\"')}" --format=%H -1`,
              { cwd: workspacePath, encoding: 'utf-8', timeout: 10_000 },
            );
            const sha = stdout.trim();
            return sha ? { sha, method: label } : null;
          } catch {
            return null;
          }
        }

        const found =
          (await findPlanningCommit(`Complete planning for ${id}`, 'complete-planning message')) ??
          (await findPlanningCommit(`chore: planning artifacts for ${id}`, 'agent-start message')) ??
          (await (async () => {
            try {
              const { stdout } = await execAsync(
                `git log --diff-filter=A --format=%H -1 -- .pan/spec.vbrief.json`,
                { cwd: workspacePath, encoding: 'utf-8', timeout: 10_000 },
              );
              const sha = stdout.trim();
              return sha ? { sha, method: '.pan/spec.vbrief.json add' } : null;
            } catch {
              return null;
            }
          })());

        if (!found) {
          // No tracked planning state to reset to. Refuse to auto-clean —
          // the user has to opt in via `pan workspace deep-clean <id>`.
          return {
            success: false,
            code: 'DANGEROUS_OP_BLOCKED',
            operation: 'git_clean',
            reason:
              `restart-from-plan could not find a planning commit for ${id}. The previous ` +
              `behaviour was to auto-clean untracked files, which silently destroyed .devcontainer/, ` +
              `.env, and other regenerable artifacts. That auto-clean is no longer allowed.`,
            recovery:
              `Run \`pan workspace deep-clean ${issueLower}\` from a terminal — it will list every ` +
              `untracked file/dir before deleting anything and ask you to confirm. After that, retry ` +
              `restart-from-plan.`,
          };
        }

        await runGitResetHard({
          workspacePath,
          ref: found.sha,
          reason: `restart-from-plan ${id} (${found.method})`,
        });
        console.log(`[restart-from-plan] Reset branch to planning commit ${found.sha} for ${id}`);
        return { success: true, commit: found.sha, method: found.method };
      } catch (err: any) {
        return { success: false, error: err.message || 'Git reset failed' };
      }
    });

    if (!resetResult.success) {
      if ('code' in resetResult && resetResult.code === 'DANGEROUS_OP_BLOCKED') {
        return jsonResponse(
          {
            success: false,
            error: resetResult.reason,
            code: resetResult.code,
            operation: resetResult.operation,
            recovery: resetResult.recovery,
          },
          { status: 409 },
        );
      }
      return jsonResponse({ success: false, error: resetResult.error }, { status: 400 });
    }

    // 4. Reset specialist pipeline states
    clearReviewStatus(id.toUpperCase());

    // 5. Append restart entry to continue file (lifecycle-aware)
    yield* Effect.promise(async () => {
      const upperId = id.toUpperCase();
      try {
        appendContinueSessionEntryForIssue(projectPath, upperId, {
          reason: 'resume',
          note: `Restarted from plan — branch reset to planning commit ${resetResult.commit}. Specialist states cleared.`,
        });
      } catch {
        // Non-fatal: continue file may not exist yet
      }
    });

    // 6. Move issue to In Progress
    yield* lifecycle.transitionTo(id, 'in_progress').pipe(Effect.catch(() => Effect.void));

    // 7. Emit events
    yield* eventStore.append({
      type: 'agent.stopped',
      timestamp: new Date().toISOString(),
      payload: { agentId: `agent-${issueLower}` },
    } as any);
    yield* eventStore.append({
      type: 'issue.statusChanged',
      timestamp: new Date().toISOString(),
      payload: { issueId: id, status: 'In Progress', canonicalStatus: 'in_progress' },
    });
    yield* eventStore.append({
      type: 'pipeline.status_changed',
      timestamp: new Date().toISOString(),
      payload: {
        issueId: id,
        status: {
          issueId: id,
          reviewStatus: 'pending',
          testStatus: 'pending',
          readyForMerge: false,
        },
      },
    });
    try { getIssueDataService().patchIssue(id, { status: 'In Progress', canonicalStatus: 'in_progress' }); } catch { /* non-fatal */ }

    return jsonResponse({
      success: true,
      message: `Issue ${id} restarted from plan. Branch reset to ${resetResult.commit}`,
      issueId: id,
      newState: 'In Progress',
      planningCommit: resetResult.commit,
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
    const rawId = params['id'] ?? '';
    const parsedIssueId = parseIssueId(rawId);
    if (!parsedIssueId) {
      return jsonResponse({ error: 'Invalid issue id: ' + rawId }, { status: 400 });
    }
    const id = parsedIssueId.raw.toUpperCase();
    const issue = getIssueForCleanup(id);
    if (!issue || !isOrphanedIssue(issue)) {
      return jsonResponse({ error: 'Cleanup is only allowed for closed/orphaned issues' }, { status: 409 });
    }
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
    if (!parseIssueId(id)) {
      return jsonResponse({ error: 'Invalid issue id: ' + id }, { status: 400 });
    }
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

// ─── Route: POST /api/issues/:id/copy-settings ───────────────────────────────

const postIssueCopySettingsRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/copy-settings',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';

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
      ? join(projectPath, 'workspaces', `feature-${id.toLowerCase()}`)
      : '';

    if (!workspacePath || !existsSync(workspacePath)) {
      return jsonResponse({ success: false, error: 'Workspace not found' }, { status: 404 });
    }

    const { copyPanopticonSettingsToWorkspace } = yield* Effect.promise(() =>
      import('../../../lib/workspace-manager.js')
    );

    const result = copyPanopticonSettingsToWorkspace(workspacePath);
    return jsonResponse({
      success: result.errors.length === 0 || result.copied.length > 0,
      copied: result.copied.map(p => p.replace(workspacePath + '/', '')),
      errors: result.errors,
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
      // Patch cached labels immediately so the board hides the issue right away
      // without waiting for the background tracker refresh.
      let newLabels: string[] = ['closed-out'];
      try {
        const cachedIssues = issueDataService.getIssues();
        const cachedIssue = cachedIssues.find(
          (i: any) => (i.identifier || '').toUpperCase() === id.toUpperCase()
        );
        const currentLabels: string[] = cachedIssue?.labels || [];
        newLabels = [
          ...currentLabels.filter((l: string) => !['in-review', 'in-progress', 'needs-close-out'].includes(l.toLowerCase())),
          'closed-out',
        ];
        issueDataService.patchIssue(id, { status: 'Done', canonicalStatus: 'done', labels: newLabels });
      } catch { /* non-fatal */ }

      yield* eventStore.append({
        type: 'issue.statusChanged',
        timestamp: new Date().toISOString(),
        payload: { issueId: id, status: 'Done', canonicalStatus: 'done', labels: newLabels },
      });

      // Refresh tracker data in background so cache stays consistent
      issueDataService.invalidateTracker('github').catch(() => {});
      issueDataService.invalidateTracker('linear').catch(() => {});
    }

    return jsonResponse({
      success: result.success,
      issueId: result.issueId,
      steps: result.steps.map((s: StepResult) => ({
        name: s.step,
        status: s.success ? (s.skipped ? 'skipped' : 'passed') : 'failed',
        message: s.error || (s.details ? s.details.join('; ') : undefined),
      })),
      error: result.success ? undefined : result.steps.find((s: StepResult) => !s.success)?.error,
    });
  })),
);

const MAX_BULK_CLOSE_OUT = 50;

const VALID_TMUX_NAME_RE = /^[a-zA-Z0-9._-]+$/;

/** Normalize an issue ID to a planning session name, mirroring normalizeAgentId logic. */
function normalizePlanningId(issueId: string): string {
  if (issueId.startsWith('planning-')) return issueId;
  return `planning-${issueId.toLowerCase()}`;
}

async function hasActiveAgentForIssue(issueId: string): Promise<boolean> {
  const agentId = normalizeAgentId(issueId);
  const planningId = normalizePlanningId(issueId);

  // Only query tmux for valid session names (GitHub IDs like owner/repo#123 produce invalid names)
  if (VALID_TMUX_NAME_RE.test(agentId) && await sessionExistsAsync(agentId)) return true;
  if (VALID_TMUX_NAME_RE.test(planningId) && await sessionExistsAsync(planningId)) return true;

  const agentState = await getAgentStateAsync(agentId);
  if (agentState && agentState.status !== 'dead' && agentState.status !== 'stopped' && agentState.status !== 'failed') return true;

  const planningState = await getAgentStateAsync(planningId);
  if (planningState && planningState.status !== 'dead' && planningState.status !== 'stopped' && planningState.status !== 'failed') return true;

  return false;
}

// ─── Route: POST /api/issues/bulk-close-out ──────────────────────────────────

/** Validate issue ID format (PAN-123, TEAM-456, or GitHub owner/repo#number) */
function isValidIssueId(id: string): boolean {
  if (typeof id !== 'string') return false;
  // Linear-style: PREFIX-123
  if (/^[A-Z][A-Z0-9]*-\d+$/.test(id)) return true;
  // GitHub-style: owner/repo#number (alphanumeric, hyphens, underscores, periods only)
  if (/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+#\d+$/.test(id)) return true;
  return false;
}

const postIssuesBulkCloseOutRoute = HttpRouter.add(
  'POST',
  '/api/issues/bulk-close-out',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;

    // Content-Type enforcement — exact match, no substring trickery
    const contentType = (request.headers as Record<string, string | string[] | undefined>)['content-type'];
    const contentTypeStr = Array.isArray(contentType) ? contentType[0] : contentType;
    const isJsonContentType = (() => {
      if (!contentTypeStr) return false;
      const [mime] = contentTypeStr.toLowerCase().split(';');
      return mime.trim() === 'application/json';
    })();
    if (!isJsonContentType) {
      return jsonResponse({ error: 'Content-Type must be application/json' }, { status: 400 });
    }

    const text = yield* request.text;
    const body: Record<string, unknown> = (() => { try { return text ? JSON.parse(text) : {}; } catch { return {}; } })();
    const rawIssueIds = Array.isArray(body.issueIds) ? body.issueIds : [];
    const issueIds = [...new Set(rawIssueIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))];

    // Origin check — parse as URL and validate hostname exactly
    const origin = (request.headers as Record<string, string | string[] | undefined>)['origin'];
    const originStr = Array.isArray(origin) ? origin[0] : origin;
    const isValidOrigin = (() => {
      // Same-origin requests omit the Origin header — accept them.
      if (!originStr) return true;
      try {
        const url = new URL(originStr);
        return (
          url.hostname === 'localhost' ||
          url.hostname === '127.0.0.1' ||
          url.hostname.endsWith('.localhost')
        );
      } catch {
        return false;
      }
    })();
    if (!isValidOrigin) {
      return jsonResponse({ error: 'Invalid origin' }, { status: 403 });
    }

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

    // Sequential execution — closeOut touches filesystem/git, parallel runs risk index-lock races
    const results: Array<{ issueId: string; success: boolean; error?: string; skipped: boolean }> = [];
    for (const id of issueIds) {
      // Server-side active-agent guardrail
      const hasActiveAgent = yield* Effect.promise(() => hasActiveAgentForIssue(id));
      if (hasActiveAgent) {
        results.push({ issueId: id, success: false, error: 'Skipped: active agent running', skipped: true });
        continue;
      }

      const githubCheck = isGitHubIssue(id);
      let projectPath = '';

      if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
        const localPaths = getGitHubLocalPaths();
        projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`] || '';
      }
      if (!projectPath) {
        const issuePrefix = extractPrefix(id);
        if (issuePrefix) {
          projectPath = getProjectPath(undefined, issuePrefix);
        }
      }
      if (!projectPath) {
        results.push({ issueId: id, success: false, error: `Could not resolve project path for ${id}`, skipped: false });
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

      const closeResult = yield* Effect.tryPromise({
        try: () => closeOut(ctx),
        catch: (error) => ({
          workflow: 'close-out' as const,
          issueId: id,
          success: false,
          steps: [{
            step: 'close-out',
            success: false,
            skipped: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          }],
          duration: 0,
        }),
      });

      if (closeResult.success) {
        let newLabels: string[] = ['closed-out'];
        try {
          const cachedIssues = issueDataService.getIssues();
          const cachedIssue = cachedIssues.find(
            (i: any) => (i.identifier || '').toUpperCase() === id.toUpperCase()
          );
          const currentLabels: string[] = cachedIssue?.labels || [];
          newLabels = [
            ...currentLabels.filter((l: string) => !['in-review', 'in-progress', 'needs-close-out'].includes(l.toLowerCase())),
            'closed-out',
          ];
          issueDataService.patchIssue(id, { status: 'Done', canonicalStatus: 'done', labels: newLabels });
        } catch (e) {
          console.error('Failed to patch issue status:', e);
        }
        yield* eventStore.append({
          type: 'issue.statusChanged',
          timestamp: new Date().toISOString(),
          payload: { issueId: id, status: 'Done', canonicalStatus: 'done', labels: newLabels },
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
        const { stdout } = await withBdMutex(() => execAsync(`bd list --json -l "${id.toLowerCase()}" --status all --limit 0`, {
          cwd: bdSearchDir,
          encoding: 'utf-8',
          timeout: 10000,
        }));
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
    const planPath = workspacePath ? findPlan(workspacePath) : null;
    const hasPlan = planPath !== null;
    // planningComplete now means "plan.status indicates planning has finished" —
    // any of proposed/approved/pending/running/completed/blocked.
    // It's the definitive signal for "tasks have been generated from this plan."
    const planningComplete = workspacePath ? isPlanningComplete(workspacePath) : false;

    const hasBeads = !!planningComplete;

    return jsonResponse({
      hasPlan,
      hasBeads,
      beadsCount: 0,  // Deprecated — use hasBeads. Kept for backward compat.
      planningComplete,
      workspacePath,
    });
  })),
);

// ─── Route: POST /api/issues/:id/generate-tasks ──────────────────────────────
//
// Runs createBeadsFromVBrief() against the workspace. Same logic as
// `pan plan-finalize`, exposed so the
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
    const planPath = findPlan(workspacePath);
    if (!planPath || !existsSync(planPath)) {
      return jsonResponse(
        { success: false, error: `No vBRIEF plan at ${join(workspacePath, '.pan', 'spec.vbrief.json')} — run planning first.` },
        409,
      );
    }

    const { createBeadsFromVBrief } = yield* Effect.promise(() => import('../../../lib/vbrief/beads.js'));
    const result = yield* Effect.promise(() => withBdMutex(() => createBeadsFromVBrief(workspacePath)));

    if (!result.success || result.created.length === 0) {
      const errors = result.errors.length > 0 ? result.errors : ['Beads creation produced no tasks'];
      return jsonResponse({ success: false, created: result.created, errors }, 500);
    }

    return jsonResponse({
      success: true,
      created: result.created,
      count: result.created.length,
    });
  })),
);

// ─── Route: GET /api/issues/:id/pr ───────────────────────────────────────────
//
// Shells out to `gh pr view --head feature/<id-lower> --repo <owner>/<repo>`
// and `gh pr diff <number> --repo <owner>/<repo> --patch` to assemble a
// structured response for the Command Deck PR/Diff tab. Returns
// `{ pr: null, diff: null }` when the issue is not a GitHub-tracked issue or
// no PR exists for the feature branch yet.

const GH_PR_VIEW_FIELDS = [
  'number',
  'title',
  'url',
  'state',
  'isDraft',
  'baseRefName',
  'headRefName',
  'author',
  'createdAt',
  'updatedAt',
  'reviewDecision',
  'reviewRequests',
  'statusCheckRollup',
  'additions',
  'deletions',
  'changedFiles',
  'files',
  'labels',
  'mergeable',
  'body',
].join(',');

export interface IssuePullRequestData {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  baseRefName: string;
  headRefName: string;
  author: { login?: string; name?: string } | null;
  createdAt: string;
  updatedAt: string;
  reviewDecision: string | null;
  reviewRequests: Array<{ login?: string; name?: string; __typename?: string }>;
  statusCheckRollup: Array<{
    name?: string;
    state?: string;
    conclusion?: string;
    status?: string;
    detailsUrl?: string;
    workflowName?: string;
    __typename?: string;
  }>;
  additions: number;
  deletions: number;
  changedFiles: number;
  files: Array<{ path: string; additions: number; deletions: number }>;
  labels: Array<{ name?: string; color?: string }>;
  mergeable: string | null;
  body: string;
}

export interface IssuePrEndpointResponse {
  issueId: string;
  pr: IssuePullRequestData | null;
  error?: string;
}

export interface IssuePrDiffEndpointResponse {
  issueId: string;
  diff: string | null;
  error?: string;
}

export interface IssuePrDetailsResponse extends IssuePrEndpointResponse {
  diff: string | null;
}

async function resolveIssuePullRequestRef(issueId: string): Promise<
  | { issueId: string; repoArg: string; prNumber: string }
  | { issueId: string; repoArg: null; prNumber: null; error?: string }
> {
  const upper = issueId.toUpperCase();
  const githubCheck = isGitHubIssue(issueId);
  if (!githubCheck.isGitHub || !githubCheck.owner || !githubCheck.repo) {
    return { issueId: upper, repoArg: null, prNumber: null };
  }

  const branchName = `feature/${issueId.toLowerCase()}`;
  const repoArg = `${githubCheck.owner}/${githubCheck.repo}`;

  try {
    const { stdout } = await execFileAsync(
      'gh',
      [
        'pr', 'list',
        '--repo', repoArg,
        '--head', branchName,
        '--state', 'all',
        '--json', 'number',
        '--limit', '1',
        '--jq', '.[0].number',
      ],
      { encoding: 'utf-8', timeout: 15000 },
    );
    const prNumber = stdout.trim();
    if (!prNumber) {
      return { issueId: upper, repoArg: null, prNumber: null };
    }
    return { issueId: upper, repoArg, prNumber };
  } catch (err: any) {
    return { issueId: upper, repoArg: null, prNumber: null, error: `gh pr list failed: ${err.message}` };
  }
}

async function fetchIssuePullRequestFromRef(
  prRef: Awaited<ReturnType<typeof resolveIssuePullRequestRef>>,
): Promise<IssuePrEndpointResponse> {
  if (!prRef.repoArg || !prRef.prNumber) {
    return { issueId: prRef.issueId, pr: null, error: prRef.error };
  }

  try {
    const { stdout } = await execFileAsync(
      'gh',
      [
        'pr', 'view', prRef.prNumber,
        '--repo', prRef.repoArg,
        '--json', GH_PR_VIEW_FIELDS,
      ],
      { encoding: 'utf-8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
    );
    return {
      issueId: prRef.issueId,
      pr: JSON.parse(stdout) as IssuePullRequestData,
    };
  } catch (err: any) {
    return { issueId: prRef.issueId, pr: null, error: `gh pr view failed: ${err.message}` };
  }
}

export async function fetchIssuePullRequest(issueId: string): Promise<IssuePrEndpointResponse> {
  const prRef = await resolveIssuePullRequestRef(issueId);
  return fetchIssuePullRequestFromRef(prRef);
}

async function fetchIssuePullRequestDiffFromRef(
  prRef: Awaited<ReturnType<typeof resolveIssuePullRequestRef>>,
): Promise<IssuePrDiffEndpointResponse> {
  if (!prRef.repoArg || !prRef.prNumber) {
    return { issueId: prRef.issueId, diff: null, error: prRef.error };
  }

  try {
    const { stdout } = await execFileAsync(
      'gh',
      [
        'pr', 'diff', prRef.prNumber,
        '--repo', prRef.repoArg,
        '--patch',
      ],
      { encoding: 'utf-8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 },
    );
    return { issueId: prRef.issueId, diff: stdout };
  } catch (err: any) {
    return { issueId: prRef.issueId, diff: null, error: `gh pr diff failed: ${err.message}` };
  }
}

export async function fetchIssuePullRequestDiff(issueId: string): Promise<IssuePrDiffEndpointResponse> {
  const prRef = await resolveIssuePullRequestRef(issueId);
  return fetchIssuePullRequestDiffFromRef(prRef);
}

export async function fetchIssuePullRequestDetails(issueId: string): Promise<IssuePrDetailsResponse> {
  const prRef = await resolveIssuePullRequestRef(issueId);
  if (!prRef.repoArg || !prRef.prNumber) {
    return { issueId: prRef.issueId, pr: null, diff: null, error: prRef.error };
  }

  const [prResult, diffResult] = await Promise.all([
    fetchIssuePullRequestFromRef(prRef),
    fetchIssuePullRequestDiffFromRef(prRef),
  ]);

  return {
    issueId: prRef.issueId,
    pr: prResult.pr,
    diff: diffResult.diff,
    error: prResult.error ?? diffResult.error,
  };
}

const getIssuePrRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/pr',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
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
    const result = yield* Effect.promise(() => fetchIssuePullRequestDetails(id));
    return jsonResponse(result);
  })),
);

// ─── Route: GET /api/issues/:id/discussions ──────────────────────────────────
// Combined Linear + GitHub timeline. Sources merged into a single chronological
// list:
//   - Linear issue comments (when tracker resolves to Linear)
//   - GitHub issue comments (when tracker resolves to GitHub)
//   - GitHub PR conversation comments (when a feature/<id> PR exists)
//   - GitHub PR review submissions (approve / changes-requested / commented)
//   - GitHub PR inline review comments (review-thread replies on diff lines)
//
// Linear comments are fetched via the LinearClient service so we reuse the
// existing API key / retry plumbing. GitHub data is shelled out via `gh api`
// (consistent with the PR endpoint — same rationale as D13).

export type DiscussionSource =
  | 'linear'
  | 'github-issue'
  | 'github-pr-conversation'
  | 'github-pr-review'
  | 'github-pr-review-comment';

export interface DiscussionItem {
  id: string;
  source: DiscussionSource;
  author: string;
  body: string;
  createdAt: string;
  url?: string;
  prNumber?: number;
  reviewState?: string;
  filePath?: string;
  line?: number;
}

export interface IssueDiscussionsResponse {
  issueId: string;
  items: DiscussionItem[];
  prNumber: number | null;
  errors?: string[];
}

interface FetchDiscussionsDeps {
  /** Resolve a Linear issue ref ("MIN-449") to its UUID. */
  linearGetIssueId?: (ref: string) => Promise<string | null>;
  /** Fetch comments for a Linear issue UUID. */
  linearGetComments?: (
    uuid: string,
  ) => Promise<readonly { author: string; body: string; createdAt: string }[]>;
}

export async function fetchIssueDiscussions(
  issueId: string,
  deps: FetchDiscussionsDeps = {},
): Promise<IssueDiscussionsResponse> {
  const upper = issueId.toUpperCase();
  const items: DiscussionItem[] = [];
  const errors: string[] = [];
  let prNumber: number | null = null;

  const trackerType = resolveTrackerType(issueId);
  const githubCheck = isGitHubIssue(issueId);

  // Steps 1-3 are independent network calls. Fan them out with Promise.all
  // so the slowest governs total wall-clock instead of the sum (PAN-847).
  const linearTask = (async () => {
    // 1. Linear issue comments — only when tracker is Linear and deps provided.
    if (trackerType === 'linear' && deps.linearGetIssueId && deps.linearGetComments) {
      try {
        const uuid = await deps.linearGetIssueId(issueId);
        if (uuid) {
          const linearComments = await deps.linearGetComments(uuid);
          const collected: DiscussionItem[] = [];
          for (let i = 0; i < linearComments.length; i++) {
            const c = linearComments[i]!;
            collected.push({
              id: `linear-${uuid}-${i}`,
              source: 'linear',
              author: c.author,
              body: c.body,
              createdAt: c.createdAt,
            });
          }
          return collected;
        }
      } catch (err: any) {
        errors.push(`linear comments failed: ${err?.message ?? String(err)}`);
      }
    }
    return [] as DiscussionItem[];
  })();

  const ghIssueCommentsTask = (async () => {
    // 2. GitHub issue comments — only when the tracker resolves the issue to
    //    GitHub (not when we're in Linear and a PR happens to exist).
    if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number) {
      const { owner, repo, number } = githubCheck as { owner: string; repo: string; number: number };
      try {
        const { stdout } = await execAsync(
          `gh api "repos/${owner}/${repo}/issues/${number}/comments?per_page=100"`,
          { encoding: 'utf-8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
        );
        const arr = JSON.parse(stdout) as Array<{
          id: number;
          user?: { login?: string } | null;
          body?: string | null;
          created_at?: string;
          html_url?: string;
        }>;
        const collected: DiscussionItem[] = [];
        for (const c of arr) {
          collected.push({
            id: `gh-issue-${c.id}`,
            source: 'github-issue',
            author: c.user?.login ?? 'unknown',
            body: c.body ?? '',
            createdAt: c.created_at ?? '',
            url: c.html_url,
          });
        }
        return collected;
      } catch (err: any) {
        errors.push(`gh issue comments failed: ${err?.message ?? String(err)}`);
      }
    }
    return [] as DiscussionItem[];
  })();

  // 3. Resolve PR number for the feature branch (if a GitHub repo is mapped
  //    via tracker config). This is independent of the issue tracker — even
  //    Linear-tracked issues end up with feature/<id-lower> branches in a
  //    GitHub repo, so PR comments belong on the timeline.
  let prRepoArg: string | null = null;
  let prOwner: string | null = null;
  let prRepo: string | null = null;
  if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
    prRepoArg = `${githubCheck.owner}/${githubCheck.repo}`;
    prOwner = githubCheck.owner;
    prRepo = githubCheck.repo;
  } else {
    // Try the project-resolved repo (Linear-tracked issues whose project maps
    // to a GitHub repo — common for Panopticon).
    const issuePrefix = extractPrefix(issueId);
    const projectKey = issuePrefix ?? issueId.split('-')[0] ?? '';
    const ghConfig = getGitHubConfig();
    const repoConfig = ghConfig?.repos.find((r) => {
      const prefix = (r.prefix ?? r.repo).toUpperCase().replace(/-/g, '');
      return prefix === projectKey.toUpperCase();
    });
    if (repoConfig) {
      prRepoArg = `${repoConfig.owner}/${repoConfig.repo}`;
      prOwner = repoConfig.owner;
      prRepo = repoConfig.repo;
    }
  }

  const prNumberTask = (async () => {
    if (prRepoArg) {
      if (!parseIssueId(issueId)) {
        throw new Error(`Invalid issue id: ${issueId}`);
      }
      const branchName = `feature/${issueId.toLowerCase()}`;
      try {
        const { stdout } = await execFileAsync(
          'gh',
          [
            'pr', 'list',
            '--repo', prRepoArg,
            '--head', branchName,
            '--state', 'all',
            '--json', 'number',
            '--limit', '1',
            '--jq', '.[0].number',
          ],
          { encoding: 'utf-8', timeout: 15000 },
        );
        const trimmed = stdout.trim();
        if (trimmed) {
          const parsed = parseInt(trimmed, 10);
          if (Number.isFinite(parsed)) return parsed;
        }
      } catch (err: any) {
        errors.push(`gh pr list failed: ${err?.message ?? String(err)}`);
      }
    }
    return null;
  })();

  const [linearItems, ghIssueItems, resolvedPrNumber] = await Promise.all([
    linearTask,
    ghIssueCommentsTask,
    prNumberTask,
  ]);
  items.push(...linearItems, ...ghIssueItems);
  prNumber = resolvedPrNumber;

  if (prNumber !== null && prRepoArg && prOwner && prRepo) {
    // Three independent gh API calls. Each takes 200–800ms; running them
    // sequentially compounded latency on every 30s poll. Fan out with
    // Promise.all (each block catches its own error so the outer await never
    // rejects) and the slowest call now governs total wall-clock instead of
    // the sum of all three.
    const collectedItems: DiscussionItem[] = [];

    // 4. PR conversation comments (issue-comments endpoint against the PR).
    const prConversation = (async () => {
      try {
        const { stdout } = await execAsync(
          `gh api "repos/${prOwner}/${prRepo}/issues/${prNumber}/comments?per_page=100"`,
          { encoding: 'utf-8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
        );
        const arr = JSON.parse(stdout) as Array<{
          id: number;
          user?: { login?: string } | null;
          body?: string | null;
          created_at?: string;
          html_url?: string;
        }>;
        for (const c of arr) {
          collectedItems.push({
            id: `gh-pr-conv-${c.id}`,
            source: 'github-pr-conversation',
            author: c.user?.login ?? 'unknown',
            body: c.body ?? '',
            createdAt: c.created_at ?? '',
            url: c.html_url,
            prNumber,
          });
        }
      } catch (err: any) {
        errors.push(`gh pr conversation failed: ${err?.message ?? String(err)}`);
      }
    })();

    // 5. PR review submissions (approve / changes-requested / commented).
    const prReviews = (async () => {
      try {
        const { stdout } = await execAsync(
          `gh api "repos/${prOwner}/${prRepo}/pulls/${prNumber}/reviews?per_page=100"`,
          { encoding: 'utf-8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
        );
        const arr = JSON.parse(stdout) as Array<{
          id: number;
          user?: { login?: string } | null;
          body?: string | null;
          state?: string;
          submitted_at?: string;
          html_url?: string;
        }>;
        for (const r of arr) {
          if (!r.body && r.state === 'COMMENTED') continue; // empty comment-only reviews are noise
          collectedItems.push({
            id: `gh-pr-review-${r.id}`,
            source: 'github-pr-review',
            author: r.user?.login ?? 'unknown',
            body: r.body ?? '',
            createdAt: r.submitted_at ?? '',
            url: r.html_url,
            prNumber,
            reviewState: r.state,
          });
        }
      } catch (err: any) {
        errors.push(`gh pr reviews failed: ${err?.message ?? String(err)}`);
      }
    })();

    // 6. Inline PR review comments (review-thread replies on diff lines).
    const prInlineComments = (async () => {
      try {
        const { stdout } = await execAsync(
          `gh api "repos/${prOwner}/${prRepo}/pulls/${prNumber}/comments?per_page=100"`,
          { encoding: 'utf-8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
        );
        const arr = JSON.parse(stdout) as Array<{
          id: number;
          user?: { login?: string } | null;
          body?: string | null;
          created_at?: string;
          html_url?: string;
          path?: string;
          line?: number | null;
        }>;
        for (const c of arr) {
          collectedItems.push({
            id: `gh-pr-rc-${c.id}`,
            source: 'github-pr-review-comment',
            author: c.user?.login ?? 'unknown',
            body: c.body ?? '',
            createdAt: c.created_at ?? '',
            url: c.html_url,
            prNumber,
            filePath: c.path,
            line: typeof c.line === 'number' ? c.line : undefined,
          });
        }
      } catch (err: any) {
        errors.push(`gh pr review comments failed: ${err?.message ?? String(err)}`);
      }
    })();

    await Promise.all([prConversation, prReviews, prInlineComments]);
    items.push(...collectedItems);
  }

  // Sort chronologically (oldest first). Items with no createdAt sink to the bottom.
  items.sort((a, b) => {
    if (!a.createdAt && !b.createdAt) return 0;
    if (!a.createdAt) return 1;
    if (!b.createdAt) return -1;
    return a.createdAt.localeCompare(b.createdAt);
  });

  return {
    issueId: upper,
    items,
    prNumber,
    ...(errors.length > 0 ? { errors } : {}),
  };
}

const getIssueDiscussionsRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/discussions',
  httpHandler(Effect.gen(function* () {
    const linear = yield* LinearClient;
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';

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

    const issueData = getCostsForIssue(id);
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
      sessions: issueData.sessions ?? [],
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
    const parsedIssueId = parseIssueId(rawId);
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
  getIssuePlanningStateRoute,
  postIssueGenerateTasksRoute,
  getIssueCostsRoute,
  getResourceAllocatedIssuesRoute,
  getIssueResourceDetailsRoute,
  getIssuePrRoute,
  getIssuePrDiffRoute,
  getIssuePrDetailsRoute,
  getIssueDiscussionsRoute,
);

export default issuesRouteLayer;

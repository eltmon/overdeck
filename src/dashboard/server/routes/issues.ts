import { jsonResponse } from "../http-helpers.js";
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
import { existsSync, mkdirSync, readFileSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnPlanningSession, type PlanningIssue } from '../../../lib/planning/spawn-planning-session.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { extractTeamPrefix, findProjectByTeam, resolveProjectFromIssue } from '../../../lib/projects.js';
import { resolveGitHubIssue as resolveGitHubIssueShared, resolveTrackerType } from '../../../lib/tracker-utils.js';
import { clearReviewStatus } from '../review-status.js';
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

const execAsync = promisify(exec);

// ─── Shared IssueDataService singleton ───────────────────────────────────────
// Started by main.ts on boot. Updates flow through the ReadModel via
// onIssuesChanged callback → event store → WebSocket RPC.

function getIssueDataService(): IssueDataService {
  // Use the shared singleton — started by server.ts on boot
  const { getSharedIssueService } = require('../services/issue-service-singleton.js');
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
  Effect.gen(function* () {
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
  }),
);

// ─── Route: GET /api/issues/:id/analyze ──────────────────────────────────────

const getIssueAnalyzeRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/analyze',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const linear = yield* LinearClient;

    return yield* Effect.tryPromise({
      try: async () => {
        try {
        const issue = await Effect.runPromise(
          linear.getIssue(id).pipe(Effect.catchAll(() => Effect.succeed(null))),
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
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('Error analyzing issue:', error);
          return jsonResponse({ error: 'Failed to analyze issue: ' + msg }, { status: 500 });
        }
      },
      catch: (err) => new Error(String(err)),
    });
  }),
);

// ─── Route: POST /api/issues/:id/plan ────────────────────────────────────────

const postIssuePlanRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/plan',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;
    const linear = yield* LinearClient;

    return yield* Effect.tryPromise({
      try: async () => {
        try {
        const { answers, tasks } = body as any;

        if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
          return jsonResponse({ error: 'Tasks are required' }, { status: 400 });
        }

        const issue = await Effect.runPromise(
          linear.getIssue(id).pipe(Effect.catchAll(() => Effect.succeed(null))),
        );

        if (!issue) {
          return jsonResponse({ error: 'Issue not found' }, { status: 404 });
        }

        const issuePrefix = issue.identifier.split('-')[0];
        const projectPath = getProjectPath(undefined, issuePrefix);

        const { findPRDFiles, analyzeComplexity, executePlan } = await import('../../../lib/planning/plan-utils.js');

        const prdFiles = await findPRDFiles(issue.identifier, projectPath);

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

        const result = await executePlan(planIssue, tasks, decisions, projectPath, {
          commitAndPush: true,
          prdFiles,
        });

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
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('Error creating plan:', error);
          return jsonResponse({ error: 'Failed to create plan: ' + msg }, { status: 500 });
        }
      },
      catch: (err) => new Error(String(err)),
    });
  }),
);

// ─── Route: GET /api/issues/:id/handoffs ─────────────────────────────────────

const getIssueHandoffsRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/handoffs',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['id'] ?? '';

    return yield* Effect.try({
      try: () => {
        const handoffs = readIssueHandoffEvents(issueId);
        return jsonResponse({ handoffs });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error getting issue handoffs:', error);
        return jsonResponse({ error: 'Failed to get issue handoffs: ' + msg }, { status: 500 });
      },
    });
  }),
);

// ─── Route: POST /api/issues/:issueId/close ──────────────────────────────────

const postIssueCloseRoute = HttpRouter.add(
  'POST',
  '/api/issues/:issueId/close',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;

    return yield* Effect.tryPromise({
      try: async () => {
        try {
        const { reason } = body as any;
        const issuePrefix = issueId.split('-')[0];
        const projectPath = getProjectPath(undefined, issuePrefix);

        const { close: closeWorkflow } = await import('../../../lib/lifecycle/index.js');
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

        const result = await closeWorkflow(ctx, { reason });

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
          Effect.runSync(eventStore.append({
            type: 'issues.updated',
            timestamp: new Date().toISOString(),
            payload: { issueId },
          }));
        }

        return jsonResponse({
          success: result.success,
          message: result.success
            ? `Closed ${issueId}${reason ? ': ' + reason : ''}`
            : `Close failed for ${issueId}`,
          steps: result.steps,
        });
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('Error closing issue:', error);
          return jsonResponse({ error: 'Failed to close: ' + msg }, { status: 500 });
        }
      },
      catch: (err) => new Error(String(err)),
    });
  }),
);

// ─── Route: POST /api/issues/:id/start-planning ──────────────────────────────

const postIssueStartPlanningRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/start-planning',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;
    const linear = yield* LinearClient;
    const github = yield* GitHubClient;
    const rally = yield* RallyClient;
    const lifecycle = yield* IssueLifecycle;

    return yield* Effect.tryPromise({
      try: async () => {
        try {
        const {
          skipWorkspace = false,
          startDocker = false,
          workspaceLocation = 'local',
          shadowMode = false,
        } = body as any;

        console.log(`[start-planning] START for ${id}, workspaceLocation=${workspaceLocation}, shadow=${shadowMode}`);

        // Check if a work agent is already running
        const issueLowerForCheck = id.toLowerCase();
        try {
          const { stdout: sessions } = await execAsync('tmux list-sessions -F "#{session_name}" 2>/dev/null || true');
          const workAgentSession = sessions.trim().split('\n').find((s: string) => s === `agent-${issueLowerForCheck}`);
          if (workAgentSession) {
            return jsonResponse({
              error: `Cannot start planning: work agent already running for ${id.toUpperCase()}`,
              hint: 'Stop the agent first or use the terminal view to interact with it',
              existingSession: workAgentSession,
            }, { status: 409 });
          }
        } catch {
          // tmux not running — continue
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
          const ghIssue = await Effect.runPromise(
            github.getIssue(owner, repo, number).pipe(Effect.catchAll((e) => Effect.fail(e))),
          );

          const ghConfig = getGitHubConfig();
          const repoConfig = ghConfig?.repos.find((r: any) => r.owner === owner && r.repo === repo);
          const prefix = repoConfig?.prefix || repo.toUpperCase();

          const ghComments = await Effect.runPromise(
            github.getComments(owner, repo, number, 50).pipe(
              Effect.map((cs) => cs.map((c) => ({ author: c.user, body: c.body, createdAt: c.createdAt }))),
              Effect.catchAll(() => Effect.succeed([] as Array<{ author: string; body: string; createdAt: string }>)),
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
          };

          // Add "planning" label (ensure it exists, then apply to issue)
          await Effect.runPromise(
            lifecycle.addLabel(id, 'planning').pipe(Effect.catchAll(() => Effect.void)),
          );

        } else if (trackerTypeForIssue === 'rally') {
          const rallyIssue = await Effect.runPromise(
            rally.getIssue(id).pipe(
              Effect.catchTag('TrackerNotConfigured', () =>
                Effect.fail(new Error('RALLY_API_KEY not configured. Set it in ~/.panopticon.env')),
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
          const linearIssue = await Effect.runPromise(
            linear.getIssue(id).pipe(
              Effect.catchTag('TrackerNotConfigured', () =>
                Effect.fail(new Error('LINEAR_API_KEY not configured')),
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
          await Effect.runPromise(
            lifecycle.transitionTo(id, 'in_planning').pipe(Effect.catchAll(() => Effect.void)),
          );
        }

        const issuePrefix = issue.identifier.split('-')[0];
        const projectPath = getProjectPath(undefined, issuePrefix);
        const issueLower = issue.identifier.toLowerCase();
        const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
        const sessionName = `planning-${issueLower}`;

        // Return early with response — background workspace + agent setup runs after
        const responseBody = {
          success: true,
          issue: {
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            newState: newStateName,
            source: issue.source,
          },
          workspace: {
            created: existsSync(workspacePath),
            path: workspacePath,
          },
          planningAgent: {
            started: true,
            sessionName,
          },
        };

        Effect.runSync(eventStore.append({
          type: 'planning.started',
          timestamp: new Date().toISOString(),
          payload: { issueId: id, sessionName },
        }));

        // Write preliminary agent state so status endpoint knows planning is starting
        const agentStateDir = join(homedir(), '.panopticon', 'agents', sessionName);
        mkdirSync(agentStateDir, { recursive: true });
        writeFileSync(join(agentStateDir, 'state.json'), JSON.stringify({
          id: sessionName,
          issueId: issue.identifier,
          workspace: workspacePath,
          status: 'starting',
          startedAt: new Date().toISOString(),
          type: 'planning',
          location: workspaceLocation,
        }, null, 2));

        // Background: workspace creation + agent spawning (fire-and-forget)
        spawnPlanningSession({
          issue: issue as PlanningIssue,
          workspacePath,
          projectPath,
          sessionName,
          workspaceLocation: workspaceLocation as 'local' | 'remote',
          startDocker: body.startDocker,
          shadowMode,
        }).catch((err: any) => {
          console.error(`[start-planning] Background spawn failed:`, err);
        });

        try { getIssueDataService().patchIssue(issue.identifier, { status: newStateName, canonicalStatus: 'in_progress' }); } catch { /* non-fatal */ }

        return jsonResponse(responseBody);
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('[start-planning] Error:', error);
          return jsonResponse({ error: 'Failed to start planning: ' + msg }, { status: 500 });
        }
      },
      catch: (err) => new Error(String(err)),
    });
  }),
);

// ─── Route: POST /api/issues/:id/abort-planning ──────────────────────────────

const postIssueAbortPlanningRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/abort-planning',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;
    const lifecycle = yield* IssueLifecycle;
    const linear = yield* LinearClient;

    return yield* Effect.tryPromise({
      try: async () => {
        try {
        const { deleteWorkspace } = body as any;
        const githubCheck = isGitHubIssue(id);

        let revertedState = 'Todo';
        let issueIdentifier: string | undefined;
        let sessionName: string = `planning-${id.toLowerCase()}`;

        if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number) {
          issueIdentifier = id;
          sessionName = `planning-${id.toLowerCase()}`;
          // Remove planning label via IssueLifecycle
          await Effect.runPromise(
            lifecycle.removeLabel(id, 'planning').pipe(Effect.catchAll(() => Effect.void)),
          );
          revertedState = 'Todo (label removed)';
        } else {
          // Resolve issue identifier and session name via LinearClient, then transition to 'open' (Todo)
          const linearIssue = await Effect.runPromise(
            linear.getIssue(id).pipe(Effect.catchAll(() => Effect.succeed(null))),
          );

          if (linearIssue) {
            issueIdentifier = linearIssue.identifier;
            sessionName = `planning-${linearIssue.identifier.toLowerCase()}`;
          }

          await Effect.runPromise(
            lifecycle.transitionTo(id, 'open').pipe(Effect.catchAll(() => Effect.void)),
          );
          revertedState = 'Todo';
        }

        // Kill tmux sessions
        await execAsync(`tmux kill-session -t ${sessionName} 2>/dev/null || true`, { encoding: 'utf-8' });
        await execAsync(`tmux kill-session -t planning-${id.toLowerCase()} 2>/dev/null || true`, { encoding: 'utf-8' });

        // Clean up agent state files
        const agentStateDir = join(homedir(), '.panopticon', 'agents', sessionName);
        const workAgentStateDir = issueIdentifier
          ? join(homedir(), '.panopticon', 'agents', `agent-${issueIdentifier.toLowerCase()}`)
          : join(homedir(), '.panopticon', 'agents', `agent-${id.toLowerCase()}`);

        try {
          if (existsSync(agentStateDir)) rmSync(agentStateDir, { recursive: true, force: true });
          if (existsSync(workAgentStateDir)) rmSync(workAgentStateDir, { recursive: true, force: true });
        } catch (cleanupErr) {
          console.log('[abort-planning] Warning: Could not clean up agent state:', cleanupErr);
        }

        let workspaceDeleted = false;
        let workspaceError: string | undefined;

        if (deleteWorkspace && issueIdentifier) {
          try {
            let projectPath: string | undefined;
            if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
              const localPaths = getGitHubLocalPaths();
              projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`];
            }
            if (!projectPath) {
              const prefix = issueIdentifier.split('-')[0].toUpperCase();
              const projConfig = findProjectByTeam(prefix);
              if (projConfig) projectPath = projConfig.path;
            }

            if (projectPath) {
              const featureWorkspacePath = join(projectPath, 'workspaces', `feature-${issueIdentifier.toLowerCase()}`);
              const plainWorkspacePath = join(projectPath, 'workspaces', issueIdentifier.toLowerCase());
              const workspacePath = existsSync(featureWorkspacePath) ? featureWorkspacePath : plainWorkspacePath;

              if (existsSync(workspacePath)) {
                await execAsync(`pan workspace destroy ${issueIdentifier.toLowerCase()} --force`, {
                  cwd: projectPath,
                  encoding: 'utf-8',
                  timeout: 120000,
                  maxBuffer: 10 * 1024 * 1024,
                });
                workspaceDeleted = true;
              } else {
                workspaceError = 'Workspace not found';
              }
            } else {
              workspaceError = 'Could not determine project path';
            }
          } catch (err: any) {
            workspaceError = err.message;
          }
        }

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
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('Error aborting planning:', error);
          return jsonResponse({ error: 'Failed to abort planning: ' + msg }, { status: 500 });
        }
      },
      catch: (err) => new Error(String(err)),
    });
  }),
);

// ─── Route: POST /api/issues/:id/complete-planning ───────────────────────────

const postIssueCompletePlanningRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/complete-planning',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;
    const linear = yield* LinearClient;
    const lifecycle = yield* IssueLifecycle;

    return yield* Effect.tryPromise({
      try: async () => {
        try {
        const skipKill = (body as any)?.skipKill === true;
        const sessionName = `planning-${id.toLowerCase()}`;
        const issueLower = id.toLowerCase();

        console.log(`[complete-planning] CALLED for ${id} (skipKill=${skipKill})`);

        // Detect remote planning session
        let isRemotePlanning = false;
        let remoteVmName: string | null = null;

        try {
          const agentStateDir = join(homedir(), '.panopticon', 'agents', sessionName);
          const stateJsonPath = join(agentStateDir, 'state.json');
          if (existsSync(stateJsonPath)) {
            const agentState = JSON.parse(readFileSync(stateJsonPath, 'utf-8'));
            if (agentState.location === 'remote' && agentState.vmName) {
              isRemotePlanning = true;
              remoteVmName = agentState.vmName;
            }
          }
          if (!isRemotePlanning) {
            const remoteMetadataPath = join(homedir(), '.panopticon', 'agents', sessionName, 'remote-workspace.json');
            if (existsSync(remoteMetadataPath)) {
              const remoteMetadata = JSON.parse(readFileSync(remoteMetadataPath, 'utf-8'));
              if (remoteMetadata.vmName) {
                isRemotePlanning = true;
                remoteVmName = remoteMetadata.vmName;
              }
            }
          }
        } catch { /* Not a remote session */ }

        if (!skipKill) {
          try {
            await execAsync(`tmux kill-session -t ${sessionName} 2>/dev/null`, { encoding: 'utf-8' });
          } catch { /* Session might not exist */ }
        }

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

        let gitPushed = false;

        if (projectPath) {
          const workspacePlanningDir = join(projectPath, 'workspaces', `feature-${issueLower}`, '.planning');
          const legacyPlanningDir = join(projectPath, '.planning', issueLower);

          let planningDir = '';
          if (existsSync(workspacePlanningDir)) planningDir = workspacePlanningDir;
          else if (existsSync(legacyPlanningDir)) planningDir = legacyPlanningDir;

          if (planningDir) {
            try {
              const gitRoot = planningDir.includes('/workspaces/')
                ? join(projectPath, 'workspaces', `feature-${issueLower}`)
                : projectPath;

              // Create beads from vBRIEF plan if available
              const { findPlan } = await import('../../../lib/vbrief/io.js');
              const { createBeadsFromVBrief } = await import('../../../lib/vbrief/beads.js');
              if (findPlan(gitRoot)) {
                try {
                  const beadsResult = await createBeadsFromVBrief(gitRoot);
                  if (beadsResult.created.length > 0) {
                    console.log(`[complete-planning] Created ${beadsResult.created.length} beads from vBRIEF plan`);
                  }
                } catch (vbriefErr: any) {
                  console.warn(`[complete-planning] createBeadsFromVBrief failed: ${vbriefErr.message}`);
                }
              }

              // Sync beads
              try {
                await execAsync('bd sync 2>/dev/null || true', { cwd: gitRoot, encoding: 'utf-8', timeout: 10000 });
              } catch { /* bd might not be installed */ }

              // Write .planning-complete marker
              writeFileSync(join(planningDir, '.planning-complete'), '', 'utf-8');

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
                  gitPushed = true;
                } else {
                  gitPushed = true;
                }
              } catch { /* Non-fatal */ }
            } catch (gitErr) {
              console.error('Git commit/push failed:', gitErr);
            }
          }
        }

        // Update Linear/GitHub issue state
        let newState = 'Planned';

        // For Linear: check if already in a 'started' state — if so, skip the transition
        let skipStateUpdate = false;
        if (!githubCheck?.isGitHub) {
          const currentIssue = await Effect.runPromise(
            linear.getIssue(id).pipe(Effect.catchAll(() => Effect.succeed(null))),
          );
          if (currentIssue?.state.name && currentIssue.state.name.toLowerCase() !== 'in planning' && currentIssue.state.name.toLowerCase() !== 'planning') {
            // Check if already in a "started" state by seeing if it's not an unstarted/planning state
            const stateType = await Effect.runPromise(
              linear.getTeamStates(currentIssue.team.id).pipe(
                Effect.map((states) => states.find((s) => s.id === currentIssue.state.id)?.type ?? ''),
                Effect.catchAll(() => Effect.succeed('')),
              ),
            );
            if (stateType === 'started') {
              skipStateUpdate = true;
            }
          }
        }

        if (!skipStateUpdate) {
          if (githubCheck.isGitHub) {
            // GitHub: remove 'planning' label, add 'planned' label
            await Effect.runPromise(
              lifecycle.removeLabel(id, 'planning').pipe(Effect.catchAll(() => Effect.void)),
            );
            await Effect.runPromise(
              lifecycle.addLabel(id, 'planned').pipe(Effect.catchAll(() => Effect.void)),
            );
          } else {
            // Linear: transition to 'open' (maps to unstarted — Planned/Todo/Ready)
            const updatedIssue = await Effect.runPromise(
              linear.getIssue(id).pipe(Effect.catchAll(() => Effect.succeed(null))),
            );
            await Effect.runPromise(
              lifecycle.transitionTo(id, 'open').pipe(Effect.catchAll(() => Effect.void)),
            );
            // Re-fetch to get new state name for response
            const refreshed = await Effect.runPromise(
              linear.getIssue(id).pipe(Effect.catchAll(() => Effect.succeed(null))),
            );
            newState = refreshed?.state.name ?? (updatedIssue?.state.name ?? 'Planned');
          }
        } else {
          newState = 'Skipped (already in progress)';
        }

        Effect.runSync(eventStore.append({
          type: 'planning.sync',
          timestamp: new Date().toISOString(),
          payload: { issueId: id, status: 'completed' },
        }));

        try { getIssueDataService().patchIssue(id, { status: newState, canonicalStatus: newState === 'Skipped (already in progress)' ? 'in_progress' : 'todo' }); } catch { /* non-fatal */ }

        return jsonResponse({
          success: true,
          issueId: id,
          newState,
          gitPushed,
          message: gitPushed
            ? 'Planning complete and pushed to git - ready for execution'
            : 'Planning complete - ready for execution',
        });
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('Error completing planning:', error);
          return jsonResponse({ error: 'Failed to complete planning: ' + msg }, { status: 500 });
        }
      },
      catch: (err) => new Error(String(err)),
    });
  }),
);

// ─── Route: POST /api/issues/:id/reset ───────────────────────────────────────

const postIssueResetRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/reset',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const cleanupLog: string[] = [];
    const lifecycle = yield* IssueLifecycle;

    return yield* Effect.tryPromise({
      try: async () => {
        try {
        const issueLower = id.toLowerCase();

        // Kill local tmux sessions
        for (const session of [`planning-${issueLower}`, `agent-${issueLower}`]) {
          try {
            await execAsync(`tmux kill-session -t ${session} 2>/dev/null || true`);
            cleanupLog.push(`Killed local tmux: ${session}`);
          } catch { /* Session might not exist */ }
        }

        // Clean up agent state directories
        for (const dir of [
          join(homedir(), '.panopticon', 'agents', `planning-${issueLower}`),
          join(homedir(), '.panopticon', 'agents', `agent-${issueLower}`),
        ]) {
          if (existsSync(dir)) {
            rmSync(dir, { recursive: true, force: true });
            cleanupLog.push(`Deleted agent state: ${dir}`);
          }
        }

        // Clear shadow state
        try {
          const { removeShadowState } = await import('../../../lib/shadow-state.js');
          const shadowResult = removeShadowState(id);
          if (shadowResult.success) cleanupLog.push(`Cleared shadow state for ${id}`);
        } catch { /* Shadow state might not exist */ }

        // Clear review/test pipeline status
        try {
          clearReviewStatus(id.toUpperCase());
          cleanupLog.push(`Cleared review status for ${id.toUpperCase()}`);
        } catch { /* Might not exist */ }

        // Sync workspace feature branch with latest main
        try {
          const issuePrefix = extractTeamPrefix(id);
          const projectPath = getProjectPath(undefined, issuePrefix);
          const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);

          if (existsSync(workspacePath)) {
            try {
              await execAsync('git fetch origin main', { cwd: workspacePath, timeout: 30000 });
              const { stdout: mergeOut } = await execAsync('git merge origin/main --no-edit', { cwd: workspacePath, timeout: 30000 });
              if (mergeOut.includes('Already up to date')) {
                cleanupLog.push('Workspace already up to date with main');
              } else {
                cleanupLog.push('Synced workspace feature branch with latest main');
              }
            } catch (gitErr: any) {
              await execAsync('git merge --abort', { cwd: workspacePath }).catch(() => {});
              cleanupLog.push(`Warning: could not sync workspace with main: ${gitErr.message}`);
            }

            const planningDir = join(workspacePath, '.planning');
            if (existsSync(planningDir)) {
              const entries = readdirSync(planningDir);
              for (const entry of entries) {
                try { rmSync(join(planningDir, entry), { recursive: true, force: true }); } catch { /* Best effort */ }
              }
              cleanupLog.push('Cleared .planning/ directory');
            }
          }
        } catch { /* Workspace might not exist */ }

        // Reset issue status
        const githubCheck = isGitHubIssue(id);

        if (githubCheck.isGitHub) {
          for (const label of ['in-progress', 'review-ready']) {
            await Effect.runPromise(
              lifecycle.removeLabel(id, label).pipe(Effect.catchAll(() => Effect.void)),
            );
            cleanupLog.push(`Removed GitHub label: ${label}`);
          }
        } else {
          // Linear: transition back to 'open' (Todo/unstarted)
          await Effect.runPromise(
            lifecycle.transitionTo(id, 'open').pipe(
              Effect.tap(() => Effect.sync(() => cleanupLog.push('Reset Linear status to: Todo'))),
              Effect.catchAll((err) =>
                Effect.sync(() => cleanupLog.push(`Linear reset warning: ${String(err)}`)),
              ),
            ),
          );
          // Remove workflow labels (no-op for Linear, but kept for consistency)
          for (const label of ['review ready', 'planning']) {
            await Effect.runPromise(
              lifecycle.removeLabel(id, label).pipe(Effect.catchAll(() => Effect.void)),
            );
          }
        }

        // Invalidate all tracker caches
        const issueDataService = getIssueDataService();
        issueDataService.invalidateTracker('github').catch(() => {});
        issueDataService.invalidateTracker('linear').catch(() => {});
        issueDataService.invalidateTracker('rally').catch(() => {});

        try { issueDataService.patchIssue(id, { status: 'Todo', canonicalStatus: 'todo' }); } catch { /* non-fatal */ }

        return jsonResponse({ success: true, cleanupLog });
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('Reset failed:', error);
          return jsonResponse({ success: false, error: msg, cleanupLog }, { status: 500 });
        }
      },
      catch: (err) => new Error(String(err)),
    });
  }),
);

// ─── Route: POST /api/issues/:id/cancel ──────────────────────────────────────

const postIssueCancelRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/cancel',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;
    const cleanupLog: string[] = [];
    const lifecycle = yield* IssueLifecycle;

    return yield* Effect.tryPromise({
      try: async () => {
        try {
        const { wipeWorkspace = false } = body as any;
        const issueLower = id.toLowerCase();

        // Kill tmux sessions
        for (const session of [`planning-${issueLower}`, `agent-${issueLower}`]) {
          try {
            await execAsync(`tmux kill-session -t ${session} 2>/dev/null || true`);
            cleanupLog.push(`Killed tmux: ${session}`);
          } catch { /* session might not exist */ }
        }

        // Clean up agent state directories
        for (const dir of [
          join(homedir(), '.panopticon', 'agents', `planning-${issueLower}`),
          join(homedir(), '.panopticon', 'agents', `agent-${issueLower}`),
        ]) {
          if (existsSync(dir)) {
            rmSync(dir, { recursive: true, force: true });
            cleanupLog.push(`Deleted agent state: ${dir}`);
          }
        }

        // Clear review/pipeline status
        try {
          clearReviewStatus(id.toUpperCase());
          cleanupLog.push('Cleared review status');
        } catch { /* might not exist */ }

        // Clear shadow state
        try {
          const { removeShadowState } = await import('../../../lib/shadow-state.js');
          removeShadowState(id);
          cleanupLog.push('Cleared shadow state');
        } catch { /* might not exist */ }

        // Optionally wipe workspace
        if (wipeWorkspace) {
          try {
            const { deepWipe } = await import('../../../lib/lifecycle/index.js');
            const issuePrefix = extractTeamPrefix(id);
            const projectPath = getProjectPath(undefined, issuePrefix);
            const projectConfig = findProjectByTeam(issuePrefix);
            const githubCheck = isGitHubIssue(id);

            const ctx = {
              issueId: id,
              projectPath,
              projectName: projectConfig?.name || '',
              ...(githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number
                ? { github: { owner: githubCheck.owner, repo: githubCheck.repo, number: githubCheck.number } }
                : {}),
            };

            const wipeResult = await deepWipe(ctx, {
              deleteWorkspace: true,
              deleteBranches: true,
              resetIssue: false,
              workspaceConfig: projectConfig?.workspace,
              projectName: projectConfig?.name || '',
            });
            cleanupLog.push(...wipeResult.steps.flatMap((s: any) => s.details || []));
          } catch (wipeErr: any) {
            cleanupLog.push(`Workspace wipe warning: ${wipeErr.message}`);
          }
        }

        // Move issue to Canceled
        const githubCheck = isGitHubIssue(id);

        // Close the issue via IssueLifecycle (GitHub: closes issue; Linear: transitions to 'completed' state)
        await Effect.runPromise(
          lifecycle.close(id).pipe(
            Effect.tap(() => Effect.sync(() => cleanupLog.push('Closed issue via lifecycle service'))),
            Effect.catchAll((err) =>
              Effect.sync(() => cleanupLog.push(`Close warning: ${String(err)}`)),
            ),
          ),
        );

        if (!githubCheck.isGitHub) {
          cleanupLog.push('Moved Linear issue to canceled state');
        } else {
          cleanupLog.push('Closed GitHub issue');
        }

        // Invalidate caches
        const issueDataService = getIssueDataService();
        issueDataService.invalidateTracker('github').catch(() => {});
        issueDataService.invalidateTracker('linear').catch(() => {});

        try { issueDataService.patchIssue(id, { status: 'Canceled', canonicalStatus: 'done' }); } catch { /* non-fatal */ }

        return jsonResponse({ success: true, cleanupLog });
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('[cancel] Failed:', error);
          return jsonResponse({ success: false, error: msg, cleanupLog }, { status: 500 });
        }
      },
      catch: (err) => new Error(String(err)),
    });
  }),
);

// ─── Route: POST /api/issues/:id/reopen ──────────────────────────────────────

const postIssueReopenRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/reopen',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;
    const lifecycle = yield* IssueLifecycle;
    const linear = yield* LinearClient;

    return yield* Effect.tryPromise({
      try: async () => {
        try {
        const { reason: _reason } = body as any || {};
        const githubCheck = isGitHubIssue(id);

        const issueDataService = getIssueDataService();
        const issueSource = issueDataService.getIssueSource(id);

        let newState = 'In Progress';
        let issueIdentifier = id;

        // Transition to 'in_progress' via IssueLifecycle (handles all three trackers)
        await Effect.runPromise(
          lifecycle.transitionTo(id, 'in_progress').pipe(Effect.catchAll(() => Effect.void)),
        );

        if (issueSource === 'rally') {
          issueDataService.invalidateTracker('rally').catch(() => {});
          newState = 'Open';

        } else if (githubCheck.isGitHub) {
          // Also clean up done/needs-close-out labels and ensure in-progress is set
          await Effect.runPromise(
            lifecycle.removeLabel(id, 'done').pipe(Effect.catchAll(() => Effect.void)),
          );
          await Effect.runPromise(
            lifecycle.removeLabel(id, 'needs-close-out').pipe(Effect.catchAll(() => Effect.void)),
          );
          issueDataService.invalidateTracker('github').catch(() => {});
          newState = 'In Progress';

        } else {
          // Linear: fetch updated state name
          const updatedIssue = await Effect.runPromise(
            linear.getIssue(id).pipe(Effect.catchAll(() => Effect.succeed(null))),
          );
          issueIdentifier = updatedIssue?.identifier ?? id;
          newState = updatedIssue?.state.name ?? 'In Progress';
          issueDataService.invalidateTracker('linear').catch(() => {});
        }

        // Reset post-merge state
        try {
          const { resetPostMergeState } = await import('../../../lib/cloister/merge-agent.js');
          resetPostMergeState(id);
          resetPostMergeState(id.toUpperCase());
        } catch { /* non-fatal */ }

        try { getIssueDataService().patchIssue(issueIdentifier, { status: newState, canonicalStatus: 'in_progress' }); } catch { /* non-fatal */ }

        return jsonResponse({
          success: true,
          message: `Issue ${id} reopened and moved to ${newState}`,
          issueId: issueIdentifier,
          newState,
          resetSummary: null,
          agentRunning: false,
          nextStep: `Start an agent: pan work issue ${id}`,
        });
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('Error reopening issue:', error);
          return jsonResponse({ error: 'Failed to reopen issue: ' + msg }, { status: 500 });
        }
      },
      catch: (err) => new Error(String(err)),
    });
  }),
);

// ─── Route: POST /api/issues/:id/move-status ─────────────────────────────────

const postIssueMoveStatusRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/move-status',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;
    const lifecycle = yield* IssueLifecycle;

    return yield* Effect.tryPromise({
      try: async () => {
        try {
        const { targetStatus, syncToTracker = false } = body as any || {};

        const validStatuses = ['backlog', 'todo', 'in_progress', 'in_review', 'done'];
        if (!targetStatus || !validStatuses.includes(targetStatus)) {
          return jsonResponse(
            { error: `Invalid targetStatus. Must be one of: ${validStatuses.join(', ')}` },
            { status: 400 },
          );
        }

        const { updateShadowState } = await import('../../../lib/shadow-state.js');

        const canonicalToIssueState: Record<string, 'open' | 'in_progress' | 'closed'> = {
          backlog: 'open', todo: 'open', in_progress: 'in_progress', in_review: 'in_progress', done: 'closed',
        };
        const issueState = canonicalToIssueState[targetStatus];

        const shadowResult = await updateShadowState(id, issueState, 'dashboard-drag-drop', targetStatus);

        const issueDataService = getIssueDataService();
        const issueSource = issueDataService.getIssueSource(id);
        const githubCheck = isGitHubIssue(id);

        if (syncToTracker) {
          // Map canonical status to IssueState for the lifecycle service
          const canonicalToLifecycleState: Record<string, IssueState> = {
            backlog: 'open', todo: 'open', in_progress: 'in_progress', in_review: 'in_review', done: 'closed',
          };
          const lifecycleState = canonicalToLifecycleState[targetStatus];

          if (lifecycleState) {
            await Effect.runPromise(
              lifecycle.transitionTo(id, lifecycleState).pipe(
                Effect.catchAll((err) =>
                  Effect.sync(() => console.error(`Tracker sync failed for ${id}:`, String(err))),
                ),
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

        Effect.runSync(eventStore.append({
          type: 'issues.updated',
          timestamp: new Date().toISOString(),
          payload: { issueId: id },
        }));

        try { issueDataService.patchIssue(id, { status: canonicalToDisplay[targetStatus] || targetStatus, canonicalStatus: targetStatus }); } catch { /* non-fatal */ }

        return jsonResponse({
          success: true,
          message: `Issue ${id} moved to ${targetStatus}`,
          issueId: id,
          newStatus: targetStatus,
          syncToTracker,
          shadowState: shadowResult,
        });
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('Error moving issue status:', error);
          return jsonResponse({ error: 'Failed to move issue status: ' + msg }, { status: 500 });
        }
      },
      catch: (err) => new Error(String(err)),
    });
  }),
);

// ─── Route: POST /api/issues/:id/cleanup-workspace ───────────────────────────

const postIssueCleanupWorkspaceRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/cleanup-workspace',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const cleanupLog: string[] = [];

    return yield* Effect.tryPromise({
      try: async () => {
        try {
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

        return jsonResponse({
          success: true,
          message: `Workspace cleaned up for ${id}`,
          cleanupLog,
        });
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('Error cleaning up workspace:', error);
          return jsonResponse({ error: 'Failed to cleanup workspace: ' + msg, cleanupLog }, { status: 500 });
        }
      },
      catch: (err) => new Error(String(err)),
    });
  }),
);

// ─── Route: POST /api/issues/:id/deep-wipe ───────────────────────────────────

const postIssueDeepWipeRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/deep-wipe',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;

    return yield* Effect.tryPromise({
      try: async () => {
        try {
        const { deleteWorkspace = false } = body as any || {};
        const { deepWipe } = await import('../../../lib/lifecycle/index.js');

        const githubCheck = isGitHubIssue(id);
        let projectPath = '';
        let projectName = '';
        let projectConfig: any = null;

        if (githubCheck.isGitHub) {
          const localPaths = getGitHubLocalPaths();
          projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`] || '';
          projectName = githubCheck.repo || '';
        }
        if (!projectPath) {
          const prefix = id.split('-')[0].toUpperCase();
          projectConfig = findProjectByTeam(prefix);
          if (projectConfig) {
            projectPath = projectConfig.path;
            projectName = projectConfig.name;
          }
        }

        const ctx = {
          issueId: id,
          projectPath,
          projectName,
          ...(githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number
            ? { github: { owner: githubCheck.owner, repo: githubCheck.repo, number: githubCheck.number } }
            : {}),
        };

        const result = await deepWipe(ctx, {
          deleteWorkspace,
          deleteBranches: deleteWorkspace,
          resetIssue: true,
          workspaceConfig: projectConfig?.workspace,
          projectName,
        });

        const issueDataService = getIssueDataService();
        issueDataService.invalidateTracker('github').catch(() => {});
        issueDataService.invalidateTracker('linear').catch(() => {});

        return jsonResponse({
          success: result.success,
          message: `Deep wipe completed for ${id}`,
          cleanupLog: result.steps.flatMap((s: any) => s.details || []),
        });
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('Error in deep wipe:', error);
          return jsonResponse({ error: 'Deep wipe failed: ' + msg }, { status: 500 });
        }
      },
      catch: (err) => new Error(String(err)),
    });
  }),
);

// ─── Route: POST /api/issues/:id/close-out ───────────────────────────────────

const postIssueCloseOutRoute = HttpRouter.add(
  'POST',
  '/api/issues/:id/close-out',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';

    return yield* Effect.tryPromise({
      try: async () => {
        try {
        const { closeOut } = await import('../../../lib/lifecycle/index.js');
        const githubCheck = isGitHubIssue(id);
        let projectPath = '';

        if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
          const localPaths = getGitHubLocalPaths();
          projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`] || '';
        }
        if (!projectPath) {
          const issuePrefix = id.split('-')[0].toUpperCase();
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

        const result = await closeOut(ctx);

        if (result.success) {
          issueDataService.invalidateTracker('github').catch(() => {});
          issueDataService.invalidateTracker('linear').catch(() => {});
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
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error(`[close-out] Error for ${id}:`, error);
          return jsonResponse({ error: msg }, { status: 500 });
        }
      },
      catch: (err) => new Error(String(err)),
    });
  }),
);

// ─── Route: GET /api/issues/:id/beads ────────────────────────────────────────

const getIssueBeadsRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/beads',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';

    return yield* Effect.tryPromise({
      try: async () => {
        try {
        const issueLower = id.toLowerCase();
        const githubCheck = isGitHubIssue(id);
        let projectPath = '';

        if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
          const localPaths = getGitHubLocalPaths();
          projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`] || '';
        }
        if (!projectPath) {
          const issuePrefix = id.split('-')[0];
          try { projectPath = getProjectPath(undefined, issuePrefix); } catch { projectPath = ''; }
        }

        const workspacePath = projectPath ? join(projectPath, 'workspaces', `feature-${issueLower}`) : '';

        // Check for remote workspace
        let isRemoteWorkspace = false;
        let remoteVmName: string | null = null;

        const sessionName = `planning-${issueLower}`;
        const agentStateDir = join(homedir(), '.panopticon', 'agents', sessionName);

        const stateJsonPath = join(agentStateDir, 'state.json');
        if (existsSync(stateJsonPath)) {
          try {
            const agentState = JSON.parse(readFileSync(stateJsonPath, 'utf-8'));
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
              const remoteMetadata = JSON.parse(readFileSync(remoteMetadataPath, 'utf-8'));
              if (remoteMetadata.vmName) {
                isRemoteWorkspace = true;
                remoteVmName = remoteMetadata.vmName;
              }
            } catch { /* Ignore parse errors */ }
          }
        }

        if (!isRemoteWorkspace) {
          try {
            const { loadWorkspaceMetadata } = await import('../../../lib/remote/workspace-metadata.js');
            const wsMetadata = loadWorkspaceMetadata(id);
            if (wsMetadata?.vmName) {
              isRemoteWorkspace = true;
              remoteVmName = wsMetadata.vmName;
            }
          } catch { /* Not a remote workspace */ }
        }

        let beads: any[] = [];
        let querySource = 'local';

        // Try local query
        if (beads.length === 0) {
          try {
            const bdSearchDir = (workspacePath && existsSync(workspacePath)) ? workspacePath : (projectPath || homedir());
            const { stdout } = await execAsync(`bd list --json -l "${id.toLowerCase()}" --status all --limit 0`, {
              cwd: bdSearchDir,
              encoding: 'utf-8',
              timeout: 10000,
            });
            beads = JSON.parse(stdout || '[]');
            querySource = 'local';
          } catch (bdError: any) {
            console.error('bd search failed:', bdError.message);
          }
        }

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

        return jsonResponse({
          tasks,
          workspacePath,
          count: tasks.length,
          source: querySource,
          isRemote: isRemoteWorkspace,
        });
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('Error fetching beads:', error);
          return jsonResponse({ error: 'Failed to fetch beads: ' + msg }, { status: 500 });
        }
      },
      catch: (err) => new Error(String(err)),
    });
  }),
);

// ─── Route: GET /api/issues/:id/costs ────────────────────────────────────────

const getIssueCostsRoute = HttpRouter.add(
  'GET',
  '/api/issues/:id/costs',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';

    return yield* Effect.try({
      try: () => {
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
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error getting issue costs:', error);
        return jsonResponse({ error: 'Failed to get issue costs: ' + msg }, { status: 500 });
      },
    });
  }),
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
  postIssueResetRoute,
  postIssueCancelRoute,
  postIssueReopenRoute,
  postIssueMoveStatusRoute,
  postIssueCleanupWorkspaceRoute,
  postIssueDeepWipeRoute,
  postIssueCloseOutRoute,
  getIssueBeadsRoute,
  getIssueCostsRoute,
);

export default issuesRouteLayer;

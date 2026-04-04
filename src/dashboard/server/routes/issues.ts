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
import { existsSync, readFileSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { extractTeamPrefix, findProjectByTeam, resolveProjectFromIssue } from '../../../lib/projects.js';
import { resolveGitHubIssue as resolveGitHubIssueShared, resolveTrackerType } from '../../../lib/tracker-utils.js';
import { clearReviewStatus } from '../review-status.js';
import { getLinearApiKey, getGitHubConfig, getRallyConfig } from '../services/tracker-config.js';
import { cleanupWorkflowLabels } from '../../../core/state-mapping.js';
import { syncCache, getCostsForIssue } from '../../../lib/costs/index.js';
import { readIssueHandoffEvents } from '../../../lib/cloister/handoff-logger.js';
import { IssueDataService } from '../services/issue-data-service.js';
import { CacheService } from '../services/cache-service.js';
import { EventStoreService } from '../services/domain-services.js';

const execAsync = promisify(exec);

// ─── Shared IssueDataService singleton ───────────────────────────────────────
// The Effect server has no socket.io, so we supply a no-op io shim.
// The service is started lazily on first use so background polling begins
// at server startup without blocking route registration.

const noopIo = {
  emit: () => {},
  on: () => {},
} as any;

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

    return yield* Effect.tryPromise({
      try: async () => {
        try {
        const apiKey = getLinearApiKey();
        if (!apiKey) {
          return jsonResponse({ error: 'LINEAR_API_KEY not configured' }, { status: 500 });
        }

        const query = `
          query GetIssue($id: String!) {
            issue(id: $id) {
              id
              identifier
              title
              description
              priority
              url
              state { name }
              labels { nodes { name } }
              project { id name }
            }
          }
        `;

        const response = await fetch('https://api.linear.app/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
          body: JSON.stringify({ query, variables: { id } }),
        });
        const json = await response.json() as any;
        if (json.errors) throw new Error(json.errors[0]?.message || 'GraphQL error');
        const issue = json.data?.issue;

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

        const labels = issue.labels?.nodes?.map((l: any) => l.name) || [];
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
            status: issue.state?.name || 'Unknown',
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

    return yield* Effect.tryPromise({
      try: async () => {
        try {
        const { answers, tasks } = body as any;

        if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
          return jsonResponse({ error: 'Tasks are required' }, { status: 400 });
        }

        const apiKey = getLinearApiKey();
        if (!apiKey) {
          return jsonResponse({ error: 'LINEAR_API_KEY not configured' }, { status: 500 });
        }

        const query = `
          query GetIssue($id: String!) {
            issue(id: $id) {
              id
              identifier
              title
              description
              url
            }
          }
        `;
        const response = await fetch('https://api.linear.app/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
          body: JSON.stringify({ query, variables: { id } }),
        });
        const json = await response.json() as any;
        if (json.errors) throw new Error(json.errors[0]?.message || 'GraphQL error');
        const issue = json.data?.issue;

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
          const config = getGitHubConfig()!;
          const ghRes = await fetch(
            `https://api.github.com/repos/${githubCheck.owner}/${githubCheck.repo}/issues/${githubCheck.number}`,
            {
              headers: {
                'Authorization': `token ${config.token}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Panopticon-Dashboard',
              },
            }
          );
          if (!ghRes.ok) throw new Error(`GitHub API error: ${ghRes.status}`);
          const ghIssue: any = await ghRes.json();

          const repoConfig = config.repos.find((r: any) => r.owner === githubCheck.owner && r.repo === githubCheck.repo);
          const prefix = repoConfig?.prefix || githubCheck.repo!.toUpperCase();

          let ghComments: Array<{ author: string; body: string; createdAt: string }> = [];
          try {
            const commentsRes = await fetch(
              `https://api.github.com/repos/${githubCheck.owner}/${githubCheck.repo}/issues/${githubCheck.number}/comments?per_page=50`,
              {
                headers: {
                  'Authorization': `token ${config.token}`,
                  'Accept': 'application/vnd.github.v3+json',
                  'User-Agent': 'Panopticon-Dashboard',
                },
              }
            );
            if (commentsRes.ok) {
              const rawComments = await commentsRes.json() as any[];
              ghComments = rawComments.map((c: any) => ({
                author: c.user?.login || 'unknown',
                body: c.body || '',
                createdAt: c.created_at,
              }));
            }
          } catch (commentErr: any) {
            console.log(`[start-planning] Could not fetch GitHub comments: ${commentErr.message}`);
          }

          issue = {
            id: `github-${githubCheck.owner}-${githubCheck.repo}-${githubCheck.number}`,
            identifier: `${prefix}-${githubCheck.number}`,
            title: ghIssue.title,
            description: ghIssue.body || '',
            url: ghIssue.html_url,
            source: 'github',
            comments: ghComments.length > 0 ? ghComments : undefined,
          };

          // Add "planning" label
          try {
            await fetch(`https://api.github.com/repos/${githubCheck.owner}/${githubCheck.repo}/labels`, {
              method: 'POST',
              headers: {
                'Authorization': `token ${config.token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
                'User-Agent': 'Panopticon-Dashboard',
              },
              body: JSON.stringify({ name: 'planning', color: 'fbca04' }),
            });
          } catch { /* Label may already exist */ }
          await fetch(
            `https://api.github.com/repos/${githubCheck.owner}/${githubCheck.repo}/issues/${githubCheck.number}/labels`,
            {
              method: 'POST',
              headers: {
                'Authorization': `token ${config.token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
                'User-Agent': 'Panopticon-Dashboard',
              },
              body: JSON.stringify({ labels: ['planning'] }),
            }
          );

        } else if (trackerTypeForIssue === 'rally') {
          const rallyConfig = getRallyConfig();
          if (!rallyConfig) {
            return jsonResponse(
              { error: 'RALLY_API_KEY not configured. Set it in ~/.panopticon.env' },
              { status: 500 },
            );
          }

          const { createTracker } = await import('../../../lib/tracker/factory.js');
          const { resolveProjectFromIssue: resolveProj, getProject } = await import('../../../lib/projects.js');
          const projectInfo = resolveProj(id);
          const rallyProject = projectInfo ? getProject(projectInfo.projectKey)?.rally_project : undefined;

          const tracker = createTracker({
            type: 'rally',
            project: rallyProject || rallyConfig.project,
            server: rallyConfig.server,
            workspace: rallyConfig.workspace,
          });
          const rallyIssue = await tracker.getIssue(id);

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
          const apiKey = getLinearApiKey();
          if (!apiKey) {
            return jsonResponse({ error: 'LINEAR_API_KEY not configured' }, { status: 500 });
          }

          const issueQuery = `
            query GetIssue($id: String!) {
              issue(id: $id) {
                id
                identifier
                title
                description
                url
                state { id name }
                team { id key }
              }
            }
          `;
          const issueRes = await fetch('https://api.linear.app/graphql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
            body: JSON.stringify({ query: issueQuery, variables: { id } }),
          });
          const issueJson = await issueRes.json() as any;
          if (issueJson.errors) throw new Error(issueJson.errors[0]?.message || 'GraphQL error');
          const linearIssue = issueJson.data?.issue;

          if (!linearIssue) {
            return jsonResponse({ error: 'Issue not found' }, { status: 404 });
          }

          issue = {
            id: linearIssue.id,
            identifier: linearIssue.identifier,
            title: linearIssue.title,
            description: linearIssue.description || '',
            url: linearIssue.url,
            source: 'linear',
          };

          // Update to "In Planning" state
          const statesQuery = `query { team(id: "${linearIssue.team.id}") { states { nodes { id name } } } }`;
          const statesRes = await fetch('https://api.linear.app/graphql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
            body: JSON.stringify({ query: statesQuery }),
          });
          const statesJson = await statesRes.json() as any;
          const states = statesJson.data?.team?.states?.nodes || [];
          const planningState = states.find((s: any) =>
            s.name.toLowerCase() === 'in planning' || s.name.toLowerCase() === 'planning'
          );
          if (planningState) {
            const updateMut = `mutation { issueUpdate(id: "${linearIssue.id}", input: { stateId: "${planningState.id}" }) { success } }`;
            await fetch('https://api.linear.app/graphql', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
              body: JSON.stringify({ query: updateMut }),
            });
            newStateName = planningState.name;
          }
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
          // Remove planning label
          const config = getGitHubConfig();
          if (config) {
            try {
              await fetch(
                `https://api.github.com/repos/${githubCheck.owner}/${githubCheck.repo}/issues/${githubCheck.number}/labels/planning`,
                {
                  method: 'DELETE',
                  headers: {
                    'Authorization': `token ${config.token}`,
                    'Accept': 'application/vnd.github.v3+json',
                  },
                }
              );
              revertedState = 'Todo (label removed)';
            } catch { /* Label might not exist */ }
          }
        } else {
          // Linear: move back to Todo
          const apiKey = getLinearApiKey();
          if (apiKey) {
            const issueQuery = `query GetIssue($id: String!) { issue(id: $id) { id identifier team { id } } }`;
            const issueRes = await fetch('https://api.linear.app/graphql', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
              body: JSON.stringify({ query: issueQuery, variables: { id } }),
            });
            const issueJson = await issueRes.json() as any;
            const issue = issueJson.data?.issue;

            if (issue) {
              issueIdentifier = issue.identifier;
              sessionName = `planning-${issue.identifier.toLowerCase()}`;

              const statesQuery = `query GetTeamStates($teamId: String!) { team(id: $teamId) { states { nodes { id name type } } } }`;
              const statesRes = await fetch('https://api.linear.app/graphql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
                body: JSON.stringify({ query: statesQuery, variables: { teamId: issue.team.id } }),
              });
              const statesJson = await statesRes.json() as any;
              const states = statesJson.data?.team?.states?.nodes || [];

              const todoState = states.find((s: any) =>
                s.name.toLowerCase() === 'todo' ||
                s.name.toLowerCase() === 'to do' ||
                s.type === 'unstarted'
              );

              if (todoState) {
                const updateMutation = `mutation UpdateIssue($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success issue { state { name } } } }`;
                await fetch('https://api.linear.app/graphql', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
                  body: JSON.stringify({ query: updateMutation, variables: { id: issue.id, stateId: todoState.id } }),
                });
                revertedState = todoState.name;
              }
            }
          }
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
        let skipStateUpdate = false;
        const apiKey = getLinearApiKey();
        if (apiKey && !githubCheck?.isGitHub) {
          try {
            const checkQuery = `query { issue(id: "${id}") { state { name type } } }`;
            const checkRes = await fetch('https://api.linear.app/graphql', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
              body: JSON.stringify({ query: checkQuery }),
            });
            const checkData = await checkRes.json() as any;
            const currentState = checkData.data?.issue?.state;
            if (currentState?.type === 'started') {
              skipStateUpdate = true;
            }
          } catch { /* non-fatal */ }
        }

        let newState = 'Planned';

        if (!skipStateUpdate) {
          if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number) {
            const config = getGitHubConfig();
            if (config) {
              try {
                await fetch(
                  `https://api.github.com/repos/${githubCheck.owner}/${githubCheck.repo}/issues/${githubCheck.number}/labels/planning`,
                  {
                    method: 'DELETE',
                    headers: { 'Authorization': `token ${config.token}`, 'Accept': 'application/vnd.github.v3+json' },
                  }
                );
              } catch { /* Non-fatal */ }
              try {
                await fetch(
                  `https://api.github.com/repos/${githubCheck.owner}/${githubCheck.repo}/issues/${githubCheck.number}/labels`,
                  {
                    method: 'POST',
                    headers: {
                      'Authorization': `token ${config.token}`,
                      'Accept': 'application/vnd.github.v3+json',
                      'Content-Type': 'application/json',
                      'User-Agent': 'Panopticon-Dashboard',
                    },
                    body: JSON.stringify({ labels: ['planned'] }),
                  }
                );
              } catch { /* Non-fatal */ }
            }
          } else if (apiKey) {
            // Linear: find and update to "Planned" state
            const issueQuery2 = `query { issue(id: "${id}") { id team { id states { nodes { id name } } } } }`;
            const issueRes2 = await fetch('https://api.linear.app/graphql', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
              body: JSON.stringify({ query: issueQuery2 }),
            });
            const issueData2 = await issueRes2.json() as any;
            const issue2 = issueData2.data?.issue;
            if (issue2) {
              const states = issue2.team?.states?.nodes || [];
              const plannedState = states.find((s: any) => s.name === 'Planned')
                || states.find((s: any) => s.name === 'Ready')
                || states.find((s: any) => s.name === 'Todo');
              if (plannedState) {
                const updateMut = `mutation { issueUpdate(id: "${issue2.id}", input: { stateId: "${plannedState.id}" }) { success issue { state { name } } } }`;
                const updateRes = await fetch('https://api.linear.app/graphql', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
                  body: JSON.stringify({ query: updateMut }),
                });
                const updateData = await updateRes.json() as any;
                newState = updateData.data?.issueUpdate?.issue?.state?.name || 'Planned';
              }
            }
          }
        } else {
          newState = 'Skipped (already in progress)';
        }

        Effect.runSync(eventStore.append({
          type: 'planning.sync',
          timestamp: new Date().toISOString(),
          payload: { issueId: id, status: 'completed' },
        }));

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

        if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number) {
          const ghConfig = getGitHubConfig();
          if (ghConfig) {
            for (const label of ['in-progress', 'review-ready']) {
              try {
                await fetch(
                  `https://api.github.com/repos/${githubCheck.owner}/${githubCheck.repo}/issues/${githubCheck.number}/labels/${encodeURIComponent(label)}`,
                  {
                    method: 'DELETE',
                    headers: { 'Authorization': `token ${ghConfig.token}`, 'Accept': 'application/vnd.github.v3+json' },
                  }
                );
                cleanupLog.push(`Removed GitHub label: ${label}`);
              } catch { /* Label might not exist */ }
            }
          }
        }

        const linearApiKeyForReset = process.env['LINEAR_API_KEY'] || '';
        if (!githubCheck.isGitHub && linearApiKeyForReset) {
          try {
            const { LinearClient } = await import('@linear/sdk');
            const linearClient = new LinearClient({ apiKey: linearApiKeyForReset });
            const issue = await linearClient.issue(id.toUpperCase());

            if (issue) {
              const team = await issue.team;
              if (team) {
                const states = await team.states();
                const todoState = states.nodes.find((s: any) =>
                  s.name.toLowerCase() === 'todo' ||
                  s.name.toLowerCase() === 'to do' ||
                  s.type === 'unstarted'
                );
                if (todoState) {
                  await issue.update({ stateId: todoState.id });
                  cleanupLog.push(`Reset Linear status to: ${todoState.name}`);
                }
              }

              const labels = await issue.labels();
              const labelsToRemove = labels.nodes.filter((l: any) =>
                l.name.toLowerCase() === 'review ready' || l.name.toLowerCase() === 'planning'
              );
              if (labelsToRemove.length > 0) {
                const currentLabelIds = labels.nodes.map((l: any) => l.id);
                const newLabelIds = currentLabelIds.filter(
                  (lid: string) => !labelsToRemove.some((lr: any) => lr.id === lid)
                );
                await issue.update({ labelIds: newLabelIds });
                cleanupLog.push(`Removed labels: ${labelsToRemove.map((l: any) => l.name).join(', ')}`);
              }
            }
          } catch (linearErr) {
            cleanupLog.push(`Linear reset warning: ${(linearErr as Error).message}`);
          }
        }

        // Invalidate all tracker caches
        const issueDataService = getIssueDataService();
        issueDataService.invalidateTracker('github').catch(() => {});
        issueDataService.invalidateTracker('linear').catch(() => {});
        issueDataService.invalidateTracker('rally').catch(() => {});

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

        if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number) {
          const ghConfig = getGitHubConfig();
          if (ghConfig) {
            try {
              await fetch(
                `https://api.github.com/repos/${githubCheck.owner}/${githubCheck.repo}/issues/${githubCheck.number}`,
                {
                  method: 'PATCH',
                  headers: {
                    'Authorization': `token ${ghConfig.token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ state: 'closed', state_reason: 'not_planned' }),
                }
              );
              cleanupLog.push('Closed GitHub issue as not planned');
            } catch (ghErr: any) {
              cleanupLog.push(`GitHub close warning: ${ghErr.message}`);
            }
          }
        } else {
          const linearApiKey = process.env['LINEAR_API_KEY'] || '';
          if (linearApiKey) {
            try {
              const { LinearClient } = await import('@linear/sdk');
              const linearClient = new LinearClient({ apiKey: linearApiKey });
              const issue = await linearClient.issue(id.toUpperCase());

              if (issue) {
                const team = await issue.team;
                if (team) {
                  const states = await team.states();
                  const canceledState = states.nodes.find((s: any) =>
                    s.name.toLowerCase() === 'canceled' || s.name.toLowerCase() === 'cancelled'
                  ) || states.nodes.find((s: any) =>
                    s.type === 'canceled' && s.name.toLowerCase() !== 'duplicate'
                  );
                  if (canceledState) {
                    await issue.update({ stateId: canceledState.id });
                    cleanupLog.push(`Moved Linear issue to: ${canceledState.name}`);
                  }
                }
              }
            } catch (linearErr: any) {
              cleanupLog.push(`Linear cancel warning: ${linearErr.message}`);
            }
          }
        }

        // Invalidate caches
        const issueDataService = getIssueDataService();
        issueDataService.invalidateTracker('github').catch(() => {});
        issueDataService.invalidateTracker('linear').catch(() => {});

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

    return yield* Effect.tryPromise({
      try: async () => {
        try {
        const { reason } = body as any || {};
        const githubCheck = isGitHubIssue(id);

        const issueDataService = getIssueDataService();
        const issueSource = issueDataService.getIssueSource(id);

        let newState = 'In Progress';
        let issueIdentifier = id;

        if (issueSource === 'rally') {
          const rallyConfig = getRallyConfig();
          if (!rallyConfig) {
            return jsonResponse({ error: 'Rally not configured' }, { status: 400 });
          }
          const { RallyTracker } = await import('../../../lib/tracker/rally.js');
          const tracker = new RallyTracker({
            apiKey: rallyConfig.apiKey,
            server: rallyConfig.server,
            workspace: rallyConfig.workspace,
            project: rallyConfig.project,
          });
          await tracker.transitionIssue(id, 'open');
          issueDataService.invalidateTracker('rally').catch(() => {});
          newState = 'Open';

        } else if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number) {
          const ghConfig = getGitHubConfig();
          if (!ghConfig) {
            return jsonResponse({ error: 'GitHub not configured' }, { status: 400 });
          }
          const { owner, repo, number } = githubCheck;

          const reopenRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `token ${ghConfig.token}`,
              'Accept': 'application/vnd.github.v3+json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ state: 'open' }),
          });
          if (!reopenRes.ok) {
            const errBody = await reopenRes.text().catch(() => '');
            return jsonResponse(
              { error: `GitHub API rejected reopen: ${reopenRes.status} ${reopenRes.statusText}. ${errBody}`.trim() },
              { status: reopenRes.status },
            );
          }

          for (const label of ['done', 'needs-close-out']) {
            await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}/labels/${label}`, {
              method: 'DELETE',
              headers: { 'Authorization': `token ${ghConfig.token}`, 'Accept': 'application/vnd.github.v3+json' },
            }).catch(() => {});
          }
          await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}/labels`, {
            method: 'POST',
            headers: {
              'Authorization': `token ${ghConfig.token}`,
              'Accept': 'application/vnd.github.v3+json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ labels: ['in-progress'] }),
          }).catch(() => {});
          issueDataService.invalidateTracker('github').catch(() => {});

        } else {
          const linearKey = process.env['LINEAR_API_KEY'] || '';
          if (!linearKey) {
            return jsonResponse({ error: 'LINEAR_API_KEY not configured' }, { status: 400 });
          }

          const { LinearClient } = await import('@linear/sdk');
          const client = new LinearClient({ apiKey: linearKey });
          const issue = await client.issue(id);
          if (!issue) {
            return jsonResponse({ error: `Issue ${id} not found` }, { status: 404 });
          }

          issueIdentifier = issue.identifier;
          const team = await issue.team;
          if (!team) {
            return jsonResponse({ error: 'Could not determine team for issue' }, { status: 400 });
          }

          const states = await team.states();
          const targetState =
            states.nodes.find((s: any) => s.name.toLowerCase() === 'in progress') ||
            states.nodes.find((s: any) => s.type === 'started') ||
            states.nodes.find((s: any) => s.type === 'backlog') ||
            states.nodes.find((s: any) => s.type === 'unstarted');

          if (!targetState) {
            return jsonResponse({ error: 'No suitable state found for transition' }, { status: 400 });
          }

          await issue.update({ stateId: targetState.id });
          newState = targetState.name;
          issueDataService.invalidateTracker('linear').catch(() => {});
        }

        // Reset post-merge state
        try {
          const { resetPostMergeState } = await import('../../../lib/cloister/merge-agent.js');
          resetPostMergeState(id);
          resetPostMergeState(id.toUpperCase());
        } catch { /* non-fatal */ }

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
          if (githubCheck.isGitHub) {
            try {
              const config = getGitHubConfig();
              if (config) {
                const owner = githubCheck.owner!;
                const repo = githubCheck.repo!;
                const number = parseInt(id.split('-')[1], 10);

                const labelsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}/labels`, {
                  headers: { 'Authorization': `token ${config.token}`, 'Accept': 'application/vnd.github.v3+json' },
                });
                const currentLabels = labelsRes.ok ? (await labelsRes.json() as any[]).map((l: any) => l.name) : [];
                const targetLabels = cleanupWorkflowLabels(currentLabels, targetStatus);

                await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}/labels`, {
                  method: 'PUT',
                  headers: {
                    'Authorization': `token ${config.token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ labels: targetLabels }),
                });
              }
            } catch (githubErr: any) {
              console.error(`GitHub label sync failed for ${id}:`, githubErr.message);
            }
          } else if (issueSource === 'rally') {
            const rallyConfig = getRallyConfig();
            if (!rallyConfig) {
              return jsonResponse({ error: 'Rally not configured for sync' }, { status: 400 });
            }
            const { RallyTracker } = await import('../../../lib/tracker/rally.js');
            const tracker = new RallyTracker({
              apiKey: rallyConfig.apiKey,
              server: rallyConfig.server,
              workspace: rallyConfig.workspace,
              project: rallyConfig.project,
            });
            await tracker.transitionIssue(id, issueState);
          } else {
            const linearKey = process.env['LINEAR_API_KEY'] || '';
            if (!linearKey) {
              return jsonResponse({ error: 'LINEAR_API_KEY not configured for sync' }, { status: 400 });
            }
            const { LinearClient } = await import('@linear/sdk');
            const client = new LinearClient({ apiKey: linearKey });
            const issue = await client.issue(id);
            if (!issue) {
              return jsonResponse({ error: `Issue ${id} not found in Linear` }, { status: 404 });
            }

            const team = await issue.team;
            if (!team) {
              return jsonResponse({ error: 'Could not determine team for issue' }, { status: 400 });
            }

            const states = await team.states();
            const stateTypeMap: Record<string, string> = {
              backlog: 'backlog', todo: 'unstarted', in_progress: 'started', in_review: 'started', done: 'completed',
            };
            const targetStateType = stateTypeMap[targetStatus];
            const targetState = states.nodes.find((s: any) => s.type === targetStateType);

            if (!targetState) {
              return jsonResponse(
                { error: `Could not find state of type '${targetStateType}' for team` },
                { status: 400 },
              );
            }

            await issue.update({ stateId: targetState.id });
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

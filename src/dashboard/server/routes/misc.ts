import { jsonResponse } from "../http-helpers.js";
/**
 * Misc route module — Effect HttpRouter.Layer (PAN-428 B17)
 *
 * Catch-all for API routes not covered by B6-B16. Implements:
 *
 *   POST /api/trackers/refresh
 *   GET  /api/project-mappings
 *   PUT  /api/project-mappings
 *   POST /api/project-mappings
 *   GET  /api/system/health
 *   GET  /api/godview/system-health
 *   GET  /api/health/agents
 *   POST /api/health/agents/:id/ping
 *   GET  /api/tracker-status
 *   POST /api/rally/validate
 *   GET  /api/no-resume-mode
 *   GET  /api/deacon/status
 *   GET  /api/deacon/logs
 *   POST /api/deacon/patrol
 *   GET  /api/version
 *   GET  /api/registered-projects
 *   GET  /api/confirmations
 *   POST /api/confirmations/:id/respond
 *   GET  /api/skills
 *   GET  /api/planning/:issueId/status
 *   POST /api/planning/:issueId/message
 *   DELETE /api/planning/:issueId
 *   GET  /api/services/tldr/status
 *   POST /api/services/tldr/start
 *   POST /api/services/tldr/stop
 *   GET  /api/cache-status
 *   GET  /api/metrics/runtimes
 *   GET  /api/metrics/tasks
 *   POST /api/shadow/:issueId/monitor
 *   POST /api/shadow/:issueId/observe
 *   POST /api/dev/rebuild
 *   POST /api/system/restart-dashboard
 */

import { exec, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { sendKeys } from '../../../lib/tmux.js';
import { listProjectsSync, getIssuePrefix } from '../../../lib/projects.js';
import { getLinearApiKey, getRallyConfig } from '../services/tracker-config.js';
import {
  getGitHubConfig as getGitHubConfigShared,
} from '../services/tracker-config.js';
import { extractPrefixSync } from '../../../lib/issue-id.js';
import { httpHandler } from './http-handler.js';
import { bootReconciliationRouteLayer } from './boot-reconciliation.js';
import {
  getOverdeckVersion,
  getProjectPath,
  overdeckDevMode,
  readJsonBody,
} from './misc/shared.js';
import { projectMappingsRouteLayer } from './misc/project-mappings.js';
import { trackersRouteLayer } from './misc/trackers.js';
import { healthRouteLayer } from './misc/health.js';
import { deaconRouteLayer } from './misc/deacon.js';
import { planningRouteLayer } from './misc/planning.js';
import { tldrRouteLayer } from './misc/tldr.js';

export { readPackageVersion } from './misc/shared.js';

const execAsync = promisify(exec);

// ─── Pending confirmations store ─────────────────────────────────────────────

interface ConfirmationRequest {
  id: string;
  agentId: string;
  sessionName: string;
  action: string;
  details?: string;
  timestamp: string;
}

const pendingConfirmations = new Map<string, ConfirmationRequest>();

// ─── Runtime metrics helpers ──────────────────────────────────────────────────

const METRICS_FILE = join(homedir(), '.overdeck', 'runtime-metrics.json');

async function loadRuntimeMetrics(): Promise<any> {
  try {
    const content = await readFile(METRICS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { version: 1, tasks: [], runtimes: {}, lastUpdated: new Date().toISOString() };
  }
}

// ─── TLDR index stats helper ──────────────────────────────────────────────────

// ─── Route: GET /api/tracker-status ──────────────────────────────────────────

// ─── Route: GET /api/version ──────────────────────────────────────────────────

const getVersionRoute = HttpRouter.add(
  'GET',
  '/api/version',
  Effect.promise(async () => {
    const version = await getOverdeckVersion();
    // Expose supervisor URL so the frontend can cache it while the dashboard
    // is healthy, then use it as a fallback when the dashboard is dead.
    let supervisorUrl: string | null = null;
    try {
      const { getSupervisorUrlSync } = await import('../../../lib/supervisor.js');
      supervisorUrl = getSupervisorUrlSync();
    } catch {
      // supervisor module not available in this build — benign
    }
    return jsonResponse({ version, isDev: overdeckDevMode, supervisorUrl });
  }),
);

// ─── Route: GET /api/registered-projects ─────────────────────────────────────

const getRegisteredProjectsRoute = HttpRouter.add(
  'GET',
  '/api/registered-projects',
  Effect.try({
    try: () => {
      const projects = listProjectsSync();
      return jsonResponse(
        projects.map(p => ({
          key: p.key,
          name: p.config.name,
          path: p.config.path,
          linearTeam: getIssuePrefix(p.config) || null,
          githubRepo: p.config.github_repo || null,
          linearProject: (p.config as { linear_project?: string }).linear_project || null,
        })),
      );
    },
    catch: (error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResponse(
        { error: 'Failed to list projects: ' + msg },
        { status: 500 },
      );
    },
  }),
);

// ─── Route: GET /api/confirmations ───────────────────────────────────────────

const getConfirmationsRoute = HttpRouter.add(
  'GET',
  '/api/confirmations',
  Effect.sync(() => jsonResponse(Array.from(pendingConfirmations.values()))),
);

// ─── Route: POST /api/confirmations/:id/respond ──────────────────────────────

const postConfirmationRespondRoute = HttpRouter.add(
  'POST',
  '/api/confirmations/:id/respond',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, 'http://localhost');
    // /api/confirmations/:id/respond → parts[3] = id
    const parts = url.pathname.split('/');
    const id = parts[3] || '';

    const body = yield* readJsonBody;
    const { confirmed } = body as { confirmed?: boolean };

    const confirmationRequest = pendingConfirmations.get(id);
    if (!confirmationRequest) {
      return jsonResponse(
        { error: 'Confirmation request not found' },
        { status: 404 },
      );
    }

    return yield* Effect.promise(async () => {
    try {
        const response = confirmed ? 'y' : 'n';
        await Effect.runPromise(sendKeys(confirmationRequest.sessionName, response));
        pendingConfirmations.delete(id);
        return jsonResponse({ success: true, confirmed });
      }    catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error sending confirmation response:', error);
        return jsonResponse(
          { error: 'Failed to send response: ' + msg },
          { status: 500 },
        );
        }})
  }),
);

// ─── Route: GET /api/skills ───────────────────────────────────────────────────

const getSkillsRoute = HttpRouter.add(
  'GET',
  '/api/skills',
  Effect.promise(async () => {
    try {
      const skills: Array<{
        name: string;
        path: string;
        source: string;
        hasSkillMd: boolean;
        description?: string;
      }> = [];

      const skillLocations = [
        { path: join(homedir(), '.overdeck', 'skills'), source: 'overdeck' },
        { path: join(homedir(), '.claude', 'skills'), source: 'claude' },
      ];

      for (const { path: skillsDir, source } of skillLocations) {
        if (!existsSync(skillsDir)) continue;

        const entries = await readdir(skillsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          const skillPath = join(skillsDir, entry.name);
          const skillMdPath = join(skillPath, 'SKILL.md');
          const hasSkillMd = await access(skillMdPath).then(() => true, () => false);

          let description: string | undefined;
          if (hasSkillMd) {
            try {
              const content = await readFile(skillMdPath, 'utf-8');
              const firstLine = content
                .split('\n')
                .find(line => line.trim() && !line.startsWith('#') && !line.startsWith('---'));
              description = firstLine?.trim().slice(0, 100);
            } catch {}
          }

          skills.push({ name: entry.name, path: skillPath, source, hasSkillMd, description });
        }
      }

      return jsonResponse(skills);
    } catch (error: unknown) {
      console.error('Error listing skills:', error);
      return jsonResponse([]);
    }
  }),
);

// ─── Route: GET /api/cache-status ────────────────────────────────────────────

const getCacheStatusRoute = HttpRouter.add(
  'GET',
  '/api/cache-status',
  Effect.sync(() => {
    try {
      return jsonResponse(getIssueDataService().getDiagnostics());
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: msg }, { status: 500 });
    }
  }),
);

// ─── Route: POST /api/cache/clear ────────────────────────────────────────────

const clearCacheRoute = HttpRouter.add(
  'POST',
  '/api/cache/clear',
  Effect.promise(async () => {
    try {
      await getIssueDataService().clearCacheAndRefresh();
      return jsonResponse({ ok: true, message: 'Cache cleared and re-fetched' });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: msg }, { status: 500 });
    }
  }),
);

// ─── Route: GET /api/metrics/runtimes ────────────────────────────────────────

const getMetricsRuntimesRoute = HttpRouter.add(
  'GET',
  '/api/metrics/runtimes',
  Effect.promise(async () => {
    try {
      const metrics = await loadRuntimeMetrics();
      const runtimes = metrics.runtimes || {};

      const comparison = Object.entries(runtimes).map(([runtime, data]: [string, any]) => ({
        runtime,
        totalTasks: data.totalTasks || 0,
        successfulTasks: data.successfulTasks || 0,
        failedTasks: data.failedTasks || 0,
        successRate: data.successRate || 0,
        avgDurationMinutes: data.avgDurationMinutes || 0,
        avgCost: data.avgCost || 0,
        totalCost: data.totalCost || 0,
        totalTokens: data.totalTokens || 0,
        byCapability: data.byCapability || {},
        byModel: data.byModel || {},
        dailyStats: data.dailyStats || [],
      }));

      const totalTasks = comparison.reduce((sum, r) => sum + r.totalTasks, 0);
      const totalCost = comparison.reduce((sum, r) => sum + r.totalCost, 0);
      const totalTokens = comparison.reduce((sum, r) => sum + r.totalTokens, 0);
      const totalSuccessful = comparison.reduce((sum, r) => sum + r.successfulTasks, 0);

      return jsonResponse({
        runtimes: comparison,
        aggregated: {
          totalTasks,
          totalCost,
          totalTokens,
          avgSuccessRate: totalTasks > 0 ? totalSuccessful / totalTasks : 0,
        },
        lastUpdated: metrics.lastUpdated,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error getting runtime metrics:', error);
      return jsonResponse(
        { error: 'Failed to get runtime metrics: ' + msg },
        { status: 500 },
      );
    }
  }),
);

// ─── Route: GET /api/metrics/tasks ───────────────────────────────────────────

const getMetricsTasksRoute = HttpRouter.add(
  'GET',
  '/api/metrics/tasks',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, 'http://localhost');
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam) : 50;

    return yield* Effect.promise(async () => {
      try {
        const metrics = await loadRuntimeMetrics();
        const tasks = (metrics.tasks || [])
          .sort(
            (a: any, b: any) =>
              new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime(),
          )
          .slice(0, limit);
        return jsonResponse({ tasks });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error getting tasks:', error);
        return jsonResponse(
          { error: 'Failed to get tasks: ' + msg },
          { status: 500 },
        );
      }
    });
  }),
);

// ─── Route: POST /api/shadow/:issueId/monitor ────────────────────────────────

const postShadowMonitorRoute = HttpRouter.add(
  'POST',
  '/api/shadow/:issueId/monitor',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, 'http://localhost');
    const parts = url.pathname.split('/');
    // /api/shadow/:issueId/monitor → parts[3] = issueId
    const issueId = parts[3] || '';
    const issueLower = issueId.toLowerCase();
    const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];

    return yield* Effect.promise(async () => {
      try {
        const projectPath = await getProjectPath(issuePrefix);
        const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);

        if (!existsSync(workspacePath)) {
          return jsonResponse({ error: 'Workspace not found' }, { status: 404 });
        }

        const {
          gatherArtifacts,
          generateBasicInference,
          updateInferenceDocumentSync,
        } = await import('../../../lib/shadow-engineering/index.js');

        const config = { issueId, workspacePath, projectPath };
        const artifacts = await Effect.runPromise(gatherArtifacts(config));
        const inference = generateBasicInference(config, artifacts);
        updateInferenceDocumentSync(workspacePath, inference);

        return jsonResponse({ success: true, inference });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return jsonResponse(
          { error: 'Failed to run monitoring agent: ' + msg },
          { status: 500 },
        );
      }
    })
  }),
);

// ─── Route: POST /api/shadow/:issueId/observe ────────────────────────────────

const postShadowObserveRoute = HttpRouter.add(
  'POST',
  '/api/shadow/:issueId/observe',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, 'http://localhost');
    const parts = url.pathname.split('/');
    // /api/shadow/:issueId/observe → parts[3] = issueId
    const issueId = parts[3] || '';
    const issueLower = issueId.toLowerCase();
    const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];

    const body = yield* readJsonBody;
    const { mode } = body as { mode?: string };

    return yield* Effect.promise(async () => {
      try {
        const projectPath = await getProjectPath(issuePrefix);
        const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);

        if (!existsSync(workspacePath)) {
          return jsonResponse({ error: 'Workspace not found' }, { status: 404 });
        }

        const ghConfig = getGitHubConfigShared();
        if (!ghConfig) {
          return jsonResponse(
            { error: 'GitHub not configured - Observer requires GitHub' },
            { status: 400 },
          );
        }

        const { runObserverCycle } = await import('../../../lib/shadow-engineering/index.js');

        const firstRepo = ghConfig.repos[0];
        const config = {
          issueId,
          workspacePath,
          projectPath,
          repo: firstRepo ? `${firstRepo.owner}/${firstRepo.repo}` : '',
          mode: ((mode || 'watch') as 'watch' | 'propose'),
        };

        const commentsPosted = await Effect.runPromise(runObserverCycle(config));
        return jsonResponse({ success: true, commentsPosted });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return jsonResponse(
          { error: 'Failed to run observer: ' + msg },
          { status: 500 },
        );
      }
    })
  }),
);

// ─── Compose all routes into a single Layer ───────────────────────────────────

// ─── Route: POST /api/dev/rebuild ──────────────────────────────────────────────
// Dev-only: runs `npm run build` in the project root and returns when done.

// Find the project root (directory with package.json + src/dashboard)
const overdeckProjectRoot: string | null = (() => {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'src', 'dashboard'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
})();

const postDevRebuildRoute = HttpRouter.add(
  'POST',
  '/api/dev/rebuild',
  Effect.gen(function* () {
    if (!overdeckDevMode || !overdeckProjectRoot) {
      return jsonResponse({ error: 'Rebuild only available in dev mode' }, { status: 403 });
    }
    return yield* Effect.promise(async () => {
      try {
        const { stdout, stderr } = await execAsync('npm run build', {
          cwd: overdeckProjectRoot,
          timeout: 120_000,
        });
        return jsonResponse({
          ok: true,
          stdout: stdout.slice(-2000),
          stderr: stderr.slice(-2000),
        });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return jsonResponse({ error: `Build failed: ${msg}` }, { status: 500 });
      }
    });
  }),
);

// POST /api/system/restart-dashboard — fire-and-forget restart of the dashboard
// server. Spawns a detached `pan restart --dashboard` so the new process
// outlives the SIGTERM that kills this server. Used by the browser fallback
// path in App.tsx when window.overdeckBridge is not available.
const postRestartDashboardRoute = HttpRouter.add(
  'POST',
  '/api/system/restart-dashboard',
  Effect.sync(() => {
    try {
      const child = spawn('pan', ['restart', '--dashboard'], {
        detached: true,
        stdio: 'ignore',
      });
      child.on('error', (err) => {
        console.error('[restart-dashboard] pan restart spawn failed:', err);
      });
      child.unref();
      return jsonResponse({ ok: true, pid: child.pid ?? null }, { status: 202 });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: 'Restart failed: ' + msg }, { status: 500 });
    }
  }),
);

export const miscRouteLayer = Layer.mergeAll(
  trackersRouteLayer,
  projectMappingsRouteLayer,
  healthRouteLayer,
  deaconRouteLayer,
  bootReconciliationRouteLayer,
  getVersionRoute,
  getRegisteredProjectsRoute,
  getConfirmationsRoute,
  postConfirmationRespondRoute,
  getSkillsRoute,
  planningRouteLayer,
  tldrRouteLayer,
  getCacheStatusRoute,
  clearCacheRoute,
  getMetricsRuntimesRoute,
  getMetricsTasksRoute,
  postShadowMonitorRoute,
  postShadowObserveRoute,
  postDevRebuildRoute,
  postRestartDashboardRoute,
);

export default miscRouteLayer;

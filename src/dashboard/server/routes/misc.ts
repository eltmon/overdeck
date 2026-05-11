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
import { access, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';


import { getCloisterService } from '../../../lib/cloister/service.js';
import { createSessionAsync, killSessionAsync, listSessionNamesAsync, resizeWindowAsync, sendKeysAsync, sessionExistsAsync } from '../../../lib/tmux.js';
import { generateLauncherScript } from '../../../lib/launcher-generator.js';
import { getClaudePermissionFlagsString } from '../../../lib/claude-permissions.js';
import { listProjects, resolveProjectFromIssue, findProjectByTeam, extractTeamPrefix, getIssuePrefix } from '../../../lib/projects.js';
import { getLinearApiKey, getGitHubConfig, getRallyConfig } from '../services/tracker-config.js';
import {
  getLinearApiKey as getLinearApiKeyShared,
  getGitHubConfig as getGitHubConfigShared,
  getRallyConfig as getRallyConfigShared,
} from '../services/tracker-config.js';
import { loadConfig as loadYamlConfig } from '../../../lib/config-yaml.js';
import { loadConfig as loadPanConfig } from '../../../lib/config.js';
import { checkAgentHealthAsync, determineHealthStatusAsync } from '../../lib/health-filtering.js';
import { resolveGitHubIssue as resolveGitHubIssueShared } from '../../../lib/tracker-utils.js';
import { extractPrefix } from '../../../lib/issue-id.js';
import { findPlan, isPlanningComplete, isPlanningProposed } from '../../../lib/vbrief/io.js';
import { IssueDataService } from '../services/issue-data-service.js';
import { EventStoreService } from '../services/domain-services.js';
import { ReadModelService } from '../read-model.js';
import { getSystemHealthSnapshot } from '../services/system-health-service.js';
import { httpHandler } from './http-handler.js';
import { isDeaconGloballyPaused, setDeaconGloballyPaused } from '../../../lib/database/app-settings.js';
import { PAN_CONTINUE_FILENAME, PAN_DIRNAME } from '../../../lib/pan-dir/types.js';

const execAsync = promisify(exec);

// ─── Package version ──────────────────────────────────────────────────────────

export async function readPackageVersion(): Promise<string> {
  // Walk up from the running script to find the nearest package.json.
  // Works for both source (src/dashboard/server/routes/) and bundled (dist/dashboard/) layouts.
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'package.json');
    try {
      return JSON.parse(await readFile(candidate, 'utf-8')).version;
    } catch { /* try parent */ }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '0.0.0';
}

// Lazy-initialized to avoid top-level await (which would make misc.ts an async ESM module,
// risking ERR_REQUIRE_ASYNC_MODULE for any module that require()-chains through here).
let _panopticonVersion: string | null = null;
async function getPanopticonVersion(): Promise<string> {
  if (_panopticonVersion === null) {
    _panopticonVersion = await readPackageVersion();
  }
  return _panopticonVersion;
}

// Dev mode: true when running from the repo checkout (src/ directory exists)
const panopticonDevMode: boolean = (() => {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'src', 'dashboard'))) {
      return true;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
})();

// ─── IssueDataService singleton (for cache-status) ───────────────────────────

function getIssueDataService(): IssueDataService {
  const { getSharedIssueService } = require('../services/issue-service-singleton.js');
  return getSharedIssueService();
}

// ─── Project mappings helpers ─────────────────────────────────────────────────

const PROJECT_MAPPINGS_FILE = join(homedir(), '.panopticon', 'project-mappings.json');

interface ProjectMapping {
  linearProjectId: string;
  linearProjectName: string;
  linearPrefix: string;
  localPath: string;
}

async function getProjectMappings(): Promise<ProjectMapping[]> {
  try {
    const content = await readFile(PROJECT_MAPPINGS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function saveProjectMappings(mappings: ProjectMapping[]): Promise<void> {
  const dir = join(homedir(), '.panopticon');
  await mkdir(dir, { recursive: true });
  await writeFile(PROJECT_MAPPINGS_FILE, JSON.stringify(mappings, null, 2));
}

// ─── Project path helper ──────────────────────────────────────────────────────

async function getProjectPath(issuePrefix?: string): Promise<string> {
  if (issuePrefix) {
    const issueId = `${issuePrefix}-1`;
    const resolved = resolveProjectFromIssue(issueId);
    if (resolved) return resolved.projectPath;
    const mappings = await getProjectMappings();
    const mapping = mappings.find(m => m.linearPrefix === issuePrefix);
    if (mapping) return mapping.localPath;
  }
  return homedir();
}

// ─── GitHub issue helper ──────────────────────────────────────────────────────

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

const METRICS_FILE = join(homedir(), '.panopticon', 'runtime-metrics.json');

async function loadRuntimeMetrics(): Promise<any> {
  try {
    const content = await readFile(METRICS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { version: 1, tasks: [], runtimes: {}, lastUpdated: new Date().toISOString() };
  }
}

// ─── TLDR index stats helper ──────────────────────────────────────────────────

async function getIndexStats(
  rootPath: string,
  isMain: boolean,
): Promise<{ fileCount?: number; indexAge?: string; edgeCount?: number }> {
  const tldrPath = join(rootPath, '.tldr');
  const tldrExists = await access(tldrPath).then(() => true, () => false);
  if (!tldrExists) return {};
  try {
    let indexAge: string | undefined;
    const langPath = join(tldrPath, 'languages.json');
    const langContent = await readFile(langPath, 'utf-8').catch(() => null);
    if (langContent) {
      const langData = JSON.parse(langContent);
      if (langData.timestamp) {
        const ageMs = Date.now() - langData.timestamp * 1000;
        if (isMain) {
          const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
          indexAge = ageDays === 0 ? 'today' : `${ageDays}d ago`;
        } else {
          const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
          indexAge =
            ageHours === 0 ? 'now' : ageHours < 24 ? `${ageHours}h ago` : `${Math.floor(ageHours / 24)}d ago`;
        }
      }
    }
    if (!indexAge) {
      const stats = await stat(tldrPath);
      const ageMs = Date.now() - stats.mtimeMs;
      if (isMain) {
        const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
        indexAge = ageDays === 0 ? 'today' : `${ageDays}d ago`;
      } else {
        const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
        indexAge =
          ageHours === 0 ? 'now' : ageHours < 24 ? `${ageHours}h ago` : `${Math.floor(ageHours / 24)}d ago`;
      }
    }

    let fileCount: number | undefined;
    let edgeCount: number | undefined;
    const cgPath = join(tldrPath, 'cache', 'call_graph.json');
    const cgContent = await readFile(cgPath, 'utf-8').catch(() => null);
    if (cgContent) {
      const cg = JSON.parse(cgContent);
      edgeCount = Array.isArray(cg.edges) ? cg.edges.length : undefined;
      if (Array.isArray(cg.edges)) {
        const files = new Set<string>();
        for (const e of cg.edges) {
          if (e.from_file) files.add(e.from_file);
          if (e.to_file) files.add(e.to_file);
        }
        fileCount = files.size;
      }
    }

    return { fileCount, indexAge, edgeCount };
  } catch (err) {
    console.error(`[getIndexStats] Error for ${rootPath}:`, err);
    return {};
  }
}

// ─── Shared body reader ───────────────────────────────────────────────────────

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? (JSON.parse(text) as unknown) : {};
  } catch {
    return {} as unknown;
  }
});

// ─── Route: POST /api/trackers/refresh ───────────────────────────────────────

const postTrackersRefreshRoute = HttpRouter.add(
  'POST',
  '/api/trackers/refresh',
  Effect.promise(async () => {
    try {
      const svc = getIssueDataService();
      await Promise.all([
        svc.invalidateTracker('linear'),
        svc.invalidateTracker('github'),
        svc.invalidateTracker('rally'),
      ]);
      return jsonResponse({ success: true });
    }    catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error refreshing trackers:', error);
      return jsonResponse({ error: 'Failed to refresh: ' + msg }, { status: 500 });
      }}),
);

// ─── Route: GET /api/project-mappings ────────────────────────────────────────

const getProjectMappingsRoute = HttpRouter.add(
  'GET',
  '/api/project-mappings',
  httpHandler(Effect.promise(() => getProjectMappings().then(m => jsonResponse(m)))),
);

// ─── Route: PUT /api/project-mappings ────────────────────────────────────────

const putProjectMappingsRoute = HttpRouter.add(
  'PUT',
  '/api/project-mappings',
  Effect.gen(function* () {
    const body = yield* readJsonBody;
    const mappings = body as ProjectMapping[];
    if (!Array.isArray(mappings)) {
      return jsonResponse({ error: 'Expected array of mappings' }, { status: 400 });
    }
    yield* Effect.promise(() => saveProjectMappings(mappings));
    return jsonResponse({ success: true, mappings });
  }),
);

// ─── Route: POST /api/project-mappings ───────────────────────────────────────

const postProjectMappingsRoute = HttpRouter.add(
  'POST',
  '/api/project-mappings',
  Effect.gen(function* () {
    const body = yield* readJsonBody;
    const { linearProjectId, linearProjectName, linearPrefix, localPath } = body as Record<
      string,
      string | undefined
    >;

    if (!linearProjectId || !localPath) {
      return jsonResponse(
        { error: 'linearProjectId and localPath required' },
        { status: 400 },
      );
    }

    return yield* Effect.promise(async () => {
      try {
        const mappings = await getProjectMappings();
        const existing = mappings.findIndex(m => m.linearProjectId === linearProjectId);

        const mapping: ProjectMapping = {
          linearProjectId,
          linearProjectName: linearProjectName || '',
          linearPrefix: linearPrefix || '',
          localPath,
        };

        if (existing >= 0) {
          mappings[existing] = mapping;
        } else {
          mappings.push(mapping);
        }

        await saveProjectMappings(mappings);
        return jsonResponse({ success: true, mapping });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return jsonResponse({ error: 'Failed to save mapping: ' + msg }, { status: 500 });
      }
    });
  }),
);

// ─── Route: GET /api/system/health ───────────────────────────────────────────

const getSystemHealthRoute = HttpRouter.add(
  'GET',
  '/api/system/health',
  httpHandler(Effect.gen(function* () {
    const readModel = yield* ReadModelService;
    const health = yield* readModel.getSnapshot.pipe(
      Effect.flatMap((snapshot) => Effect.promise(() => getSystemHealthSnapshot(snapshot))),
    );
    return jsonResponse(health);
  })),
);

// ─── Route: GET /api/godview/system-health ───────────────────────────────────

const getGodviewSystemHealthRoute = HttpRouter.add(
  'GET',
  '/api/godview/system-health',
  httpHandler(Effect.gen(function* () {
    const readModel = yield* ReadModelService;
    const health = yield* readModel.getSnapshot.pipe(
      Effect.flatMap((snapshot) => Effect.promise(() => getSystemHealthSnapshot(snapshot))),
    );
    return jsonResponse({
      cpu: health.summary.cpuPercent,
      memPercent: health.summary.memoryUsedPercent,
      memUsed: health.summary.usedMemoryBytes,
      memTotal: health.summary.totalMemoryBytes,
      updatedAt: health.updatedAt,
    });
  })),
);

// ─── Route: GET /api/health/agents ───────────────────────────────────────────

const getHealthAgentsRoute = HttpRouter.add(
  'GET',
  '/api/health/agents',
  Effect.promise(async () => {
    try {
      const agentsDir = join(homedir(), '.panopticon', 'agents');
      if (!existsSync(agentsDir)) {
        return jsonResponse([]);
      }

      const agentNames = (await readdir(agentsDir)).filter(
        name =>
          name.startsWith('agent-') ||
          name.startsWith('planning-') ||
          name.startsWith('specialist-'),
      );

      // Fetch the live tmux session set ONCE for the whole request — without
      // this, determineHealthStatusAsync would spawn a tmux subprocess per
      // agent dir (~150 forks per /api/health poll, every 5s).
      const liveSessions = new Set(await listSessionNamesAsync());

      const agents = await Promise.all(
        agentNames.map(async name => {
          const stateFile = join(agentsDir, name, 'state.json');
          const healthFile = join(agentsDir, name, 'health.json');

          const healthStatus = await determineHealthStatusAsync(name, stateFile, liveSessions);
          if (!healthStatus) return null;

          // Only read health.json for agents that survive the status filter —
          // most agent dirs are stopped/completed and bail out above.
          let storedHealth = { consecutiveFailures: 0, killCount: 0 };
          try {
            const healthContent = await readFile(healthFile, 'utf-8');
            storedHealth = { ...storedHealth, ...JSON.parse(healthContent) };
          } catch {}

          let contextPercent: number | null = null;
          try {
            const ctxFile = join(agentsDir, name, 'context-pct');
            const ctxContent = await readFile(ctxFile, 'utf-8');
            contextPercent = parseInt(ctxContent.trim(), 10) || null;
          } catch {}

          return {
            agentId: name,
            status: healthStatus.status,
            reason: healthStatus.reason,
            lastPing: new Date().toISOString(),
            consecutiveFailures: storedHealth.consecutiveFailures,
            killCount: storedHealth.killCount,
            contextPercent,
          };
        }),
      );

      const visibleAgents = agents.filter(agent => agent !== null);
      return jsonResponse(visibleAgents);
    } catch (error: unknown) {
      console.error('Error fetching health:', error);
      return jsonResponse([]);
    }
  }),
);

// ─── Route: POST /api/health/agents/:id/ping ─────────────────────────────────

const postHealthAgentPingRoute = HttpRouter.add(
  'POST',
  '/api/health/agents/:id/ping',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, 'http://localhost');
    const parts = url.pathname.split('/');
    // /api/health/agents/:id/ping → parts[4] = id
    const id = parts[4] || '';

    return yield* Effect.promise(async () => {
    try {
        const health = await checkAgentHealthAsync(id);

        if (!health.alive) {
          return jsonResponse({ success: false, status: 'dead' });
        }

        const stateFile = join(homedir(), '.panopticon', 'agents', id, 'state.json');
        if (existsSync(stateFile)) {
          try {
            const stateContent = await readFile(stateFile, 'utf-8');
            const state = JSON.parse(stateContent);
            state.lastPing = new Date().toISOString();
            await writeFile(stateFile, JSON.stringify(state, null, 2));
          } catch {}
        }

        return jsonResponse({
          success: true,
          status: 'healthy',
          hasOutput: !!health.lastOutput,
        });
      }    catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return jsonResponse({ error: 'Failed to ping agent: ' + msg }, { status: 500 });
        }})
  }),
);

// ─── Route: GET /api/tracker-status ──────────────────────────────────────────

const getTrackerStatusRoute = HttpRouter.add(
  'GET',
  '/api/tracker-status',
  Effect.try({
    try: () => {
      const panConfig = loadPanConfig();
      const yamlConfig = loadYamlConfig();
      const primary = panConfig.trackers?.primary;
      const secondary = panConfig.trackers?.secondary;

      const trackerEnvVars: Record<string, string> = {
        linear: 'LINEAR_API_KEY',
        github: 'GITHUB_TOKEN',
        gitlab: 'GITLAB_TOKEN',
        rally: 'RALLY_API_KEY',
      };

      const trackerNames: Record<string, string> = {
        linear: 'Linear',
        github: 'GitHub',
        gitlab: 'GitLab',
        rally: 'Rally',
      };

      const configured: Array<{
        type: string;
        name: string;
        hasKey: boolean;
        envVar: string;
        isPrimary: boolean;
      }> = [];

      // Only report trackers that have at least one project using them
      const projects = listProjects();
      const cfgs = projects.map(p => p.config as Record<string, unknown>);
      const trackerHasProjects: Record<string, boolean> = {
        linear: cfgs.some(c => !!c.linear_project),
        github: cfgs.some(c => !!c.github_repo),
        rally: cfgs.some(c => !!c.rally_project),
        gitlab: cfgs.some(c => !!c.gitlab_repo),
      };

      const trackersToCheck = [primary, secondary].filter(Boolean) as string[];
      for (const trackerType of trackersToCheck) {
        // Skip trackers that no project uses
        if (trackerHasProjects[trackerType] === false) continue;

        const envVar = trackerEnvVars[trackerType] || `${trackerType.toUpperCase()}_API_KEY`;
        const hasEnvKey = !!process.env[envVar];
        const hasConfigKey = !!((yamlConfig.trackerKeys || {}) as Record<string, string | undefined>)[trackerType];

        let hasEnvFileKey = false;
        if (trackerType === 'linear') hasEnvFileKey = !!getLinearApiKeyShared();
        else if (trackerType === 'github') hasEnvFileKey = !!getGitHubConfigShared();
        else if (trackerType === 'rally') hasEnvFileKey = !!getRallyConfigShared();

        configured.push({
          type: trackerType,
          name: trackerNames[trackerType] || trackerType,
          hasKey: hasEnvKey || hasConfigKey || hasEnvFileKey,
          envVar,
          isPrimary: trackerType === primary,
        });
      }

      return jsonResponse({ primary, secondary, configured });
    },
    catch: (error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error checking tracker status:', error);
      return jsonResponse(
        { error: 'Failed to check tracker status: ' + msg },
        { status: 500 },
      );
    },
  }),
);

// ─── Route: POST /api/rally/validate ─────────────────────────────────────────

const postRallyValidateRoute = HttpRouter.add(
  'POST',
  '/api/rally/validate',
  Effect.gen(function* () {
    const body = yield* readJsonBody;
    const { apiKey, server, workspace, project } = body as Record<string, string | undefined>;

    if (!apiKey) {
      return jsonResponse({ valid: false, error: 'API key is required' }, { status: 400 });
    }

    return yield* Effect.promise(async () => {
    try {
        const { RallyRestApi } = await import('../../../lib/tracker/rally-api.js');
        const api = new RallyRestApi({
          apiKey,
          server: server || 'https://rally1.rallydev.com',
        });

        const result = await api.query({
          type: 'artifact',
          fetch: ['FormattedID'],
          query: '((State = "Open"))',
          limit: 1,
          workspace,
          project,
        });

        return jsonResponse({
          valid: true,
          message: 'Rally connection successful',
          testQueryResult: `Found ${result.QueryResult.TotalResultCount} artifacts`,
        });
      }    catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        const isAuthError =
          error.message?.includes('Unauthorized') || error.message?.includes('401');
        const isParseError = error.message?.includes('Could not parse');
        return jsonResponse(
          {
            valid: false,
            error: error.message,
            errorType: isAuthError ? 'auth' : isParseError ? 'query' : 'network',
          },
          { status: 400 },
        );
        }})
  }),
);

// ─── Route: GET /api/deacon/status ───────────────────────────────────────────

const getDeaconStatusRoute = HttpRouter.add(
  'GET',
  '/api/deacon/status',
  Effect.try({
    try: () => {
      const service = getCloisterService();
      const status = service.getDeaconStatus();
      const lastPatrol = service.getLastPatrolResult();
      return jsonResponse({
        ...status,
        lastPatrol: lastPatrol
          ? {
              cycle: lastPatrol.cycle,
              timestamp: lastPatrol.timestamp,
              actions: lastPatrol.actionsToken,
              massDeathDetected: lastPatrol.massDeathDetected,
            }
          : null,
      });
    },
    catch: (error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error getting deacon status:', error);
      return jsonResponse(
        { error: 'Failed to get deacon status: ' + msg },
        { status: 500 },
      );
    },
  }),
);

// ─── Route: GET /api/deacon/logs ─────────────────────────────────────────────

const getDeaconLogsRoute = HttpRouter.add(
  'GET',
  '/api/deacon/logs',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, 'http://localhost');
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam) : 100;

    return yield* Effect.try({
      try: () => {
        const service = getCloisterService();
        const logs = service.getDeaconLogs(Math.min(limit, 200));
        return jsonResponse({ logs });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error getting deacon logs:', error);
        return jsonResponse(
          { error: 'Failed to get deacon logs: ' + msg },
          { status: 500 },
        );
      },
    });
  }),
);

// ─── Route: POST /api/deacon/patrol ──────────────────────────────────────────

const postDeaconPatrolRoute = HttpRouter.add(
  'POST',
  '/api/deacon/patrol',
  Effect.promise(async () => {
    try {
      const service = getCloisterService();
      const result = await service.runDeaconPatrol();
      return jsonResponse(result);
    }    catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error running deacon patrol:', error);
      return jsonResponse(
        { error: 'Failed to run patrol: ' + msg },
        { status: 500 },
      );
      }}),
);

// ─── Route: GET /api/deacon/pause ────────────────────────────────────────────

/**
 * Read the persisted global Deacon pause flag. Distinct from runtime `isRunning`:
 * paused means the patrol timer still fires but every cycle short-circuits.
 */
const getDeaconPauseRoute = HttpRouter.add(
  'GET',
  '/api/deacon/pause',
  Effect.try({
    try: () => jsonResponse({ paused: isDeaconGloballyPaused() }),
    catch: (error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: 'Failed to read deacon pause flag: ' + msg }, { status: 500 });
    },
  }),
);

// ─── Route: POST /api/deacon/pause ───────────────────────────────────────────

/**
 * Toggle the persisted global Deacon pause flag. Body: `{ paused: boolean }`.
 * Persists to `app_settings` so the flag survives dashboard restarts.
 */
const postDeaconPauseRoute = HttpRouter.add(
  'POST',
  '/api/deacon/pause',
  httpHandler(Effect.gen(function* () {
    const body = (yield* readJsonBody) as { paused?: unknown };
    if (typeof body.paused !== 'boolean') {
      return jsonResponse({ error: 'Body must include { paused: boolean }' }, { status: 400 });
    }
    setDeaconGloballyPaused(body.paused);
    console.log(`[deacon] Global pause flag set to ${body.paused}`);
    return jsonResponse({ paused: isDeaconGloballyPaused() });
  })),
);

// ─── Route: GET /api/version ──────────────────────────────────────────────────

const getVersionRoute = HttpRouter.add(
  'GET',
  '/api/version',
  Effect.promise(async () => {
    const version = await getPanopticonVersion();
    // Expose supervisor URL so the frontend can cache it while the dashboard
    // is healthy, then use it as a fallback when the dashboard is dead.
    let supervisorUrl: string | null = null;
    try {
      const { getSupervisorUrl } = await import('../../../lib/supervisor.js');
      supervisorUrl = getSupervisorUrl();
    } catch {
      // supervisor module not available in this build — benign
    }
    return jsonResponse({ version, isDev: panopticonDevMode, supervisorUrl });
  }),
);

// ─── Route: GET /api/registered-projects ─────────────────────────────────────

const getRegisteredProjectsRoute = HttpRouter.add(
  'GET',
  '/api/registered-projects',
  Effect.try({
    try: () => {
      const projects = listProjects();
      return jsonResponse(
        projects.map(p => ({
          key: p.key,
          name: p.config.name,
          path: p.config.path,
          linearTeam: getIssuePrefix(p.config) || null,
          githubRepo: p.config.github_repo || null,
          linearProject: p.config.linear_project || null,
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
        await sendKeysAsync(confirmationRequest.sessionName, response);
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
        { path: join(homedir(), '.panopticon', 'skills'), source: 'panopticon' },
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

// ─── Route: GET /api/planning/:issueId/status ────────────────────────────────

const getPlanningStatusRoute = HttpRouter.add(
  'GET',
  '/api/planning/:issueId/status',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, 'http://localhost');
    const parts = url.pathname.split('/');
    // /api/planning/:issueId/status → parts[3] = issueId
    const issueId = parts[3] || '';
    const sessionName = `planning-${issueId.toLowerCase()}`;
    const issueLower = issueId.toLowerCase();
    const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];

    return yield* Effect.promise(async () => {
      try {
        const projectPath = await getProjectPath(issuePrefix);
        const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
        let isRemote = false;
        let vmName = '';
        const agentStateDir = join(homedir(), '.panopticon', 'agents', sessionName);
        const stateFile = join(agentStateDir, 'state.json');

        let agentStarting = false;
        try {
          const stateContent = await readFile(stateFile, 'utf-8').catch(() => null);
          if (stateContent) {
            const state = JSON.parse(stateContent);
            if (state.location === 'remote' && state.vmName) {
              isRemote = true;
              vmName = state.vmName;
            }
            if (state.status === 'starting') {
              agentStarting = true;
            }
          }
        } catch {}

        let sessionExists = false;
        if (!isRemote) {
          try {
            sessionExists = await sessionExistsAsync(sessionName);
          } catch {}
        }

        const panDir = join(workspacePath, PAN_DIRNAME);
        const panContinueFile = join(panDir, PAN_CONTINUE_FILENAME);
        const hasContinueFile = existsSync(panContinueFile);
        const hasPlanningState = hasContinueFile || findPlan(workspacePath) !== null;
        const hasPromptFile = hasPlanningState;
        // hasCompletionMarker means `plan.status === 'proposed'` (gates the
        // dashboard Done button which should hide once the user has approved).
        // planningCompleted means `plan.status` indicates planning has finished
        // (any of proposed/approved/pending/running/completed/blocked).
        const hasCompletionMarker = existsSync(panDir)
          ? isPlanningProposed(workspacePath, panDir)
          : false;
        const planningCompleted = existsSync(panDir)
          ? isPlanningComplete(workspacePath, panDir)
          : false;

        return jsonResponse({
          active: sessionExists || agentStarting,
          sessionName,
          workspacePath: existsSync(workspacePath) ? workspacePath : undefined,
          planningCompleted,
          hasStateFile: hasPlanningState,
          hasPromptFile,
          hasCompletionMarker,
          isRemote,
          vmName: isRemote ? vmName : undefined,
        });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return jsonResponse({
          active: false,
          sessionName,
          planningCompleted: false,
          error: msg,
        });
      }
    })
  }),
);

// ─── Route: POST /api/planning/:issueId/message ──────────────────────────────

const postPlanningMessageRoute = HttpRouter.add(
  'POST',
  '/api/planning/:issueId/message',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, 'http://localhost');
    const parts = url.pathname.split('/');
    // /api/planning/:issueId/message → parts[3] = issueId
    const issueId = parts[3] || '';
    const sessionName = `planning-${issueId.toLowerCase()}`;
    const issueLower = issueId.toLowerCase();

    const body = yield* readJsonBody;
    const { message } = body as { message?: string };
    const eventStore = yield* EventStoreService;

    if (!message) {
      return jsonResponse({ error: 'Message required' }, { status: 400 });
    }

    return yield* Effect.promise(async () => {
      try {
        // Determine project path
        const githubCheck = isGitHubIssue(issueId);
        let projectPath = '';

        if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
          const localPaths = getGitHubLocalPaths();
          projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`] || '';
        }
        if (!projectPath) {
          const teamPrefix = extractTeamPrefix(issueId);
          const projectConfig = teamPrefix ? findProjectByTeam(teamPrefix) : null;
          projectPath = projectConfig?.path || '';
        }

        if (!projectPath) {
          return jsonResponse(
            { error: `Could not find project path for ${issueId}. Check projects.yaml.` },
            { status: 404 },
          );
        }

        const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
        const planningDir = join(workspacePath, PAN_DIRNAME);
        if (!existsSync(planningDir)) {
          return jsonResponse(
            { error: 'Planning directory not found', sessionEnded: true },
            { status: 404 },
          );
        }

        // Check if session is remote
        let isRemote = false;
        const agentStateDir = join(homedir(), '.panopticon', 'agents', sessionName);
        const stateFile = join(agentStateDir, 'state.json');
        try {
          const stateContent = await readFile(stateFile, 'utf-8').catch(() => null);
          if (stateContent) {
            const state = JSON.parse(stateContent);
            if (state.location === 'remote' && state.vmName) {
              isRemote = true;
            }
          }
        } catch {}

        // Check if local session exists (skip remote for now)
        let sessionExists = false;
        if (!isRemote) {
          try {
            sessionExists = await sessionExistsAsync(sessionName);
          } catch {}
        }

        if (sessionExists) {
          await sendKeysAsync(sessionName, message, 'planning user message');
          await Effect.runPromise(eventStore.append({
            type: 'planning.sync',
            timestamp: new Date().toISOString(),
            payload: { issueId, status: 'running', message: 'User message sent' },
          }));
          return jsonResponse({
            success: true,
            sessionName,
            message: 'Message sent to active session',
          });
        }

        // Session not alive — restart with continuation prompt
        const outputFile = join(planningDir, 'output.jsonl');
        let conversationLog = '';
        const outputContent = await readFile(outputFile, 'utf-8').catch(() => null);
        if (outputContent) {
          const lines = outputContent.split('\n').filter(line => line.trim());
          const logParts: string[] = [];

          for (const line of lines) {
            try {
              const json = JSON.parse(line);
              if (json.type === 'assistant' && json.message?.content) {
                for (const block of json.message.content) {
                  if (block.type === 'text') {
                    logParts.push(`**Assistant:**\n${block.text}`);
                  }
                }
              }
            } catch {}
          }
          conversationLog = logParts.join('\n\n');
        }

        const continuationPromptPath = join(planningDir, 'CONTINUATION_PROMPT.md');
        const continuationPrompt = `# Continuation of Planning Session: ${issueId.toUpperCase()}

## CRITICAL: PLANNING ONLY - NO IMPLEMENTATION

**YOU ARE IN PLANNING MODE. DO NOT:**
- Write or modify any code files
- Run implementation commands (npm install, docker, etc.)
- Create actual features or functionality

**YOU SHOULD ONLY:**
- Ask clarifying questions
- Explore the codebase to understand context
- Generate planning artifacts (\`.pan/continue.json\`, \`.pan/spec.vbrief.json\`)
- Present options and tradeoffs

---

## Previous Conversation

${conversationLog}

---

## User's Response

${message}

---

## Your Task

Continue the PLANNING session. Do NOT implement anything.
`;

        await writeFile(continuationPromptPath, continuationPrompt);

        const agentCwd = workspacePath;

        if (existsSync(outputFile)) {
          const backupPath = join(planningDir, `output-${Date.now()}.jsonl`);
          await rename(outputFile, backupPath);
        }

        const { getAgentCommand } = await import('../../../lib/settings.js');
        let msgPlanningModel = 'claude-sonnet-4-6';
        try {
          const { loadConfig, resolveModel } = await import('../../../lib/config-yaml.js');
          msgPlanningModel = resolveModel('plan', undefined, loadConfig().config);
        } catch { /* fall back to default */ }
        const msgAgentCmd = getAgentCommand(msgPlanningModel);
        const msgPermissionFlags = getClaudePermissionFlagsString();
        const msgCmdWithArgs =
          msgAgentCmd.args.length > 0
            ? `${msgAgentCmd.command} ${msgAgentCmd.args.join(' ')} ${msgPermissionFlags}`
            : `${msgAgentCmd.command} ${msgPermissionFlags}`;

        const launcherScript = join(agentStateDir, 'continuation-launcher.sh');
        await mkdir(agentStateDir, { recursive: true });

        await writeFile(
          launcherScript,
          generateLauncherScript({
            role: 'plan',
            workingDir: agentCwd,
            baseCommand: msgCmdWithArgs,
            promptInline: `Please read the continuation prompt at ${continuationPromptPath} and continue the planning session.`,
          }),
          { mode: 0o755 },
        );

        await createSessionAsync(sessionName, agentCwd, `bash '${launcherScript}'`);

        try {
          await resizeWindowAsync(sessionName, 200, 50);
        } catch {}

        await Effect.runPromise(eventStore.append({
          type: 'planning.sync',
          timestamp: new Date().toISOString(),
          payload: { issueId, status: 'running', message: 'User message sent' },
        }));

        return jsonResponse({
          success: true,
          sessionName,
          message: 'Planning session restarted in interactive mode',
        });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error sending planning message:', error);
        return jsonResponse(
          { error: 'Failed to send message: ' + msg },
          { status: 500 },
        );
      }
    })
  }),
);

// ─── Route: DELETE /api/planning/:issueId ────────────────────────────────────

const deletePlanningSessionRoute = HttpRouter.add(
  'DELETE',
  '/api/planning/:issueId',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, 'http://localhost');
    const parts = url.pathname.split('/');
    // /api/planning/:issueId → parts[3] = issueId
    const issueId = parts[3] || '';
    const sessionName = `planning-${issueId.toLowerCase()}`;

    return yield* Effect.promise(async () => {
      try {
        await killSessionAsync(sessionName);
        return jsonResponse({ success: true });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        // tmux reports "can't find session" when the session is already gone — treat as success.
        if (/can't find session|session not found|no session found/i.test(msg)) {
          return jsonResponse({ success: true, alreadyStopped: true });
        }
        console.error(`[delete-planning] kill-session failed for ${sessionName}:`, msg);
        return jsonResponse(
          { error: 'Failed to stop planning: ' + msg },
          { status: 500 },
        );
      }
    });
  }),
);

// ─── Route: GET /api/services/tldr/status ────────────────────────────────────

const getTldrStatusRoute = HttpRouter.add(
  'GET',
  '/api/services/tldr/status',
  Effect.promise(async () => {
    try {
      const { getTldrDaemonService } = await import('../../../lib/tldr-daemon.js');
      const projectRoot = process.cwd();
      const venvPath = join(projectRoot, '.venv');

      const results: Array<{
        workspace: string;
        running: boolean;
        pid?: number;
        healthy: boolean;
        workspacePath: string;
        fileCount?: number;
        indexAge?: string;
        edgeCount?: number;
      }> = [];

      if (existsSync(venvPath)) {
        const service = getTldrDaemonService(projectRoot, venvPath);
        const status = await service.getStatus();
        const indexStats = getIndexStats(projectRoot, true);

        results.push({
          workspace: 'main',
          running: status.running,
          pid: status.pid,
          healthy: status.healthy,
          workspacePath: projectRoot,
          ...indexStats,
        });
      }

      const workspacesDir = join(projectRoot, 'workspaces');
      if (existsSync(workspacesDir)) {
        const workspaces = (await readdir(workspacesDir, { withFileTypes: true })).filter(
          d => d.isDirectory() && d.name.startsWith('feature-'),
        );

        for (const ws of workspaces) {
          const wsPath = join(workspacesDir, ws.name);
          const wsVenvPath = join(wsPath, '.venv');

          if (existsSync(wsVenvPath)) {
            const service = getTldrDaemonService(wsPath, wsVenvPath);
            const status = await service.getStatus();
            const indexStats = getIndexStats(wsPath, false);

            results.push({
              workspace: ws.name,
              running: status.running,
              pid: status.pid,
              healthy: status.healthy,
              workspacePath: wsPath,
              ...indexStats,
            });
          }
        }
      }

      return jsonResponse({ daemons: results });
    }    catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error getting TLDR status:', error);
      return jsonResponse({ error: msg }, { status: 500 });
      }}),
);

// ─── Route: POST /api/services/tldr/start ────────────────────────────────────

const postTldrStartRoute = HttpRouter.add(
  'POST',
  '/api/services/tldr/start',
  Effect.promise(async () => {
    try {
      const { getTldrDaemonService } = await import('../../../lib/tldr-daemon.js');
      const projectRoot = process.cwd();
      const venvPath = join(projectRoot, '.venv');

      if (!existsSync(venvPath)) {
        return jsonResponse(
          { error: 'No .venv found in project root' },
          { status: 404 },
        );
      }

      const service = getTldrDaemonService(projectRoot, venvPath);
      await service.start();
      return jsonResponse({ success: true, message: 'TLDR daemon started' });
    }    catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error starting TLDR daemon:', error);
      return jsonResponse({ error: msg }, { status: 500 });
      }}),
);

// ─── Route: POST /api/services/tldr/stop ─────────────────────────────────────

const postTldrStopRoute = HttpRouter.add(
  'POST',
  '/api/services/tldr/stop',
  Effect.promise(async () => {
    try {
      const { getTldrDaemonService } = await import('../../../lib/tldr-daemon.js');
      const projectRoot = process.cwd();
      const venvPath = join(projectRoot, '.venv');

      if (!existsSync(venvPath)) {
        return jsonResponse(
          { error: 'No .venv found in project root' },
          { status: 404 },
        );
      }

      const service = getTldrDaemonService(projectRoot, venvPath);
      await service.stop();
      return jsonResponse({ success: true, message: 'TLDR daemon stopped' });
    }    catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error stopping TLDR daemon:', error);
      return jsonResponse({ error: msg }, { status: 500 });
      }}),
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
    const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];

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
          updateInferenceDocument,
        } = await import('../../../lib/shadow-engineering/index.js');

        const config = { issueId, workspacePath, projectPath };
        const artifacts = await gatherArtifacts(config);
        const inference = generateBasicInference(config, artifacts);
        updateInferenceDocument(workspacePath, inference);

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
    const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];

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

        const commentsPosted = await runObserverCycle(config);
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
const panopticonProjectRoot: string | null = (() => {
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
    if (!panopticonDevMode || !panopticonProjectRoot) {
      return jsonResponse({ error: 'Rebuild only available in dev mode' }, { status: 403 });
    }
    return yield* Effect.promise(async () => {
      try {
        const { stdout, stderr } = await execAsync('npm run build', {
          cwd: panopticonProjectRoot,
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
// path in App.tsx when window.panopticonBridge is not available.
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
  postTrackersRefreshRoute,
  getProjectMappingsRoute,
  putProjectMappingsRoute,
  postProjectMappingsRoute,
  getSystemHealthRoute,
  getGodviewSystemHealthRoute,
  getHealthAgentsRoute,
  postHealthAgentPingRoute,
  getTrackerStatusRoute,
  postRallyValidateRoute,
  getDeaconStatusRoute,
  getDeaconLogsRoute,
  postDeaconPatrolRoute,
  getDeaconPauseRoute,
  postDeaconPauseRoute,
  getVersionRoute,
  getRegisteredProjectsRoute,
  getConfirmationsRoute,
  postConfirmationRespondRoute,
  getSkillsRoute,
  getPlanningStatusRoute,
  postPlanningMessageRoute,
  deletePlanningSessionRoute,
  getTldrStatusRoute,
  postTldrStartRoute,
  postTldrStopRoute,
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

/**
 * Container-ops route module — extracted from routes/workspaces.ts (B2).
 *
 * Containerization + Docker control + DB refresh endpoints:
 *   POST /api/workspaces/:issueId/containerize
 *   POST /api/workspaces/:issueId/containers/:containerName/:action
 *   POST /api/workspaces/:issueId/memory-summary
 *   POST /api/workspaces/:issueId/refresh-db
 *
 * Shared singletons (activity log, pending ops, project helpers, repairFlywayIfNeeded)
 * stay owned by ../workspaces.js and are imported here.
 */

import { exec, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { buildChildEnvWithoutTmuxSync } from '../../../../lib/child-env.js';
import { extractPrefixSync, parseIssueIdSync } from '../../../../lib/issue-id.js';
import { generateDailySummary } from '../../../../lib/memory/cli.js';
import {
  extractTeamPrefix,
  findProjectByTeamSync,
  listProjectsSync,
} from '../../../../lib/projects.js';
import { DEVCONTAINER_DIRNAME } from '../../../../lib/workspace/devcontainer-renderer.js';
import type { DatabaseConfig } from '../../../../lib/workspace-config.js';
import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import {
  appendActivityOutput,
  getProjectPath,
  logActivity,
  repairFlywayIfNeeded,
  requireTrustedMutationOrigin,
  updateActivity,
} from '../workspaces.js';

const execAsync = promisify(exec);

function requireDatabaseName(dbConfig: DatabaseConfig | undefined): string {
  if (!dbConfig) {
    throw new Error('No database configuration found in projects.yaml');
  }
  const name = dbConfig.name?.trim();
  if (!name) {
    throw new Error('Missing required database.name in projects.yaml database config');
  }
  return name;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function sqlIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function sqlString(value: string): string {
  return value.replace(/'/g, "''");
}

// ─── Route: POST /api/workspaces/:issueId/containerize ───────────────────────

const postWorkspaceContainerizeRoute = HttpRouter.add(
  'POST',
  '/api/workspaces/:issueId/containerize',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const issueLower = issueId.toLowerCase();

    const newFeatureScript = join(projectPath, 'infra', 'new-feature');
    if (!existsSync(newFeatureScript)) {
      return jsonResponse(
        { error: 'Project does not support containerization (no infra/new-feature script)' },
        { status: 400 }
      );
    }

    const workspaceName = `feature-${issueLower}`;
    const workspacePath = join(projectPath, 'workspaces', workspaceName);
    if (existsSync(join(workspacePath, '.devcontainer'))) {
      return jsonResponse({ error: 'Workspace is already containerized' }, { status: 400 });
    }

    try {
      yield* Effect.promise(() => execAsync('docker info >/dev/null 2>&1', { encoding: 'utf-8' }));
    } catch {
      return jsonResponse(
        { error: 'Docker is not running. Start Docker Desktop first.' },
        { status: 400 }
      );
    }

    if (existsSync(workspacePath)) {
      return jsonResponse(
        { error: 'Workspace already exists. Use the workspace inspector to manage it, or remove it first with: pan workspace destroy ' + issueId },
        { status: 409 }
      );
    }

    const featureName = issueLower;
    const activityId = Date.now().toString();

    logActivity({
      id: activityId,
      timestamp: new Date().toISOString(),
      command: `./new-feature ${featureName}`,
      status: 'running',
      output: [],
    });

    const child = spawn('./new-feature', [featureName], {
      cwd: join(projectPath, 'infra'),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (data) => {
      data.toString().split('\n').filter(Boolean).forEach((line: string) => {
        appendActivityOutput(activityId, line);
      });
    });
    child.stderr?.on('data', (data) => {
      data.toString().split('\n').filter(Boolean).forEach((line: string) => {
        appendActivityOutput(activityId, `[stderr] ${line}`);
      });
    });

    child.on('close', (code) => {
      appendActivityOutput(
        activityId,
        `[${new Date().toISOString()}] new-feature exited with code ${code}`
      );
      if (code === 0) {
        appendActivityOutput(activityId, '');
        appendActivityOutput(activityId, '=== Starting containers ===');

        const workspaceDir = join(projectPath, 'workspaces', `feature-${featureName}`);
        const uid = process.getuid?.() ?? 1000;
        const gid = process.getgid?.() ?? 1000;
        const devUp = spawn('./dev', ['all'], {
          cwd: workspaceDir,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: buildChildEnvWithoutTmuxSync(process.env, { UID: String(uid), GID: String(gid), DOCKER_USER: `${uid}:${gid}` }),
        });

        devUp.stdout?.on('data', (data) => {
          data.toString().split('\n').filter(Boolean).forEach((line: string) => {
            appendActivityOutput(activityId, line);
          });
        });
        devUp.stderr?.on('data', (data) => {
          data.toString().split('\n').filter(Boolean).forEach((line: string) => {
            appendActivityOutput(activityId, `[stderr] ${line}`);
          });
        });
        devUp.on('close', (devCode) => {
          appendActivityOutput(
            activityId,
            `[${new Date().toISOString()}] ./dev all exited with code ${devCode}`
          );
          updateActivity(activityId, { status: devCode === 0 ? 'completed' : 'failed' });
        });
        devUp.on('error', (err) => {
          appendActivityOutput(activityId, `[error] ${err.message}`);
          updateActivity(activityId, { status: 'failed' });
        });
      } else {
        updateActivity(activityId, { status: 'failed' });
      }
    });

    child.on('error', (err) => {
      appendActivityOutput(activityId, `[error] ${err.message}`);
      updateActivity(activityId, { status: 'failed' });
    });

    return jsonResponse({
      success: true,
      message: `Containerizing workspace for ${issueId}`,
      activityId,
      projectPath,
    });
  }))
);

// ─── Route: POST /api/workspaces/:issueId/containers/:containerName/:action ───

const postWorkspaceContainerActionRoute = HttpRouter.add(
  'POST',
  '/api/workspaces/:issueId/containers/:containerName/:action',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const containerName = params['containerName'] ?? '';
    const action = params['action'] ?? '';

    if (!['start', 'stop', 'restart'].includes(action)) {
      return jsonResponse(
        { error: 'Invalid action. Must be start, stop, or restart.' },
        { status: 400 }
      );
    }

    const teamPrefix = extractTeamPrefix(issueId);
    const containerProjectConfig = teamPrefix ? findProjectByTeamSync(teamPrefix) : null;
    const projectPaths = containerProjectConfig
      ? [
          join(
            containerProjectConfig.path,
            'workspaces',
            `feature-${issueId.toLowerCase()}`
          ),
        ]
      : listProjectsSync().map(p =>
          join(p.config.path, 'workspaces', `feature-${issueId.toLowerCase()}`)
        );

    let workspacePath: string | null = null;
    let composeFile: string | null = null;

    for (const path of projectPaths) {
      if (existsSync(path)) {
        workspacePath = path;
        const composePaths = [
          join(path, '.devcontainer/docker-compose.devcontainer.yml'),
          join(path, 'docker-compose.yml'),
          join(path, 'docker-compose.yaml'),
        ];
        for (const cp of composePaths) {
          if (existsSync(cp)) {
            composeFile = cp;
            break;
          }
        }
        break;
      }
    }

    if (!workspacePath) {
      return jsonResponse(
        { error: `Workspace not found for ${issueId}` },
        { status: 404 }
      );
    }

    // Self-heal: if .devcontainer/ is missing for start/restart, re-render
    // from the project template so docker compose can operate on containers.
    if (!composeFile && ['start', 'restart'].includes(action)) {
      const { ensureDevcontainerSync } = yield* Effect.promise(() =>
        import('../../../../lib/workspace/ensure-devcontainer.js')
      );
      const ensure = ensureDevcontainerSync({ workspacePath, issueId });
      if (ensure.rendered) {
        console.log(`[container-control] Re-rendered ${DEVCONTAINER_DIRNAME}/ from project template`);
      }
      // Re-scan for compose file after re-render
      const composePaths = [
        join(workspacePath, '.devcontainer/docker-compose.devcontainer.yml'),
        join(workspacePath, 'docker-compose.yml'),
        join(workspacePath, 'docker-compose.yaml'),
      ];
      for (const cp of composePaths) {
        if (existsSync(cp)) {
          composeFile = cp;
          break;
        }
      }
    }

    if (!composeFile) {
      return jsonResponse(
        { error: `No docker-compose file found in workspace` },
        { status: 404 }
      );
    }

    try {
      yield* Effect.promise(() => execAsync('docker info >/dev/null 2>&1', { encoding: 'utf-8' }));
    } catch {
      return jsonResponse(
        { error: 'Docker is not running. Start Docker Desktop first.' },
        { status: 400 }
      );
    }

    const serviceMap: Record<string, string[]> = {
      frontend: ['fe', 'frontend'],
      api: ['api'],
      dev: ['dev'],
      postgres: ['postgres'],
      redis: ['redis'],
      fe: ['fe', 'frontend'],
    };

    const serviceNames = serviceMap[containerName.toLowerCase()];
    if (!serviceNames) {
      return jsonResponse(
        {
          error: `Unknown container: ${containerName}. Valid: ${Object.keys(serviceMap).join(', ')}`,
        },
        { status: 400 }
      );
    }

    const { stdout: projectNameOut } = yield* Effect.promise(() => execAsync(
      `docker compose -f "${composeFile}" config --format json 2>/dev/null | jq -r '.name // empty'`,
      { encoding: 'utf-8' }
    ));
    const projectName = projectNameOut.trim();

    // Pre-start Flyway repair for API containers
    if (
      containerName.toLowerCase() === 'api' &&
      ['start', 'restart'].includes(action)
    ) {
      const tPrefix = extractTeamPrefix(issueId);
      const pConfig = tPrefix ? findProjectByTeamSync(tPrefix) : null;
      if (
        pConfig?.workspace?.database?.migrations?.type === 'flyway' &&
        projectName
      ) {
        const databaseName = requireDatabaseName(pConfig.workspace.database);
        const pgContainer = `${projectName}-postgres-1`;
        try {
          const result = yield* Effect.promise(() => repairFlywayIfNeeded(
            issueId,
            pgContainer,
            databaseName,
            pConfig,
            workspacePath!
          ));
          if (result.repaired) {
            console.log(`[container-control] ${result.message}`);
          }
        } catch (repairErr: unknown) {
          console.warn(
            `[container-control] Flyway pre-check failed (non-fatal): ${repairErr instanceof Error ? repairErr.message : String(repairErr)}`
          );
        }
      }
    }

    let success = false;
    let lastError = '';

    for (const serviceName of serviceNames) {
      try {
        const cmd = `docker compose -f "${composeFile}" ${projectName ? `--project-name "${projectName}"` : ''} ${action} ${serviceName}`;
        console.log(`[container-control] Running: ${cmd}`);
        yield* Effect.promise(() => execAsync(cmd, { encoding: 'utf-8', timeout: 30000 }));
        success = true;
        console.log(
          `[container-control] Successfully ${action}ed ${serviceName} for ${issueId}`
        );
        break;
      } catch (err: unknown) {
        lastError = (err instanceof Error ? err.message : '') || String(err);
      }
    }

    if (success) {
      return jsonResponse({
        success: true,
        message: `Container ${containerName} ${action}ed successfully`,
      });
    } else {
      return jsonResponse(
        { error: `Failed to ${action} ${containerName}: ${lastError}` },
        { status: 500 }
      );
    }
  }))
);

// ─── Route: POST /api/workspaces/:issueId/memory-summary ─────────────────────

const postWorkspaceMemorySummaryRoute = HttpRouter.add(
  'POST',
  '/api/workspaces/:issueId/memory-summary',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = requireTrustedMutationOrigin(request);
    if (originError) return originError;

    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: 'Invalid issue ID' }, { status: 400 });
    }

    const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const result = yield* Effect.promise(() => generateDailySummary({
      projectId: basename(projectPath),
      issueId,
    }));
    return jsonResponse(result);
  }))
);

// ─── Route: POST /api/workspaces/:issueId/refresh-db ─────────────────────────

const postWorkspaceRefreshDbRoute = HttpRouter.add(
  'POST',
  '/api/workspaces/:issueId/refresh-db',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }

    const teamPrefix = extractTeamPrefix(issueId);
    const projectConfig = teamPrefix ? findProjectByTeamSync(teamPrefix) : null;

    if (!projectConfig) {
      return jsonResponse(
        { error: `No project found for issue prefix: ${issueId}` },
        { status: 404 }
      );
    }

    const dbConfig = projectConfig.workspace?.database;
    if (!dbConfig?.seed_file) {
      return jsonResponse(
        { error: 'No seed_file configured in projects.yaml database config' },
        { status: 400 }
      );
    }
    const databaseName = requireDatabaseName(dbConfig);

    const seedFile = join(projectConfig.path, dbConfig.seed_file);
    if (!existsSync(seedFile)) {
      return jsonResponse(
        { error: `Seed file not found: ${seedFile}` },
        { status: 400 }
      );
    }

    const flywayFile = join(dirname(seedFile), 'zzz-flyway-workspace-baseline.sql');
    if (!existsSync(flywayFile)) {
      return jsonResponse(
        { error: `Flyway baseline not found: ${flywayFile}` },
        { status: 400 }
      );
    }

    const issueLower = issueId.toLowerCase();
    const featureFolder = `feature-${issueLower}`;
    const workspacesDir = projectConfig.workspace?.workspaces_dir || 'workspaces';
    const workspacePath = join(projectConfig.path, workspacesDir, featureFolder);

    if (!existsSync(workspacePath)) {
      return jsonResponse(
        { error: `Workspace not found: ${featureFolder}` },
        { status: 404 }
      );
    }

    const composePaths = [
      join(workspacePath, '.devcontainer/docker-compose.devcontainer.yml'),
      join(workspacePath, 'docker-compose.yml'),
      join(workspacePath, 'docker-compose.yaml'),
    ];
    let composeFile: string | null = null;
    for (const cp of composePaths) {
      if (existsSync(cp)) { composeFile = cp; break; }
    }

    if (!composeFile) {
      return jsonResponse(
        { error: 'No docker-compose file found in workspace' },
        { status: 404 }
      );
    }

    const { stdout: projectNameOut } = yield* Effect.promise(() => execAsync(
      `docker compose -f "${composeFile}" config --format json 2>/dev/null | jq -r '.name // empty'`,
      { encoding: 'utf-8' }
    ));
    const projectName = projectNameOut.trim();

    if (!projectName) {
      return jsonResponse(
        { error: 'Could not determine docker compose project name' },
        { status: 500 }
      );
    }

    const pgContainer = `${projectName}-postgres-1`;
    const apiContainer = `${projectName}-api-1`;

    console.log(`[refresh-db] Starting DB refresh for ${issueId} (project: ${projectName})`);

    try {
      yield* Effect.promise(() => execAsync(`docker stop "${apiContainer}"`, { encoding: 'utf-8', timeout: 30000 }));
    } catch {
      console.log(`[refresh-db] API container not running or already stopped`);
    }

    yield* Effect.promise(() => execAsync(
      `docker exec ${shellQuote(pgContainer)} psql -U postgres -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${sqlString(databaseName)}' AND pid <> pg_backend_pid();"`,
      { encoding: 'utf-8', timeout: 10000 }
    ));
    yield* Effect.promise(() => execAsync(
      `docker exec ${shellQuote(pgContainer)} psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS ${sqlIdentifier(databaseName)};"`,
      { encoding: 'utf-8', timeout: 10000 }
    ));
    yield* Effect.promise(() => execAsync(
      `docker exec ${shellQuote(pgContainer)} psql -U postgres -d postgres -c "CREATE DATABASE ${sqlIdentifier(databaseName)} OWNER postgres;"`,
      { encoding: 'utf-8', timeout: 10000 }
    ));

    console.log(`[refresh-db] Loading seed file: ${seedFile}`);
    yield* Effect.promise(() => execAsync(
      `docker exec -i ${shellQuote(pgContainer)} psql -U postgres -d ${shellQuote(databaseName)} < ${shellQuote(seedFile)}`,
      { encoding: 'utf-8', timeout: 600000 }
    ));

    const repairResult = yield* Effect.promise(() => repairFlywayIfNeeded(
      issueId,
      pgContainer,
      databaseName,
      projectConfig,
      workspacePath,
      (msg) => console.log(`[refresh-db] ${msg}`)
    ));
    console.log(`[refresh-db] Flyway setup: ${repairResult.message}`);

    try {
      yield* Effect.promise(() => execAsync(`docker start "${apiContainer}"`, { encoding: 'utf-8', timeout: 30000 }));
    } catch {
      console.log(`[refresh-db] Could not start API container (may need manual start)`);
    }

    let seedVerifyResult: string | undefined;
    if (dbConfig.seedVerifyQuery) {
      try {
        const { stdout } = yield* Effect.promise(() => execAsync(
          `docker exec ${shellQuote(pgContainer)} psql -U postgres -d ${shellQuote(databaseName)} -t -A -c ${shellQuote(dbConfig.seedVerifyQuery)}`,
          { encoding: 'utf-8', timeout: 10000 }
        ));
        seedVerifyResult = stdout.trim();
      } catch {}
    }

    console.log(`[refresh-db] DB refresh complete for ${issueId}`);

    return jsonResponse({
      success: true,
      message: `Database refreshed successfully`,
      seedVerifyResult,
    });
  }))
);

export const containerOpsRouteLayer = Layer.mergeAll(
  postWorkspaceContainerizeRoute,
  postWorkspaceContainerActionRoute,
  postWorkspaceMemorySummaryRoute,
  postWorkspaceRefreshDbRoute,
);

export default containerOpsRouteLayer;

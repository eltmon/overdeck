import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { emitActivityEntrySync } from '../../../../lib/activity-logger.js';
import { teardownWorkspace } from '../../../../lib/lifecycle/teardown-workspace.js';
import { extractPrefixSync, parseIssueIdSync } from '../../../../lib/issue-id.js';
import { getProjectSync, resolveProjectFromIssueSync } from '../../../../lib/projects.js';
import { DEVCONTAINER_DIRNAME } from '../../../../lib/workspace/devcontainer-renderer.js';
import { composeProjectNameForWorkspace } from '../../../../lib/workspace/rebuild-stack.js';
import { jsonResponse } from '../../http-helpers.js';
import { rejectUnauthorizedDashboardRequest, rejectUnsafeDashboardMutationRequest } from '../dashboard-auth.js';
import { httpHandler } from '../http-handler.js';
import {
  appendActivityOutput,
  completePendingOperation,
  getProjectPath,
  logActivity,
  setPendingOperation,
  updateActivity,
} from '../workspaces.js';

const execFileAsync = promisify(execFile);

type UatStackPendingOperation = 'start-stack' | 'stop-stack' | 'restart-stack' | 'reap-workspace';

const WORKSPACE_COMPOSE_FILES = [
  'docker-compose.devcontainer.yml',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
];

interface WorkspaceStackContext {
  issueId: string;
  projectPath: string;
  workspacePath: string;
  composeFile: string;
  composeProjectName: string;
  projectName?: string;
}

function findWorkspaceComposeFile(workspacePath: string): string | null {
  const devcontainerDir = join(workspacePath, DEVCONTAINER_DIRNAME);
  for (const file of WORKSPACE_COMPOSE_FILES) {
    const fullPath = join(devcontainerDir, file);
    if (existsSync(fullPath)) return fullPath;
  }
  return null;
}

function resolveWorkspaceStackContext(issueId: string): WorkspaceStackContext | { error: string; status: number } {
  const parsed = parseIssueIdSync(issueId);
  if (!parsed) return { error: 'Invalid issue ID', status: 400 };

  const normalizedIssueId = parsed.raw.toUpperCase();
  const issueLower = normalizedIssueId.toLowerCase();
  const resolvedProject = resolveProjectFromIssueSync(normalizedIssueId);
  const projectConfig = resolvedProject ? getProjectSync(resolvedProject.projectKey) : null;
  const issuePrefix = extractPrefixSync(normalizedIssueId) ?? normalizedIssueId.split('-')[0];
  const projectPath = resolvedProject?.projectPath ?? getProjectPath(undefined, issuePrefix);
  const workspacePath = join(
    projectPath,
    projectConfig?.workspace?.workspaces_dir ?? 'workspaces',
    `feature-${issueLower}`,
  );

  if (!existsSync(workspacePath)) {
    return { error: `Workspace not found for ${normalizedIssueId}`, status: 404 };
  }

  const composeFile = findWorkspaceComposeFile(workspacePath);
  if (!composeFile) {
    return { error: `No workspace compose file found for ${normalizedIssueId}`, status: 404 };
  }

  try {
    return {
      issueId: normalizedIssueId,
      projectPath,
      workspacePath,
      composeFile,
      composeProjectName: composeProjectNameForWorkspace(workspacePath, normalizedIssueId),
      projectName: projectConfig?.name,
    };
  } catch (err: unknown) {
    return {
      error: err instanceof Error ? err.message : String(err),
      status: 409,
    };
  }
}

function spawnCommandActivity(
  command: string,
  args: string[],
  description: string,
  cwd: string,
  options: { issueId: string; pendingOperation: UatStackPendingOperation },
): string {
  const activityId = Date.now().toString();
  setPendingOperation(options.issueId, options.pendingOperation);
  emitActivityEntrySync({
    source: 'dashboard',
    level: 'info',
    issueId: options.issueId.toUpperCase(),
    message: `${description} started`,
  });
  logActivity({
    id: activityId,
    timestamp: new Date().toISOString(),
    command: [command, ...args].join(' '),
    status: 'running',
    output: [],
  });

  const child = spawn(command, args, {
    cwd,
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
    const ok = code === 0;
    updateActivity(activityId, { status: ok ? 'completed' : 'failed' });
    completePendingOperation(options.issueId, ok ? null : `${command} exited ${code ?? 'unknown'}`);
    emitActivityEntrySync({
      source: 'dashboard',
      level: ok ? 'success' : 'error',
      issueId: options.issueId.toUpperCase(),
      message: `${description} ${ok ? 'completed' : 'failed'}`,
    });
  });

  return activityId;
}

function spawnEffectActivity(
  description: string,
  issueId: string,
  pendingOperation: UatStackPendingOperation,
  run: (activityId: string) => Promise<void>,
): string {
  const activityId = Date.now().toString();
  setPendingOperation(issueId, pendingOperation);
  emitActivityEntrySync({
    source: 'dashboard',
    level: 'info',
    issueId: issueId.toUpperCase(),
    message: `${description} started`,
  });
  logActivity({
    id: activityId,
    timestamp: new Date().toISOString(),
    command: description,
    status: 'running',
    output: [],
  });

  void run(activityId)
    .then(() => {
      updateActivity(activityId, { status: 'completed' });
      completePendingOperation(issueId, null);
      emitActivityEntrySync({
        source: 'dashboard',
        level: 'success',
        issueId: issueId.toUpperCase(),
        message: `${description} completed`,
      });
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      appendActivityOutput(activityId, message);
      updateActivity(activityId, { status: 'failed' });
      completePendingOperation(issueId, message);
      emitActivityEntrySync({
        source: 'dashboard',
        level: 'error',
        issueId: issueId.toUpperCase(),
        message: `${description} failed`,
      });
    });

  return activityId;
}

const postWorkspaceStackActionRoute = HttpRouter.add(
  'POST',
  '/api/workspaces/:issueId/stack/:action',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;

    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const action = params['action'] ?? '';
    if (action !== 'start' && action !== 'stop' && action !== 'restart') {
      return jsonResponse({ error: 'Invalid stack action' }, { status: 400 });
    }

    const context = resolveWorkspaceStackContext(issueId);
    if ('error' in context) {
      return jsonResponse({ error: context.error }, { status: context.status });
    }

    const pendingOperation = action === 'start'
      ? 'start-stack'
      : action === 'stop'
        ? 'stop-stack'
        : 'restart-stack';
    const description = `${action[0].toUpperCase()}${action.slice(1)} stack for ${context.issueId}`;
    const activityId = spawnCommandActivity(
      'docker',
      ['compose', '-f', context.composeFile, '-p', context.composeProjectName, action],
      description,
      dirname(context.composeFile),
      { issueId: context.issueId, pendingOperation },
    );

    return jsonResponse({
      success: true,
      message: `${description} started`,
      activityId,
    });
  })),
);

const getWorkspaceStackLogsRoute = HttpRouter.add(
  'GET',
  '/api/workspaces/:issueId/stack-logs',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(request);
    if (authError) return authError;

    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const context = resolveWorkspaceStackContext(issueId);
    if ('error' in context) {
      return jsonResponse({ error: context.error }, { status: context.status });
    }

    const { stdout } = yield* Effect.promise(() => execFileAsync('docker', [
      'ps',
      '-a',
      '--filter',
      `label=com.docker.compose.project=${context.composeProjectName}`,
      '--format',
      '{{.Names}}',
    ], { encoding: 'utf-8', timeout: 10_000 }));
    const names = stdout.split('\n').map(line => line.trim()).filter(Boolean);
    const chunks: string[] = [];
    for (const name of names) {
      try {
        const { stdout: logs, stderr } = yield* Effect.promise(() => execFileAsync('docker', [
          'logs',
          '--tail',
          '200',
          '--timestamps',
          name,
        ], { encoding: 'utf-8', timeout: 10_000, maxBuffer: 2 * 1024 * 1024 }));
        chunks.push(`--- ${name} ---\n${logs}${stderr ? `\n${stderr}` : ''}`.trimEnd());
      } catch (err: unknown) {
        chunks.push(`--- ${name} ---\n${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return jsonResponse({
      success: true,
      issueId: context.issueId,
      stackName: context.composeProjectName,
      logs: chunks.join('\n\n'),
    });
  })),
);

const getWorkspaceStateDirRoute = HttpRouter.add(
  'GET',
  '/api/workspaces/:issueId/state-dir',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(request);
    if (authError) return authError;

    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const context = resolveWorkspaceStackContext(issueId);
    if ('error' in context) {
      return jsonResponse({ error: context.error }, { status: context.status });
    }
    return jsonResponse({
      success: true,
      issueId: context.issueId,
      path: context.workspacePath,
      stackName: context.composeProjectName,
    });
  })),
);

const postWorkspaceReapRoute = HttpRouter.add(
  'POST',
  '/api/workspaces/:issueId/reap',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;

    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const context = resolveWorkspaceStackContext(issueId);
    if ('error' in context) {
      return jsonResponse({ error: context.error }, { status: context.status });
    }

    const activityId = spawnEffectActivity(
      `Reap workspace for ${context.issueId}`,
      context.issueId,
      'reap-workspace',
      async (id) => {
        const steps = await Effect.runPromise(teardownWorkspace({
          issueId: context.issueId,
          projectPath: context.projectPath,
          projectName: context.projectName,
        }, {
          deleteBranches: false,
          clearBeads: false,
        }));
        for (const step of steps) {
          const detail = step.details?.length ? `: ${step.details.join('; ')}` : '';
          appendActivityOutput(id, `${step.success ? '✓' : step.skipped ? '-' : '✗'} ${step.step}${detail}${step.error ? ` (${step.error})` : ''}`);
        }
        const failed = steps.find(step => !step.success && !step.skipped);
        if (failed) {
          throw new Error(failed.error ?? `${failed.step} failed`);
        }
      },
    );

    return jsonResponse({
      success: true,
      message: `Reaping workspace for ${context.issueId}`,
      activityId,
    });
  })),
);

export const uatStackActionRouteLayer = Layer.mergeAll(
  postWorkspaceStackActionRoute,
  getWorkspaceStackLogsRoute,
  getWorkspaceStateDirRoute,
  postWorkspaceReapRoute,
);

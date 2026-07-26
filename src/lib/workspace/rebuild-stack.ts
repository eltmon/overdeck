/**
 * Workspace docker-stack rebuild — the library primitive behind
 * `pan workspace rebuild` and the deacon's orphan-test self-heal.
 *
 * Tears the stack down (`docker compose down -v --remove-orphans`), re-renders
 * `<workspace>/.devcontainer/` from the project compose template, and brings
 * the stack back up (`docker compose up -d --build`).
 *
 * This module is host/CLI-safe: it never calls `process.exit` and never writes
 * to a terminal. The CLI command wraps it for spinner/exit handling; the deacon
 * calls it directly during patrol recovery.
 *
 * PAN-1249: migrated to Effect. External entry point `rebuildWorkspaceStack`
 * returns `Effect.Effect<RebuildWorkspaceStackResult>` (errors are encoded in
 * the result, not the error channel, to preserve the existing API contract
 * where callers branch on `success`).
 */

import { execFile } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { Effect } from 'effect';

import { recordDockerContainerLifecycleSnapshot } from '../docker-stats.js';
import { getProjectSync, resolveProjectFromIssueSync } from '../projects.js';
import { isIssueClosed } from '../cloister/issue-closed.js';
import { ensureDevcontainerSync } from './ensure-devcontainer.js';
import {
  collectDockerContainerLifecycleSnapshot,
  composeProjectNameForWorkspace,
  hasIssueToken,
} from './stack-health.js';
import { reconcileTraefikNetworks } from './traefik-connect.js';

// Canonical home is stack-health.ts (health checks need it too); re-export so
// existing consumers of this module keep working.
export { composeProjectNameForWorkspace } from './stack-health.js';

const execFileAsync = promisify(execFile);

const COMPOSE_FILES = [
  'docker-compose.devcontainer.yml',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
];

function findDevcontainerComposeFile(workspacePath: string): string | null {
  const devcontainerDir = join(workspacePath, '.devcontainer');
  for (const file of COMPOSE_FILES) {
    const fullPath = join(devcontainerDir, file);
    if (existsSync(fullPath)) return fullPath;
  }
  return null;
}

const dockerCompose = (args: string[], cwd: string): Effect.Effect<void, Error> =>
  Effect.tryPromise({
    try: () =>
      execFileAsync('docker', ['compose', ...args], {
        cwd,
        encoding: 'utf-8',
        timeout: 300_000,
        maxBuffer: 10 * 1024 * 1024,
      }).then(() => undefined),
    catch: (err) => (err instanceof Error ? err : new Error(String(err))),
  });

/**
 * PAN-1618: the workspace compose declares an external bridge network (`overdeck`)
 * so workspace containers share a network with the host stack. It is created by
 * `pan install`, but a host installed under the old `panopticon` name — or any
 * host whose install pre-dated the Panopticon→Overdeck network rename — won't have
 * it, and `docker compose up` then fails with "network overdeck declared as
 * external, but could not be found", silently blocking work-agent (auto-)start.
 * Ensure it idempotently right before bringing the stack up. `docker network
 * create` errors when the network already exists (the common case) — swallow that.
 */
const EXTERNAL_WORKSPACE_NETWORK = 'overdeck';

const ensureExternalNetwork = (): Effect.Effect<void> =>
  Effect.promise(() =>
    execFileAsync('docker', ['network', 'create', EXTERNAL_WORKSPACE_NETWORK], { timeout: 30_000 })
      .then(() => undefined)
      .catch(() => undefined),
  );

export interface RebuildWorkspaceStackOptions {
  /** Progress callback for each rebuild phase. Optional. */
  onProgress?: (message: string) => void;
}

/**
 * Remove same-issue containers that do NOT belong to the canonical compose
 * project — corpses left behind by a previous project naming (e.g.
 * overdeck-feature-min-865-* next to a live myn-feature-min-865 stack). They
 * poison token-based health matching and can hold port bindings. Never touches
 * a running container: a live foreign stack is left for a human.
 */
export const removeStaleIssueContainers = (
  issueId: string,
  composeProjectName: string,
): Effect.Effect<number> =>
  Effect.promise(async () => {
    const containers = await Effect.runPromise(collectDockerContainerLifecycleSnapshot());
    let removed = 0;
    for (const container of containers) {
      if (container.composeProject === composeProjectName) continue;
      if (!hasIssueToken(container.name, issueId)) continue;
      const running = container.state?.toLowerCase() === 'running' || /^up\b/i.test(container.status);
      if (running) continue;
      const removedOk = await execFileAsync('docker', ['rm', '-f', container.id], { timeout: 30_000 })
        .then(() => true)
        .catch(() => false);
      if (removedOk) removed += 1;
    }
    return removed;
  });

export interface RebuildWorkspaceStackResult {
  success: boolean;
  error?: string;
  workspacePath?: string;
  composeFile?: string;
  composeProjectName?: string;
}

/**
 * Tear down, re-render, and restart a single workspace docker stack.
 *
 * Returns a result object instead of throwing/exiting so server-side callers
 * (the deacon) can branch on `success`. The Effect itself never fails — any
 * error is captured into `result.error`.
 */
export const rebuildWorkspaceStack = (
  issueId: string,
  options: RebuildWorkspaceStackOptions = {},
): Effect.Effect<RebuildWorkspaceStackResult> => {
  const progress = options.onProgress ?? (() => {});
  const normalizedIssueId = issueId.toLowerCase();

  const resolvedProject = resolveProjectFromIssueSync(issueId);
  const projectConfig = resolvedProject ? getProjectSync(resolvedProject.projectKey) : null;
  if (!resolvedProject || !projectConfig) {
    return Effect.succeed({ success: false, error: `No project found for issue ${issueId}` });
  }
  if (!projectConfig.workspace?.docker?.compose_template) {
    return Effect.succeed({
      success: false,
      error: `Project ${projectConfig.name} has no workspace docker compose_template configured`,
    });
  }

  const workspacePath = join(
    resolvedProject.projectPath,
    projectConfig.workspace?.workspaces_dir ?? 'workspaces',
    `feature-${normalizedIssueId}`,
  );
  if (!existsSync(workspacePath)) {
    return Effect.succeed({ success: false, error: `Workspace not found: ${workspacePath}` });
  }

  return Effect.gen(function* () {
    const closed = yield* Effect.promise(() => isIssueClosed(issueId));
    const reviewStatus = closed
      ? null
      : yield* Effect.promise(async () => {
          const { resolveCanonicalReviewStatus } = await import('../cloister/review-status-source.js');
          return resolveCanonicalReviewStatus(issueId);
        });
    if (closed || reviewStatus?.status?.mergeStatus === 'merged') {
      return {
        success: false,
        error: 'Issue is terminal (closed/merged) — skipping stack rebuild',
      } satisfies RebuildWorkspaceStackResult;
    }
    if (!reviewStatus?.available) {
      return {
        success: false,
        error: 'Issue terminal status is unavailable — skipping stack rebuild',
      } satisfies RebuildWorkspaceStackResult;
    }

    const composeProjectName = composeProjectNameForWorkspace(workspacePath, normalizedIssueId);

    const existingComposeFile = findDevcontainerComposeFile(workspacePath);
    if (existingComposeFile) {
      progress('Tearing down existing workspace stack...');
      yield* dockerCompose(
        ['-f', existingComposeFile, '-p', composeProjectName, 'down', '-v', '--remove-orphans'],
        dirname(existingComposeFile),
      );
    }

    progress('Re-rendering .devcontainer/ from template...');
    const devcontainerDir = join(workspacePath, '.devcontainer');
    if (existsSync(devcontainerDir)) {
      rmSync(devcontainerDir, { recursive: true, force: true });
    }
    const ensured = ensureDevcontainerSync({ workspacePath, issueId: normalizedIssueId });
    if (!ensured.step.success) {
      return {
        success: false,
        error: ensured.step.error ?? 'Failed to render .devcontainer/',
        workspacePath,
      } satisfies RebuildWorkspaceStackResult;
    }

    const composeFile = findDevcontainerComposeFile(workspacePath);
    if (!composeFile) {
      return {
        success: false,
        error: `No devcontainer compose file found in ${devcontainerDir}`,
        workspacePath,
      } satisfies RebuildWorkspaceStackResult;
    }

    progress('Ensuring shared docker network...');
    yield* ensureExternalNetwork();
    progress('Starting workspace stack...');
    yield* dockerCompose(
      ['-f', composeFile, '-p', composeProjectName, 'up', '-d', '--build'],
      dirname(composeFile),
    );
    const containers = yield* collectDockerContainerLifecycleSnapshot();
    recordDockerContainerLifecycleSnapshot(containers);

    // Sweep corpses from any previous project naming for this issue so
    // token-based health checks and future rebuilds see only the fresh stack.
    progress('Removing stale containers from previous stack projects...');
    yield* removeStaleIssueContainers(normalizedIssueId, composeProjectName);

    // PAN-2428: without this, routes to the fresh stack 504 until traefik is
    // manually connected to the stack's network.
    progress('Connecting traefik to workspace network...');
    yield* Effect.promise(() => reconcileTraefikNetworks());

    return { success: true, workspacePath, composeFile, composeProjectName } satisfies RebuildWorkspaceStackResult;
  }).pipe(
    Effect.catch((error: unknown) => {
      const message = error instanceof Error && error.message ? error.message : String(error);
      return Effect.succeed<RebuildWorkspaceStackResult>({ success: false, error: message, workspacePath });
    }),
  );
};

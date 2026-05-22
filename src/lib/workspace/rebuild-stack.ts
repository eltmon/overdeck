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
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { Effect } from 'effect';

import { getProjectSync, resolveProjectFromIssueSync } from '../projects.js';
import { ensureDevcontainerSync } from './ensure-devcontainer.js';

const execFileAsync = promisify(execFile);

const COMPOSE_FILES = [
  'docker-compose.devcontainer.yml',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
];

function declaredComposeProjectName(content: string, featureFolder: string): string | null {
  const templatedMatch = content.match(/COMPOSE_PROJECT_NAME="([^$"]*)\$\{FEATURE_FOLDER\}"/);
  if (templatedMatch) return `${templatedMatch[1]}${featureFolder}`;
  const literalMatch = content.match(/COMPOSE_PROJECT_NAME="([^"]+)"/);
  return literalMatch?.[1] ?? null;
}

/**
 * Derive the canonical `COMPOSE_PROJECT_NAME` for a workspace, refusing the
 * rebuild if the workspace declares a name that does not match — a mismatch
 * means `docker compose down` would target the wrong stack.
 */
export function composeProjectNameForWorkspace(workspacePath: string, issueId: string): string {
  const featureFolder = `feature-${issueId.toLowerCase()}`;
  const expected = `panopticon-${featureFolder}`;
  for (const devPath of [join(workspacePath, '.devcontainer', 'dev'), join(workspacePath, 'dev')]) {
    if (!existsSync(devPath)) continue;
    try {
      const declared = declaredComposeProjectName(readFileSync(devPath, 'utf-8'), featureFolder);
      if (declared && declared !== expected) {
        throw new Error(
          `Refusing workspace rebuild: ${devPath} declares COMPOSE_PROJECT_NAME=${declared}, expected ${expected}`,
        );
      }
    } catch (err: any) {
      if (err?.message?.startsWith('Refusing workspace rebuild:')) throw err;
    }
  }
  return expected;
}

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

export interface RebuildWorkspaceStackOptions {
  /** Progress callback for each rebuild phase. Optional. */
  onProgress?: (message: string) => void;
}

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

    progress('Starting workspace stack...');
    yield* dockerCompose(
      ['-f', composeFile, '-p', composeProjectName, 'up', '-d', '--build'],
      dirname(composeFile),
    );

    return { success: true, workspacePath, composeFile, composeProjectName } satisfies RebuildWorkspaceStackResult;
  }).pipe(
    Effect.catch((error: unknown) => {
      const message = error instanceof Error && error.message ? error.message : String(error);
      return Effect.succeed<RebuildWorkspaceStackResult>({ success: false, error: message, workspacePath });
    }),
  );
};

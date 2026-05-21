/**
 * WorkspaceService Effect service (PAN-449)
 *
 * Wraps workspace-manager.ts in an Effect service with typed errors.
 * Route handlers and AgentSpawner use this instead of calling workspace-manager directly.
 */

import { existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { Effect, Layer, Context } from 'effect';

const execAsync = promisify(exec);
import { resolveProjectFromIssue } from '../../../lib/projects.js';
import { WorkspaceNotFound, WorkspaceCreateError } from './typed-errors.js';

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface WorkspaceInfo {
  readonly issueId: string;
  readonly path: string;
  readonly exists: boolean;
  readonly branch: string;
}

export interface CleanResult {
  /** Artifacts that were (or would be) deleted */
  readonly artifacts: string[];
  /** Whether this was a preview (no deletions performed) */
  readonly preview: boolean;
}

// ─── Service interface ────────────────────────────────────────────────────────

export interface WorkspaceServiceShape {
  /**
   * Resolve the filesystem path for an issue's workspace.
   * Does NOT require the workspace to exist.
   */
  readonly resolve: (issueId: string) => Effect.Effect<WorkspaceInfo, never>;

  /**
   * Create a git worktree workspace for an issue.
   * Idempotent: returns the workspace path without error if workspace already exists.
   * Returns the workspace path on success.
   */
  readonly create: (issueId: string) => Effect.Effect<string, WorkspaceCreateError>;

  /**
   * Remove a workspace directory and git worktree.
   * Fails with WorkspaceNotFound if the workspace does not exist.
   */
  readonly remove: (issueId: string) => Effect.Effect<void, WorkspaceNotFound | WorkspaceCreateError>;

  /**
   * Stop Docker containers associated with a workspace.
   * Non-fatal: errors are logged but do not fail the effect.
   */
  readonly stopDocker: (issueId: string) => Effect.Effect<void, never>;

  /**
   * Clean build artifacts from a workspace.
   * preview=true returns a list of artifact paths without deleting.
   * preview=false removes artifacts but preserves orchestration metadata directories.
   * Fails with WorkspaceNotFound if the workspace does not exist.
   */
  readonly clean: (issueId: string, preview?: boolean) => Effect.Effect<CleanResult, WorkspaceNotFound | WorkspaceCreateError>;

  /**
   * Containerize a workspace: create docker-compose.yml from project template
   * and start Docker containers.
   * Fails with WorkspaceNotFound if the workspace does not exist.
   */
  readonly containerize: (issueId: string) => Effect.Effect<void, WorkspaceNotFound | WorkspaceCreateError>;
}

// ─── Service tag ──────────────────────────────────────────────────────────────

export class WorkspaceService extends Context.Service<
  WorkspaceService,
  WorkspaceServiceShape
>()('panopticon/dashboard/WorkspaceService') {}

// ─── Live layer ───────────────────────────────────────────────────────────────

export const WorkspaceServiceLive = Layer.effect(
  WorkspaceService,
  Effect.sync(() => {
    function getWorkspacePath(issueId: string): { projectPath: string; workspacePath: string; branch: string } {
      const issueLower = issueId.toLowerCase();
      const project = resolveProjectFromIssue(issueId);
      const projectPath = project?.projectPath ?? process.cwd();
      const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
      const branch = `feature/${issueLower}`;
      return { projectPath, workspacePath, branch };
    }

    return {
      resolve: (issueId) =>
        Effect.sync(() => {
          const { workspacePath, branch } = getWorkspacePath(issueId);
          return {
            issueId,
            path: workspacePath,
            exists: existsSync(workspacePath),
            branch,
          };
        }),

      create: (issueId) =>
        Effect.tryPromise({
          try: async () => {
            const { workspacePath, branch } = getWorkspacePath(issueId);
            const issueLower = issueId.toLowerCase();

            // Idempotent: if workspace already exists, return the path without error
            if (existsSync(workspacePath)) {
              return workspacePath;
            }

            const { createWorkspace } = await import('../../../lib/workspace-manager.js');
            const { loadProjectsConfig } = await import('../../../lib/projects.js');

            const { projects } = loadProjectsConfig();
            const project = resolveProjectFromIssue(issueId);
            if (!project) {
              throw new WorkspaceCreateError({
                id: issueId,
                message: `No project configured for issue ${issueId}`,
              });
            }

            const projectName = Object.entries(projects).find(
              ([, p]) => p.path === project.projectPath,
            )?.[0] ?? project.projectName;

            const result = await createWorkspace({
              projectConfig: { name: projectName, path: project.projectPath },
              featureName: issueLower,
            });

            if (!result.success) {
              throw new WorkspaceCreateError({
                id: issueId,
                message: result.errors.join('; '),
              });
            }

            return workspacePath;
          },
          catch: (err) => {
            if (err instanceof WorkspaceCreateError) return err;
            return new WorkspaceCreateError({
              id: issueId,
              message: err instanceof Error ? err.message : String(err),
              cause: err,
            });
          },
        }),

      remove: (issueId) =>
        Effect.tryPromise({
          try: async () => {
            const { workspacePath } = getWorkspacePath(issueId);
            const issueLower = issueId.toLowerCase();

            if (!existsSync(workspacePath)) {
              throw new WorkspaceNotFound({ id: issueId });
            }

            const { removeWorkspace } = await import('../../../lib/workspace-manager.js');
            const project = resolveProjectFromIssue(issueId);
            if (!project) {
              throw new WorkspaceCreateError({ id: issueId, message: 'No project found' });
            }

            const result = await removeWorkspace({
              projectConfig: { name: project.projectName, path: project.projectPath },
              featureName: issueLower,
            });

            if (!result.success) {
              throw new WorkspaceCreateError({
                id: issueId,
                message: result.errors.join('; '),
              });
            }
          },
          catch: (err) => {
            if (err instanceof WorkspaceNotFound || err instanceof WorkspaceCreateError) return err;
            return new WorkspaceCreateError({
              id: issueId,
              message: err instanceof Error ? err.message : String(err),
              cause: err,
            });
          },
        }),

      stopDocker: (issueId) =>
        Effect.tryPromise({
          try: async () => {
            const { workspacePath } = getWorkspacePath(issueId);
            const issueLower = issueId.toLowerCase();
            const { stopWorkspaceDocker } = await import('../../../lib/workspace-manager.js');
            await stopWorkspaceDocker(workspacePath, issueLower);
          },
          catch: () => undefined, // non-fatal
        }).pipe(Effect.ignore),

      clean: (issueId, preview = false) =>
        Effect.tryPromise({
          try: async () => {
            const { workspacePath } = getWorkspacePath(issueId);

            if (!existsSync(workspacePath)) {
              throw new WorkspaceNotFound({ id: issueId });
            }

            // Artifact directories/files to clean (preserving orchestration metadata)
            const artifactPatterns = [
              'node_modules',
              'dist',
              'build',
              '.next',
              '.vite',
              '.turbo',
              'coverage',
              '.nyc_output',
              '*.log',
            ];

            const { promises: fsp } = await import('node:fs');
            const { join: pathJoin } = await import('node:path');

            const found: string[] = [];

            for (const pattern of artifactPatterns) {
              if (pattern.includes('*')) {
                // Glob-style: list directory entries matching the pattern
                try {
                  const entries = await fsp.readdir(workspacePath);
                  const prefix = pattern.replace('*', '');
                  for (const entry of entries) {
                    if (entry.endsWith(prefix.replace('*', '')) || entry.startsWith(prefix)) {
                      const candidate = pathJoin(workspacePath, entry);
                      try {
                        const stat = await fsp.stat(candidate);
                        if (stat.isFile()) found.push(candidate);
                      } catch { /* skip */ }
                    }
                  }
                } catch { /* skip */ }
              } else {
                const candidate = pathJoin(workspacePath, pattern);
                if (existsSync(candidate)) {
                  found.push(candidate);
                }
              }
            }

            if (!preview) {
              for (const artifact of found) {
                try {
                  await fsp.rm(artifact, { recursive: true, force: true });
                } catch { /* non-fatal: skip undeletable artifacts */ }
              }
            }

            return { artifacts: found, preview };
          },
          catch: (err) => {
            if (err instanceof WorkspaceNotFound || err instanceof WorkspaceCreateError) return err;
            return new WorkspaceCreateError({
              id: issueId,
              message: err instanceof Error ? err.message : String(err),
              cause: err,
            });
          },
        }),

      containerize: (issueId) =>
        Effect.tryPromise({
          try: async () => {
            const { workspacePath } = getWorkspacePath(issueId);
            const issueLower = issueId.toLowerCase();

            if (!existsSync(workspacePath)) {
              throw new WorkspaceNotFound({ id: issueId });
            }


            // Look for existing compose files
            const composePaths = [
              join(workspacePath, 'docker-compose.yml'),
              join(workspacePath, 'docker-compose.yaml'),
              join(workspacePath, '.devcontainer', 'docker-compose.yml'),
              join(workspacePath, '.devcontainer', 'docker-compose.devcontainer.yml'),
            ];

            const composePath = composePaths.find((p) => existsSync(p));

            if (!composePath) {
              // No compose file → self-heal `.devcontainer/` from the project
              // template. This is the cheap, idempotent path; the previous
              // implementation re-ran the full workspace-create flow (worktrees,
              // bun install, etc.), which is the wrong granularity for
              // "compose file is missing".
              const { ensureDevcontainer } = await import(
                '../../../lib/workspace/ensure-devcontainer.js'
              );
              const ensure = ensureDevcontainer({ workspacePath, issueId });
              if (!ensure.step.success) {
                throw new WorkspaceCreateError({
                  id: issueId,
                  message:
                    `Could not render .devcontainer/: ${ensure.step.error ?? 'unknown error'}`,
                });
              }
            }

            // Start containers
            const finalComposePath = composePaths.find((p) => existsSync(p));
            if (finalComposePath) {
              await execAsync(
                `docker compose -f "${finalComposePath}" up -d --build`,
                { cwd: dirname(finalComposePath), timeout: 300000 },
              );
            }
          },
          catch: (err) => {
            if (err instanceof WorkspaceNotFound || err instanceof WorkspaceCreateError) return err;
            return new WorkspaceCreateError({
              id: issueId,
              message: err instanceof Error ? err.message : String(err),
              cause: err,
            });
          },
        }),
    };
  }),
);

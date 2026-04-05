/**
 * WorkspaceService Effect service (PAN-449)
 *
 * Wraps workspace-manager.ts in an Effect service with typed errors.
 * Route handlers and AgentSpawner use this instead of calling workspace-manager directly.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Layer, ServiceMap } from 'effect';
import { resolveProjectFromIssue } from '../../../lib/projects.js';
import { WorkspaceNotFound, WorkspaceCreateError } from './typed-errors.js';

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface WorkspaceInfo {
  readonly issueId: string;
  readonly path: string;
  readonly exists: boolean;
  readonly branch: string;
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
}

// ─── Service tag ──────────────────────────────────────────────────────────────

export class WorkspaceService extends ServiceMap.Service<
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
      const projectPath = project?.path ?? process.cwd();
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
            const { projectPath, workspacePath, branch } = getWorkspacePath(issueId);
            const issueLower = issueId.toLowerCase();

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
              ([, p]) => p.path === project.path,
            )?.[0] ?? 'unknown';

            const result = await createWorkspace({
              projectConfig: { ...project, name: projectName },
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
              projectConfig: { ...project, name: issueId },
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
            const project = resolveProjectFromIssue(issueId);
            const projectName = project?.name ?? issueId;

            const { stopWorkspaceDocker } = await import('../../../lib/workspace-manager.js');
            await stopWorkspaceDocker(workspacePath, projectName, issueLower);
          },
          catch: () => undefined, // non-fatal
        }).pipe(Effect.ignore),
    };
  }),
);

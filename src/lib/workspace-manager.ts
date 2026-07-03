/**
 * Workspace Manager
 *
 * Handles workspace creation and removal for both monorepo and polyrepo projects.
 */

import { Effect } from 'effect';
import { FsError, ProcessSpawnError } from './errors.js';
import { copyOverdeckSettingsToWorkspaceSync, ensurePanGitignoreSync, migrateOverdeckToPanSync } from './workspace-manager/migration.js';
import { createWorkspacePromise } from './workspace-manager/create.js';
import { addReposToWorkspacePromise } from './workspace-manager/repos.js';
import { getContainersReferencingWorkspacePathPromise, stopWorkspaceDockerPromise } from './workspace-manager/docker.js';
import { removeWorkspacePromise } from './workspace-manager/remove.js';
import {
  preTrustDirectorySync,
  relocateVenvScripts,
} from './workspace-manager/worktree-ops.js';
import type {
  AddReposToWorkspaceOptions,
  AddReposToWorkspaceResult,
  DockerCleanupResult,
  PanMigrationResult,
  WorkspaceCreateOptions,
  WorkspaceCreateResult,
  WorkspaceProgress,
  WorkspaceRemoveOptions,
  WorkspaceRemoveResult,
} from './workspace-manager/types.js';
export type {
  AddReposToWorkspaceOptions,
  AddReposToWorkspaceResult,
  DockerCleanupResult,
  PanMigrationResult,
  WorkspaceCreateOptions,
  WorkspaceCreateResult,
  WorkspaceProgress,
  WorkspaceRemoveOptions,
  WorkspaceRemoveResult,
} from './workspace-manager/types.js';
export { copyOverdeckSettingsToWorkspaceSync, ensurePanGitignoreSync, migrateOverdeckToPanSync } from './workspace-manager/migration.js';
export { preTrustDirectorySync, relocateVenvScripts } from './workspace-manager/worktree-ops.js';

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
//
// workspace-manager.ts is a multi-thousand-line orchestration surface. Per the
// migration plan we prioritise *additive* Effect wrappers over the
// public-facing entry points; the file's many internal helpers stay as-is
// because they're called from within the wrapped functions.

const toWmFsError = (op: string, path: string, cause: unknown): FsError =>
  new FsError({ path, operation: op, cause });

const toWmProcessError = (op: string, cause: unknown): ProcessSpawnError =>
  new ProcessSpawnError({
    command: 'workspace-manager',
    args: [op],
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });

/** Migrate any pre-PAN-967 .overdeck/* subdirs to the .pan/ layout. */
export const migrateOverdeckToPan = (
  projectPath: string,
): Effect.Effect<PanMigrationResult, FsError> =>
  Effect.try({
    try: () => migrateOverdeckToPanSync(projectPath),
    catch: (cause) => toWmFsError('migrateOverdeckToPan', projectPath, cause),
  });

/** Mirror ~/.claude settings/agents into the workspace's .claude/ dir. */
export const copyOverdeckSettingsToWorkspace = (
  workspacePath: string,
): Effect.Effect<{ copied: string[]; errors: string[] }, FsError> =>
  Effect.try({
    try: () => copyOverdeckSettingsToWorkspaceSync(workspacePath),
    catch: (cause) =>
      toWmFsError('copyOverdeckSettingsToWorkspace', workspacePath, cause),
  });

/** Ensure the project gitignore covers `.pan/continue.json` (PAN-1124). */
export const ensurePanGitignore = (
  projectPath: string,
): Effect.Effect<void, FsError> =>
  Effect.try({
    try: () => ensurePanGitignoreSync(projectPath),
    catch: (cause) => toWmFsError('ensurePanGitignore', projectPath, cause),
  });

/** Create a new workspace (git worktree + scaffolding). */
export const createWorkspace = (
  options: WorkspaceCreateOptions,
): Effect.Effect<WorkspaceCreateResult, ProcessSpawnError> =>
  Effect.tryPromise({
    try: () => createWorkspacePromise(options),
    catch: (cause) => toWmProcessError('createWorkspace', cause),
  });

/** Mark a directory as pre-trusted for Claude Code (idempotent). */
export const preTrustDirectory = (
  dirPath: string,
): Effect.Effect<void, FsError> =>
  Effect.try({
    try: () => preTrustDirectorySync(dirPath),
    catch: (cause) => toWmFsError('preTrustDirectory', dirPath, cause),
  });

/** Add additional repos (worktrees / symlinks) to an existing workspace. */
export const addReposToWorkspace = (
  options: AddReposToWorkspaceOptions,
): Effect.Effect<AddReposToWorkspaceResult, ProcessSpawnError> =>
  Effect.tryPromise({
    try: () => addReposToWorkspacePromise(options),
    catch: (cause) => toWmProcessError('addReposToWorkspace', cause),
  });

/** Enumerate Docker containers whose compose files live under a workspace. */
export const getContainersReferencingWorkspacePath = (
  ...args: Parameters<typeof getContainersReferencingWorkspacePathPromise>
): Effect.Effect<Awaited<ReturnType<typeof getContainersReferencingWorkspacePathPromise>>, ProcessSpawnError> =>
  Effect.tryPromise({
    try: () => getContainersReferencingWorkspacePathPromise(...args),
    catch: (cause) =>
      toWmProcessError('getContainersReferencingWorkspacePath', cause),
  });

/** Stop every Docker resource associated with the supplied workspace. */
export const stopWorkspaceDocker = (
  ...args: Parameters<typeof stopWorkspaceDockerPromise>
): Effect.Effect<DockerCleanupResult, ProcessSpawnError> =>
  Effect.tryPromise({
    try: () => stopWorkspaceDockerPromise(...args),
    catch: (cause) => toWmProcessError('stopWorkspaceDocker', cause),
  });

/** Remove a workspace (worktrees, branches, Docker, DNS, tunnel ingress). */
export const removeWorkspace = (
  options: WorkspaceRemoveOptions,
): Effect.Effect<WorkspaceRemoveResult, ProcessSpawnError> =>
  Effect.tryPromise({
    try: () => removeWorkspacePromise(options),
    catch: (cause) => toWmProcessError('removeWorkspace', cause),
  });

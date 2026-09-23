/**
 * Workspace Manager
 *
 * Handles workspace creation and removal for both monorepo and polyrepo projects.
 */

import { Effect } from 'effect';
import { FsError } from './errors.js';
import {
  preTrustDirectorySync,
} from './workspace-manager/worktree-ops.js';
export type {
  AddNewRepoToWorkspaceOptions,
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
export { installPreRebaseHook, preTrustDirectorySync, relocateVenvScripts } from './workspace-manager/worktree-ops.js';
export { createWorkspace } from './workspace-manager/create.js';
export { addNewRepoToWorkspace, addReposToWorkspace } from './workspace-manager/repos.js';
export { getContainersReferencingWorkspacePath, stopWorkspaceDocker } from './workspace-manager/docker.js';
export { removeWorkspace } from './workspace-manager/remove.js';

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
//
// The workspace entry points above are plain async functions (PAN-3958 CH-3).
// `preTrustDirectory` is a sync wrapper that stays until CH-6 settles the
// live Shape B wrappers.

const toWmFsError = (op: string, path: string, cause: unknown): FsError =>
  new FsError({ path, operation: op, cause });

/** Mark a directory as pre-trusted for Claude Code (idempotent). */
export const preTrustDirectory = (
  dirPath: string,
): Effect.Effect<void, FsError> =>
  Effect.try({
    try: () => preTrustDirectorySync(dirPath),
    catch: (cause) => toWmFsError('preTrustDirectory', dirPath, cause),
  });

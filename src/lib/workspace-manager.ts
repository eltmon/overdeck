/**
 * Workspace Manager
 *
 * Handles workspace creation and removal for both monorepo and polyrepo projects.
 */

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


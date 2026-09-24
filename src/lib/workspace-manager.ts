/**
 * Workspace Manager
 *
 * Handles workspace creation and removal for both monorepo and polyrepo projects.
 */

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
export { copyOverdeckSettingsToWorkspace, ensurePanGitignore, migrateOverdeckToPan } from './workspace-manager/migration.js';
export { installPreRebaseHook, preTrustDirectory, relocateVenvScripts } from './workspace-manager/worktree-ops.js';
export { createWorkspace } from './workspace-manager/create.js';
export { isWorkspaceSetupIncomplete, workspaceNeedsSetup } from './workspace-manager/setup-marker.js';
export { addNewRepoToWorkspace, addReposToWorkspace } from './workspace-manager/repos.js';
export { getContainersReferencingWorkspacePath, stopWorkspaceDocker } from './workspace-manager/docker.js';
export { removeWorkspace } from './workspace-manager/remove.js';


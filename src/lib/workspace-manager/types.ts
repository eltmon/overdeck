import type { ProjectConfig } from '../workspace-config.js';

export const PRE_WORKTREE_METADATA_DIRS = new Set(['.pan', '.beads']);

export interface PanMigrationResult {
  /** Subdirectories migrated from .overdeck/ to .pan/ */
  migrated: string[];
  /** Subdirectories skipped because .pan/<subdir> already exists */
  skipped: string[];
  /** Errors encountered during migration */
  errors: string[];
}

/** Progress event emitted during workspace creation. */
export interface WorkspaceProgress {
  label: string;
  detail: string;
  status: 'active' | 'complete' | 'error';
}

export interface WorkspaceCreateOptions {
  projectConfig: ProjectConfig;
  featureName: string;
  startDocker?: boolean;
  dryRun?: boolean;
  /** Optional callback for streaming progress events during creation. */
  onProgress?: (event: WorkspaceProgress) => void;
}

export interface WorkspaceCreateResult {
  success: boolean;
  workspacePath: string;
  errors: string[];
  steps: string[];
}

export interface AddReposToWorkspaceOptions {
  projectConfig: ProjectConfig;
  featureName: string;
  repoNames: string[];
  dryRun?: boolean;
}

export interface AddReposToWorkspaceResult {
  success: boolean;
  errors: string[];
  steps: string[];
}

export interface WorkspaceRemoveOptions {
  projectConfig: ProjectConfig;
  featureName: string;
  dryRun?: boolean;
}

export interface WorkspaceRemoveResult {
  success: boolean;
  errors: string[];
  steps: string[];
}

/**
 * Result of Docker container cleanup for a workspace.
 */
export interface DockerCleanupResult {
  /** Whether compose files were found (containers may or may not have been running) */
  containersFound: boolean;
  /** Human-readable log of cleanup steps taken */
  steps: string[];
}

/**
 * Workspace Manager
 *
 * Handles workspace creation and removal for both monorepo and polyrepo projects.
 */

import { existsSync, readFileSync, unlinkSync, lstatSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Effect } from 'effect';
import {
  replacePlaceholdersSync,
  getDefaultWorkspaceConfigSync,
} from './workspace-config.js';
import { removeDnsEntry } from './dns.js';
import { removeTunnelIngress } from './tunnel.js';
import { deleteHumeConfig } from './hume.js';
import { FsError, ProcessSpawnError } from './errors.js';
import { copyOverdeckSettingsToWorkspaceSync, ensurePanGitignoreSync, migrateOverdeckToPanSync } from './workspace-manager/migration.js';
import { createWorkspacePromise } from './workspace-manager/create.js';
import { addReposToWorkspacePromise } from './workspace-manager/repos.js';
import {
  preTrustDirectorySync,
  releasePort,
  relocateVenvScripts,
  removeWorktree,
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

const execAsync = promisify(exec);

import {
  createWorkspacePlaceholdersSync as createPlaceholders,
  DEVCONTAINER_DIRNAME,
} from './workspace/devcontainer-renderer.js';

// DNS functions (addWsl2HostEntry, removeWsl2HostEntry, syncDnsToWindows)
// are now in src/lib/dns.ts and imported above

// `processTemplates` was previously defined inline here; it now lives in
// `./workspace/devcontainer-renderer.ts` and is imported above so the
// devcontainer renderer and the agent-template flow share a single
// implementation.
async function getContainersReferencingWorkspacePathPromise(
  workspacePath: string,
): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `docker ps -a --format '{{.ID}}|{{.Label "com.docker.compose.project.config_files"}}'`,
      { encoding: 'utf-8' },
    );
    const containers: string[] = [];
    const devcontainerPath = join(workspacePath, DEVCONTAINER_DIRNAME);
    for (const line of stdout.trim().split('\n').filter(Boolean)) {
      const sep = line.indexOf('|');
      if (sep === -1) continue;
      const configFiles = line.slice(sep + 1);
      if (configFiles.includes(devcontainerPath)) {
        containers.push(line.slice(0, sep));
      }
    }
    return containers;
  } catch {
    return [];
  }
}

async function stopWorkspaceDockerPromise(
  workspacePath: string,
  featureName: string,
): Promise<DockerCleanupResult> {
  const result: DockerCleanupResult = {
    containersFound: false,
    steps: [],
  };

  // Find all compose files in devcontainer directory (some projects use multiple)
  const devcontainerDir = join(workspacePath, DEVCONTAINER_DIRNAME);
  const composeFiles: string[] = [];

  if (existsSync(devcontainerDir)) {
    const possibleFiles = [
      'docker-compose.devcontainer.yml',
      'docker-compose.yml',
      'compose.yml',
      'compose.infra.yml',
      'compose.override.yml',
    ];
    for (const file of possibleFiles) {
      const fullPath = join(devcontainerDir, file);
      if (existsSync(fullPath)) {
        composeFiles.push(fullPath);
      }
    }
  }

  // Fallback: check for compose file in workspace root
  if (composeFiles.length === 0) {
    const rootCompose = join(workspacePath, 'docker-compose.yml');
    if (existsSync(rootCompose)) {
      composeFiles.push(rootCompose);
    }
  }

  const featureFolder = `feature-${featureName}`;
  const composeProjectName = `overdeck-${featureFolder}`;
  const devScriptPaths = [
    join(workspacePath, DEVCONTAINER_DIRNAME, 'dev'),
    join(workspacePath, 'dev'),
  ];
  for (const devPath of devScriptPaths) {
    try {
      if (!existsSync(devPath)) continue;
      const content = readFileSync(devPath, 'utf-8');
      const templatedMatch = content.match(/COMPOSE_PROJECT_NAME="([^$"]*)\$\{FEATURE_FOLDER\}"/);
      const declared = templatedMatch
        ? `${templatedMatch[1]}${featureFolder}`
        : content.match(/COMPOSE_PROJECT_NAME="([^"]+)"/)?.[1];
      if (declared && declared !== composeProjectName) {
        throw new Error(`${devPath} declares COMPOSE_PROJECT_NAME=${declared}, expected ${composeProjectName}`);
      }
    } catch (error: any) {
      if (error?.message?.includes('declares COMPOSE_PROJECT_NAME=')) throw error;
    }
  }

  if (composeFiles.length > 0) {
    result.containersFound = true;
    try {
      const fileFlags = composeFiles.map(f => `-f "${f}"`).join(' ');
      const cwd = existsSync(devcontainerDir) ? devcontainerDir : workspacePath;

      await execAsync(`docker compose ${fileFlags} -p "${composeProjectName}" down -v --remove-orphans`, {
        cwd,
        timeout: 60000,
      });
      result.steps.push(`Stopped Docker containers (${composeFiles.length} compose files)`);
    } catch (error: any) {
      // Log but don't fail — containers might not be running
      result.steps.push(`Docker cleanup attempted (${error.message?.split('\n')[0] || 'containers may not be running'})`);
    }
  } else {
    // No compose files on disk — check if containers still reference the missing path.
    // This can happen when .devcontainer/ was deleted after containers were created.
    const orphanedContainers = await Effect.runPromise(getContainersReferencingWorkspacePath(workspacePath));
    if (orphanedContainers.length > 0) {
      result.containersFound = true;
      try {
        // Try project-name-based down first (Docker Compose can discover containers by label)
        await execAsync(`docker compose -p "${composeProjectName}" down -v --remove-orphans`, {
          cwd: workspacePath,
          timeout: 60000,
        });
        result.steps.push(`Stopped orphaned Docker containers by project name (${orphanedContainers.length} containers)`);
      } catch {
        // Fall back to raw docker stop / rm for each container
        for (const containerId of orphanedContainers) {
          try {
            await execAsync(`docker stop "${containerId}"`, { timeout: 30000 });
            await execAsync(`docker rm "${containerId}"`, { timeout: 30000 });
          } catch {
            // Best-effort — container may already be gone
          }
        }
        result.steps.push(`Stopped ${orphanedContainers.length} orphaned Docker containers individually`);
      }
    }
  }

  // Clean up Docker-created files (root-owned in containers)
  try {
    await execAsync(
      `docker run --rm -v "${workspacePath}:/workspace" alpine sh -c "find /workspace -user root -delete 2>&1 | tail -100 || true"`,
      { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
    );
    result.steps.push('Cleaned up Docker-created files');
  } catch {
    // Alpine container might not be available
  }

  return result;
}async function removeWorkspacePromise(options: WorkspaceRemoveOptions): Promise<WorkspaceRemoveResult> {
  const { projectConfig, featureName, dryRun } = options;
  const result: WorkspaceRemoveResult = {
    success: true,
    errors: [],
    steps: [],
  };

  const workspaceConfig = projectConfig.workspace || getDefaultWorkspaceConfigSync();
  const workspacesDir = join(projectConfig.path, workspaceConfig.workspaces_dir || 'workspaces');
  const featureFolder = `feature-${featureName}`;
  const workspacePath = join(workspacesDir, featureFolder);

  if (!existsSync(workspacePath)) {
    result.success = false;
    result.errors.push(`Workspace not found at ${workspacePath}`);
    return result;
  }

  if (dryRun) {
    result.steps.push('[DRY RUN] Would remove workspace at: ' + workspacePath);
    return result;
  }

  // Stop TLDR daemon for workspace (if it exists)
  const venvPath = join(workspacePath, '.venv');
  if (existsSync(venvPath)) {
    try {
      const { getTldrDaemonServiceSync } = await import('./tldr-daemon.js');
      const tldrService = getTldrDaemonServiceSync(workspacePath, venvPath);
      await tldrService.stop();
      result.steps.push('Stopped TLDR daemon');
    } catch (error: any) {
      // Non-fatal - daemon may not be running
      console.warn(`⚠ Failed to stop TLDR daemon: ${error?.message}`);
    }
  }

  // Stop Docker containers and clean up Docker-created files
  const dockerResult = await Effect.runPromise(stopWorkspaceDocker(workspacePath, featureName));
  result.steps.push(...dockerResult.steps);

  // Remove worktrees
  if (workspaceConfig.type === 'polyrepo' && workspaceConfig.repos) {
    for (const repo of workspaceConfig.repos) {
      const targetPath = join(workspacePath, repo.name);

      // Check if this is a symlink (e.g., meta repo symlinked, not a worktree)
      if (existsSync(targetPath) && lstatSync(targetPath).isSymbolicLink()) {
        // Symlink - just unlink it
        try {
          unlinkSync(targetPath);
          result.steps.push(`Removed symlink for ${repo.name}`);
        } catch (unlinkErr: any) {
          result.errors.push(`${repo.name}: ${unlinkErr.message}`);
        }
      } else if (existsSync(targetPath)) {
        // Worktree - remove via git worktree remove
        const repoPath = join(projectConfig.path, repo.path);
        const branchPrefix = repo.branch_prefix || 'feature/';
        const branchName = `${branchPrefix}${featureName}`;

        const worktreeResult = await removeWorktree(repoPath, targetPath, branchName);
        if (worktreeResult.success) {
          result.steps.push(`Removed worktree for ${repo.name}`);
        } else {
          result.errors.push(worktreeResult.message);
        }
      }
    }
  } else {
    // Monorepo: remove single worktree
    const branchName = `feature/${featureName}`;
    const worktreeResult = await removeWorktree(projectConfig.path, workspacePath, branchName);
    if (worktreeResult.success) {
      result.steps.push('Removed worktree');
    } else {
      result.errors.push(worktreeResult.message);
    }
  }

  // Remove DNS entries
  if (workspaceConfig.dns) {
    const placeholders = createPlaceholders(projectConfig, featureName, workspacePath);

    const dnsMethod = workspaceConfig.dns.sync_method || 'wsl2hosts';
    for (const entryPattern of workspaceConfig.dns.entries) {
      const hostname = replacePlaceholdersSync(entryPattern, placeholders);
      if (removeDnsEntry(dnsMethod, hostname)) {
        result.steps.push(`Removed DNS entry: ${hostname}`);
      }
    }
  }

  // Remove Cloudflare tunnel entries
  if (workspaceConfig.tunnel) {
    const placeholders = createPlaceholders(projectConfig, featureName, workspacePath);
    const tunnelResult = await Effect.runPromise(removeTunnelIngress(workspaceConfig.tunnel, placeholders));
    result.steps.push(...tunnelResult.steps);
  }

  // Remove Hume EVI config
  if (workspaceConfig.hume) {
    const placeholders = createPlaceholders(projectConfig, featureName, workspacePath);
    const humeResult = await Effect.runPromise(deleteHumeConfig(workspaceConfig.hume, placeholders));
    result.steps.push(...humeResult.steps);
  }

  // Release ports
  if (workspaceConfig.ports) {
    for (const [portName] of Object.entries(workspaceConfig.ports)) {
      const portFile = join(projectConfig.path, `.${portName}-ports`);
      if (releasePort(portFile, featureFolder)) {
        result.steps.push(`Released ${portName} port`);
      }
    }
  }

  // Guard: never delete workspace while containers still reference its compose path
  const orphanedContainers = await Effect.runPromise(getContainersReferencingWorkspacePath(workspacePath));
  if (orphanedContainers.length > 0) {
    result.errors.push(
      `Cannot remove workspace directory: ${orphanedContainers.length} Docker container(s) still reference compose paths in ${DEVCONTAINER_DIRNAME}/. ` +
        `Run workspace Docker cleanup first or stop the containers manually.`,
    );
  } else {
    // Remove workspace directory
    try {
      await execAsync(`rm -rf "${workspacePath}"`, { maxBuffer: 10 * 1024 * 1024 });
      result.steps.push('Removed workspace directory');
    } catch (error) {
      result.errors.push(`Failed to remove workspace directory: ${error}`);
    }
  }

  result.success = result.errors.length === 0;
  return result;
}

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

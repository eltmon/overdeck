import { existsSync, unlinkSync, lstatSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Effect } from 'effect';
import {
  replacePlaceholdersSync,
  getDefaultWorkspaceConfigSync,
} from '../workspace-config.js';
import { removeDnsEntry } from '../dns.js';
import { removeTunnelIngress } from '../tunnel.js';
import { deleteHumeConfig } from '../hume.js';
import { releasePort, removeWorktree } from './worktree-ops.js';
import { getContainersReferencingWorkspacePathPromise, stopWorkspaceDockerPromise } from './docker.js';
import type { WorkspaceRemoveOptions, WorkspaceRemoveResult } from './types.js';
import {
  createWorkspacePlaceholdersSync as createPlaceholders,
  DEVCONTAINER_DIRNAME,
} from '../workspace/devcontainer-renderer.js';

const execAsync = promisify(exec);

export async function removeWorkspacePromise(options: WorkspaceRemoveOptions): Promise<WorkspaceRemoveResult> {
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
      const { getTldrDaemonServiceSync } = await import('../tldr-daemon.js');
      const tldrService = getTldrDaemonServiceSync(workspacePath, venvPath);
      await tldrService.stop();
      result.steps.push('Stopped TLDR daemon');
    } catch (error: any) {
      // Non-fatal - daemon may not be running
      console.warn(`⚠ Failed to stop TLDR daemon: ${error?.message}`);
    }
  }

  // Stop Docker containers and clean up Docker-created files
  const dockerResult = await stopWorkspaceDockerPromise(workspacePath, featureName);
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
  const orphanedContainers = await getContainersReferencingWorkspacePathPromise(workspacePath);
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

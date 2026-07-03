import { existsSync, readdirSync, realpathSync, symlinkSync } from 'fs';
import { join } from 'path';
import type { AddReposToWorkspaceOptions, AddReposToWorkspaceResult } from './types.js';
import { createWorktree } from './worktree-ops.js';

export async function addReposToWorkspacePromise(options: AddReposToWorkspaceOptions): Promise<AddReposToWorkspaceResult> {
  const { projectConfig, featureName, repoNames, dryRun } = options;
  const result: AddReposToWorkspaceResult = {
    success: true,
    errors: [],
    steps: [],
  };

  const workspaceConfig = projectConfig.workspace;
  if (!workspaceConfig || workspaceConfig.type !== 'polyrepo' || !workspaceConfig.repos) {
    result.success = false;
    result.errors.push('Project does not use polyrepo workspace configuration');
    return result;
  }

  const workspacesDir = join(projectConfig.path, workspaceConfig.workspaces_dir || 'workspaces');
  const workspacePath = join(workspacesDir, `feature-${featureName}`);

  if (!existsSync(workspacePath)) {
    result.success = false;
    result.errors.push(`Workspace not found at ${workspacePath}`);
    return result;
  }

  if (dryRun) {
    result.steps.push(`[DRY RUN] Would add repos to workspace at: ${workspacePath}`);
    return result;
  }

  // Find the repos to add
  const reposToAdd = workspaceConfig.repos.filter(r => repoNames.includes(r.name));
  const unknownRepos = repoNames.filter(name => !reposToAdd.some(r => r.name === name));

  if (unknownRepos.length > 0) {
    result.errors.push(`Unknown repos: ${unknownRepos.join(', ')}`);
    result.success = false;
  }

  // Check which repos are already in the workspace
  const existingEntries = readdirSync(workspacePath).filter(f => {
    const fullPath = join(workspacePath, f);
    return f !== '.planning' && f !== '.claude' && f !== '.pan' && f !== '.beads' && existsSync(fullPath);
  });

  for (const repo of reposToAdd) {
    if (existingEntries.includes(repo.name)) {
      result.steps.push(`Skipped ${repo.name}: already exists in workspace`);
      continue;
    }

    const rawRepoPath = join(projectConfig.path, repo.path);
    const repoPath = existsSync(rawRepoPath) ? realpathSync(rawRepoPath) : rawRepoPath;
    const targetPath = join(workspacePath, repo.name);

    if (repo.link_type === 'symlink') {
      try {
        symlinkSync(repoPath, targetPath);
        result.steps.push(`Added symlink for ${repo.name} (readonly)`);
      } catch (symlinkErr: any) {
        result.errors.push(`${repo.name}: ${symlinkErr.message}`);
        result.success = false;
      }
    } else {
      const branchPrefix = repo.branch_prefix || 'feature/';
      const branchName = `${branchPrefix}${featureName}`;
      const defaultBranch = repo.default_branch || workspaceConfig.default_branch || 'main';

      const worktreeResult = await createWorktree(repoPath, targetPath, branchName, defaultBranch);
      if (worktreeResult.success) {
        result.steps.push(`Added worktree for ${repo.name}: ${branchName} (from ${defaultBranch})`);
      } else {
        result.errors.push(`${repo.name}: ${worktreeResult.message}`);
        result.success = false;
      }
    }
  }

  return result;
}

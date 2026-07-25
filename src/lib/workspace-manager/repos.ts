import { execFile } from 'child_process';
import { existsSync, readdirSync, realpathSync, symlinkSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { installGitHooksInDir } from '../git-hooks.js';
import { registerProjectSync } from '../projects.js';
import type { RepoConfig } from '../workspace-config.js';
import type {
  AddNewRepoToWorkspaceOptions,
  AddReposToWorkspaceOptions,
  AddReposToWorkspaceResult,
} from './types.js';
import { createWorktree } from './worktree-ops.js';

const execFileAsync = promisify(execFile);

type RunGit = (args: string[], cwd: string) => Promise<{ stdout: string }>;

interface AddNewRepoDeps {
  runGit?: RunGit;
  persistProject?: typeof registerProjectSync;
}

const defaultRunGit: RunGit = async (args, cwd) => {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf-8' });
  return { stdout: String(stdout) };
};

function normalizeGitUrl(value: string): string {
  return value.trim().replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\.git$/, '');
}

export function inferRepoNameFromGitUrl(gitUrl: string): string {
  const normalized = normalizeGitUrl(gitUrl);
  const repoName = normalized.split(/[/:]/).filter(Boolean).pop() ?? '';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(repoName) || repoName === '.' || repoName === '..') {
    throw new Error(`Cannot infer a safe repository name from URL: ${gitUrl}`);
  }
  return repoName;
}

function inferRepoForge(gitUrl: string): RepoConfig['forge'] | undefined {
  const normalized = gitUrl.toLowerCase();
  if (normalized.includes('github.com')) return 'github';
  if (normalized.includes('gitlab.com')) return 'gitlab';
  return undefined;
}

async function verifyRepoOrigin(
  repoPath: string,
  gitUrl: string,
  runGit: RunGit,
): Promise<string | null> {
  if (!existsSync(join(repoPath, '.git'))) {
    return `${repoPath} exists but is not a git repository`;
  }

  try {
    const { stdout } = await runGit(['remote', 'get-url', 'origin'], repoPath);
    if (normalizeGitUrl(stdout) !== normalizeGitUrl(gitUrl)) {
      return `${repoPath} has origin ${stdout.trim()}, expected ${gitUrl}`;
    }
  } catch (error) {
    return `${repoPath} has no readable origin: ${error instanceof Error ? error.message : String(error)}`;
  }

  return null;
}

export async function addNewRepoToWorkspacePromise(
  options: AddNewRepoToWorkspaceOptions,
  deps: AddNewRepoDeps = {},
): Promise<AddReposToWorkspaceResult> {
  const { projectKey, projectConfig, featureName, gitUrl, dryRun } = options;
  const result: AddReposToWorkspaceResult = { success: true, errors: [], steps: [] };
  const workspaceConfig = projectConfig.workspace;
  if (!workspaceConfig || workspaceConfig.type !== 'polyrepo' || !workspaceConfig.repos) {
    return { success: false, errors: ['Project does not use polyrepo workspace configuration'], steps: [] };
  }

  const repoName = options.repoName || inferRepoNameFromGitUrl(gitUrl);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(repoName) || repoName === '.' || repoName === '..') {
    return { success: false, errors: [`Invalid repository name: ${repoName}`], steps: [] };
  }
  if (workspaceConfig.repos.some(repo => repo.name === repoName)) {
    return { success: false, errors: [`Repository ${repoName} is already registered for project ${projectKey}`], steps: [] };
  }

  const workspacesDir = join(projectConfig.path, workspaceConfig.workspaces_dir || 'workspaces');
  const workspacePath = join(workspacesDir, `feature-${featureName}`);
  if (!existsSync(workspacePath)) {
    return { success: false, errors: [`Workspace not found at ${workspacePath}`], steps: [] };
  }

  const forge = inferRepoForge(gitUrl);
  const branchPrefix = workspaceConfig.repos.find(repo => !repo.readonly)?.branch_prefix || 'feature/';
  const repoConfig: RepoConfig = {
    name: repoName,
    path: repoName,
    branch_prefix: branchPrefix,
    ...(forge ? { forge } : {}),
  };
  const updatedProjectConfig = {
    ...projectConfig,
    workspace: {
      ...workspaceConfig,
      repos: [...workspaceConfig.repos, repoConfig],
    },
  };
  const sourcePath = join(projectConfig.path, repoName);
  const targetPath = join(workspacePath, repoName);
  const branchName = `${branchPrefix}${featureName}`;
  const runGit = deps.runGit ?? defaultRunGit;

  if (dryRun) {
    result.steps.push(`[DRY RUN] Would clone ${gitUrl} to ${sourcePath}`);
    result.steps.push(`[DRY RUN] Would create ${branchName} at ${targetPath}`);
    result.steps.push(`[DRY RUN] Would register ${repoName} in project ${projectKey}`);
    return result;
  }

  if (existsSync(sourcePath)) {
    const originError = await verifyRepoOrigin(sourcePath, gitUrl, runGit);
    if (originError) return { success: false, errors: [originError], steps: [] };
    result.steps.push(`Using existing project clone for ${repoName}`);
  } else {
    try {
      await runGit(['clone', '--origin', 'origin', '--', gitUrl, sourcePath], projectConfig.path);
      result.steps.push(`Cloned ${repoName} into project repo set`);
    } catch (error) {
      return {
        success: false,
        errors: [`Failed to clone ${gitUrl}: ${error instanceof Error ? error.message : String(error)}`],
        steps: result.steps,
      };
    }
  }

  installGitHooksInDir(join(sourcePath, '.git'));

  if (existsSync(targetPath)) {
    const originError = await verifyRepoOrigin(targetPath, gitUrl, runGit);
    if (originError) return { success: false, errors: [originError], steps: result.steps };
    try {
      const { stdout } = await runGit(['branch', '--show-current'], targetPath);
      if (stdout.trim() !== branchName) {
        return {
          success: false,
          errors: [
            `${targetPath} already exists on branch ${stdout.trim() || '(detached)'}. ` +
            `Move or commit that work onto ${branchName}, then rerun this command.`,
          ],
          steps: result.steps,
        };
      }
      result.steps.push(`Using existing workspace checkout for ${repoName} on ${branchName}`);
    } catch (error) {
      return {
        success: false,
        errors: [`Failed to inspect ${targetPath}: ${error instanceof Error ? error.message : String(error)}`],
        steps: result.steps,
      };
    }
  } else {
    const addResult = await addReposToWorkspacePromise({
      projectConfig: updatedProjectConfig,
      featureName,
      repoNames: [repoName],
    });
    result.steps.push(...addResult.steps);
    if (!addResult.success) {
      return { success: false, errors: addResult.errors, steps: result.steps };
    }
  }

  try {
    (deps.persistProject ?? registerProjectSync)(projectKey, updatedProjectConfig);
    result.steps.push(`Registered ${repoName} in project ${projectKey}`);
  } catch (error) {
    return {
      success: false,
      errors: [`Failed to persist project repo registration: ${error instanceof Error ? error.message : String(error)}`],
      steps: result.steps,
    };
  }

  return result;
}

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

  // Validate requested names before dry-run so unknown repos cannot be reported as added.
  const reposToAdd = workspaceConfig.repos.filter(r => repoNames.includes(r.name));
  const unknownRepos = repoNames.filter(name => !reposToAdd.some(r => r.name === name));
  if (unknownRepos.length > 0) {
    result.errors.push(`Unknown repos: ${unknownRepos.join(', ')}`);
    result.success = false;
    return result;
  }

  if (dryRun) {
    result.steps.push(`[DRY RUN] Would add repos to workspace at: ${workspacePath}`);
    for (const repo of reposToAdd) {
      result.steps.push(`[DRY RUN] Would add ${repo.name}`);
    }
    return result;
  }

  // Check which repos are already in the workspace
  const existingEntries = readdirSync(workspacePath).filter(f => {
    const fullPath = join(workspacePath, f);
    return f !== '.planning' && f !== '.claude' && f !== '.pan' && existsSync(fullPath);
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

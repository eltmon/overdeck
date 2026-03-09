import { execSync } from 'child_process';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
  prunable: boolean;
}

export function listWorktrees(repoPath: string): WorktreeInfo[] {
  const output = execSync('git worktree list --porcelain', {
    cwd: repoPath,
    encoding: 'utf8',
  });

  const worktrees: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) worktrees.push(current as WorktreeInfo);
      current = { path: line.slice(9), prunable: false };
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice(5);
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice(7).replace('refs/heads/', '');
    } else if (line === 'prunable') {
      current.prunable = true;
    }
  }
  if (current.path) worktrees.push(current as WorktreeInfo);

  return worktrees;
}

export function createWorktree(
  repoPath: string,
  targetPath: string,
  branchName: string
): void {
  // Ensure parent directory exists
  mkdirSync(dirname(targetPath), { recursive: true });

  // Check if branch exists
  try {
    execSync(`git show-ref --verify --quiet refs/heads/${branchName}`, {
      cwd: repoPath,
    });
    // Branch exists, just add worktree
    execSync(`git worktree add "${targetPath}" "${branchName}"`, {
      cwd: repoPath,
      stdio: 'pipe',
    });
  } catch {
    // Branch doesn't exist, create it
    execSync(`git worktree add -b "${branchName}" "${targetPath}"`, {
      cwd: repoPath,
      stdio: 'pipe',
    });
  }

  // Configure beads role so agents don't get "beads.role not configured" warnings
  try {
    execSync('git config beads.role agent', { cwd: targetPath, stdio: 'pipe' });
  } catch { /* non-fatal */ }
}

export function removeWorktree(repoPath: string, worktreePath: string): void {
  execSync(`git worktree remove "${worktreePath}" --force`, {
    cwd: repoPath,
    stdio: 'pipe',
  });
}

export function pruneWorktrees(repoPath: string): void {
  execSync('git worktree prune', { cwd: repoPath, stdio: 'pipe' });
}

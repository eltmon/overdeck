/**
 * Git utilities for handling common git operations and recovery
 */

import { existsSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Check if any git processes are currently running in a specific repository
 *
 * This checks if there are git processes with the repository path in their command line.
 * If we can't determine repository-specific processes, we conservatively return false
 * (no processes detected) to allow cleanup to proceed.
 */
async function hasRunningGitProcesses(repoPath: string): Promise<boolean> {
  try {
    // Try to find git processes that reference this specific repository.
    // Bound these probes so stale-lock cleanup cannot hang on shell/process tools.
    try {
      const gitDir = join(repoPath, '.git');
      const { stdout } = await execAsync(`fuser "${gitDir}" 2>/dev/null`, {
        encoding: 'utf-8',
        timeout: 1000,
      });
      return stdout.trim().length > 0;
    } catch {
      try {
        const escapedRepoPath = repoPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const { stdout } = await execAsync(
          `ps aux | grep -E "git.*${escapedRepoPath}" | grep -v grep`,
          {
            encoding: 'utf-8',
            timeout: 1000,
          },
        );
        return stdout.trim().length > 0;
      } catch {
        return false;
      }
    }
  } catch {
    return false;
  }
}

/**
 * Find all git lock files in a repository
 */
function findGitLockFiles(repoPath: string): string[] {
  const lockFiles: string[] = [];

  // Check for index.lock in .git directory
  const indexLock = join(repoPath, '.git', 'index.lock');
  if (existsSync(indexLock)) {
    lockFiles.push(indexLock);
  }

  // Check for ref locks in .git/refs
  const refsDir = join(repoPath, '.git', 'refs');
  if (existsSync(refsDir)) {
    const findLocksRecursive = (dir: string) => {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          findLocksRecursive(fullPath);
        } else if (entry.name.endsWith('.lock')) {
          lockFiles.push(fullPath);
        }
      }
    };
    try {
      findLocksRecursive(refsDir);
    } catch {
      // Ignore errors reading refs directory
    }
  }

  return lockFiles;
}

/**
 * Check for and clean up stale git lock files
 *
 * A lock file is considered stale if:
 * 1. It exists
 * 2. No git processes are currently running
 *
 * @param repoPath - Path to the git repository
 * @returns Object with cleanup results
 */
export async function cleanupStaleLocks(repoPath: string): Promise<{
  found: string[];
  removed: string[];
  errors: Array<{ file: string; error: string }>;
}> {
  const result = {
    found: [] as string[],
    removed: [] as string[],
    errors: [] as Array<{ file: string; error: string }>,
  };

  // Find all lock files
  const lockFiles = findGitLockFiles(repoPath);
  result.found = lockFiles;

  if (lockFiles.length === 0) {
    return result;
  }

  // Check if git processes are running for this repository
  const hasGitProcesses = await hasRunningGitProcesses(repoPath);

  if (hasGitProcesses) {
    // Don't remove locks if git is actively running
    result.errors.push({
      file: 'N/A',
      error: 'Git processes are running - not safe to remove locks',
    });
    return result;
  }

  // Remove stale lock files
  for (const lockFile of lockFiles) {
    try {
      unlinkSync(lockFile);
      result.removed.push(lockFile);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      result.errors.push({ file: lockFile, error: msg });
    }
  }

  return result;
}

/**
 * Result of getWorkspaceGitInfo.
 * Note: `branch` is the branch name (not a hash) despite the parent function name.
 */
export interface WorkspaceCommitInfo {
  /** Full SHA of the HEAD commit */
  HEAD: string;
  /** Current branch name (e.g. "feature/pan-342") */
  branch: string;
}

/**
 * Get the current HEAD commit SHA and branch name for a workspace.
 *
 * Note: the return value includes `branch` (a name, not a hash) alongside `HEAD` (a SHA).
 * The function name reflects its primary use-case of snapshotting commit state for review.
 *
 * @param workspacePath - Path to the git workspace
 * @returns WorkspaceCommitInfo with HEAD SHA and branch name
 * @throws Error if git commands fail (e.g. path is not a git repository)
 */
export async function getWorkspaceGitInfo(workspacePath: string): Promise<WorkspaceCommitInfo> {
  try {
    const [headResult, branchResult] = await Promise.all([
      execAsync('git rev-parse HEAD', { cwd: workspacePath }),
      execAsync('git rev-parse --abbrev-ref HEAD', { cwd: workspacePath }),
    ]);
    return {
      HEAD: headResult.stdout.trim(),
      branch: branchResult.stdout.trim(),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`getWorkspaceGitInfo failed for ${workspacePath}: ${msg}`);
  }
}

/**
 * Check if a repository has stale lock files
 *
 * @param repoPath - Path to the git repository
 * @returns True if stale locks exist
 */
export async function hasStaleLocks(repoPath: string): Promise<boolean> {
  const lockFiles = findGitLockFiles(repoPath);
  if (lockFiles.length === 0) {
    return false;
  }

  const hasGitProcesses = await hasRunningGitProcesses(repoPath);
  return !hasGitProcesses;
}

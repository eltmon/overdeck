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
    // Try to find git processes that reference this specific repository
    // Use fuser to check if any process has the .git directory open (more reliable)
    try {
      const gitDir = join(repoPath, '.git');
      const { stdout } = await execAsync(`fuser "${gitDir}" 2>/dev/null`, {
        encoding: 'utf-8',
      });
      // fuser returns PIDs if any process has the directory open
      return stdout.trim().length > 0;
    } catch {
      // fuser not available or no processes found
      // Fall back to checking ps for git processes in this directory
      try {
        const { stdout } = await execAsync(
          `ps aux | grep -E "git.*${repoPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" | grep -v grep`,
          { encoding: 'utf-8' }
        );
        return stdout.trim().length > 0;
      } catch {
        // No git processes found for this repo
        return false;
      }
    }
  } catch {
    // Error checking - conservatively assume no processes
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

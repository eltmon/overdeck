/**
 * Git worktree helpers for gauntlet lanes (.pan/drafts/pan-4223.md WI-3 step 3).
 *
 * The lane door runs inside the dashboard server, so every git call here is an
 * async `execFile` with a 60 s timeout — never `execSync` (NFR-2).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 60_000;
const LANE_DIR_NAME = /^[a-z0-9][a-z0-9._-]*$/;

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: GIT_TIMEOUT_MS });
  return stdout;
}

/** Returns `name` when it is a valid lane directory name, else throws naming it. */
export function laneDirName(name: string): string {
  if (!LANE_DIR_NAME.test(name)) {
    throw new Error(`invalid lane directory name "${name}": must match ${LANE_DIR_NAME.source}`);
  }
  return name;
}

/** `git fetch origin`. A failure returns a warning string instead of throwing; the launch continues. */
export async function fetchBase(projectPath: string): Promise<string | null> {
  try {
    await git(['fetch', 'origin'], projectPath);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `git fetch origin failed in ${projectPath}; using the local base ref: ${message.trim()}`;
  }
}

async function localBranchExists(projectPath: string, branch: string): Promise<boolean> {
  try {
    await git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], projectPath);
    return true;
  } catch {
    return false;
  }
}

/** Adds a worktree on `branch`, cutting the branch from `base` when it does not exist locally. */
export async function addBranchWorktree(projectPath: string, path: string, branch: string, base: string): Promise<void> {
  if (await localBranchExists(projectPath, branch)) {
    await git(['worktree', 'add', path, branch], projectPath);
  } else {
    await git(['worktree', 'add', '-b', branch, path, base], projectPath);
  }
}

/** Adds a worktree whose HEAD is detached at `ref`. */
export async function addDetachedWorktree(projectPath: string, path: string, ref: string): Promise<void> {
  await git(['worktree', 'add', '--detach', path, ref], projectPath);
}

/** Applies `git sparse-checkout set --no-cone <patterns…>` to the worktree at `path`. */
export async function applySparse(path: string, patterns: string[]): Promise<void> {
  await git(['-C', path, 'sparse-checkout', 'set', '--no-cone', ...patterns], path);
}

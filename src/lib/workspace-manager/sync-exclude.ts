/**
 * PAN-5395: hide Overdeck's .claude/ sync output from git in a single-repo
 * issue workspace, through the worktree-scoped exclude file
 * (src/lib/git/worktree-exclude.ts, owner `sync`). Never writes the common
 * info/exclude: a path that is not a linked worktree is skipped. Never throws.
 */
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { excludeTarget, readExcludeBlock, setExcludeBlock } from '../git/worktree-exclude.js';
import { OVERDECK_WORKSPACE_SYNC_EXCLUDE_PATTERNS } from '../workspace-sync-paths.js';

const execFileAsync = promisify(execFile);
/** Same name as worktree-exclude.ts's private constant; export that one instead if the reviewer prefers. */
const LEGACY_DEFT_EXCLUDE_NAME = 'overdeck-deft-exclude';

function expandHome(path: string): string {
  return path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path;
}

export interface WorkspaceSyncExcludeResult {
  status: 'written' | 'unchanged' | 'skipped';
  /** Exclude file path when status is written or unchanged. */
  file?: string;
  /** Set when a git or filesystem error stopped the write; status is then 'skipped'. */
  warning?: string;
}

/** The worktree's core.excludesFile, or null when unset or unreadable. */
async function worktreeExcludesFile(workspacePath: string): Promise<string | null> {
  try {
    return (await execFileAsync('git', ['config', '--worktree', '--get', 'core.excludesFile'], { cwd: workspacePath })).stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function ensureWorkspaceSyncExclude(workspacePath: string): Promise<WorkspaceSyncExcludeResult> {
  try {
    const target = await excludeTarget(workspacePath);
    if (target.scope !== 'worktree') return { status: 'skipped' };
    const configured = await worktreeExcludesFile(workspacePath);
    const configuredPath = configured === null ? null : resolve(workspacePath, expandHome(configured));
    // A worktree excludes file that Overdeck did not write: setExcludeBlock would repoint
    // core.excludesFile away from it and its rules would stop applying. Leave it alone.
    // The pre-PAN-4852 Deft file is not foreign: setExcludeBlock migrates its patterns.
    if (configuredPath !== null && configuredPath !== target.file
      && configuredPath !== join(dirname(target.file), LEGACY_DEFT_EXCLUDE_NAME)) {
      return { status: 'skipped', warning: `worktree core.excludesFile points at ${configuredPath}, not ${target.file}; left unchanged` };
    }
    const wanted: readonly string[] = OVERDECK_WORKSPACE_SYNC_EXCLUDE_PATTERNS;
    const current = await readExcludeBlock(workspacePath, 'sync');
    const blockMatches = current !== null && current.length === wanted.length && current.every((p, i) => p === wanted[i]);
    // The block alone is not proof: core.excludesFile must point at the file too.
    if (blockMatches && configuredPath === target.file) {
      return { status: 'unchanged', file: target.file };
    }
    await setExcludeBlock(workspacePath, 'sync', wanted);
    return { status: 'written', file: target.file };
  } catch (error) {
    return { status: 'skipped', warning: error instanceof Error ? error.message : String(error) };
  }
}

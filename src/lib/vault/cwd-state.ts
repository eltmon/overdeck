/**
 * Session Vault cwd state (PAN-2609, FR-12).
 *
 * Each settlement records a bounded summary of the working directory's git
 * state; on resume, the saved and current summaries are compared so the user
 * can decide how to handle drift. The cwd state records only identifiers and
 * counts. Uncommitted code travels separately, encrypted, as a WIP snapshot
 * (`wip-capture.ts`, PAN-4329).
 *
 * Git is invoked through promisified `execFile` (never `execSync`, which would
 * block the event loop when this runs inside the dashboard).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface CwdState {
  /** `git remote get-url origin`, or null when there is no origin remote. */
  gitOrigin: string | null;
  /** Full HEAD commit hash, or null in an unborn repository. */
  head: string | null;
  /** Current branch name, or null when detached. */
  branch: string | null;
  /** True when any file is staged, modified, untracked or conflicted. */
  dirty: boolean;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
}

export type CwdStateField = keyof CwdState;

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    // GIT_OPTIONAL_LOCKS=0: never take the user's index.lock for a read-only status refresh.
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    });
    return stdout;
  } catch {
    return null;
  }
}

/** Classify `git status --porcelain=v1` lines into counts. */
export function countPorcelainStatus(porcelain: string): Pick<CwdState, 'staged' | 'unstaged' | 'untracked' | 'conflicted'> {
  const counts = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 };
  for (const line of porcelain.split('\n')) {
    if (line.length < 2) continue;
    const x = line[0]!;
    const y = line[1]!;
    if (x === '?' && y === '?') {
      counts.untracked++;
      continue;
    }
    if (x === '!' && y === '!') continue; // ignored
    const unmerged = x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D');
    if (unmerged) {
      counts.conflicted++;
      continue;
    }
    if (x !== ' ') counts.staged++;
    if (y !== ' ') counts.unstaged++;
  }
  return counts;
}

/**
 * Read the git summary of `cwd`. Returns null when `cwd` is not inside a git
 * work tree (or git is unavailable), which FR-12 treats as "skip the comparison".
 */
export async function readCwdState(cwd: string): Promise<CwdState | null> {
  const inside = await git(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (inside === null || inside.trim() !== 'true') return null;

  const [origin, head, branch, status] = await Promise.all([
    git(cwd, ['remote', 'get-url', 'origin']),
    git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']),
    git(cwd, ['branch', '--show-current']),
    git(cwd, ['status', '--porcelain=v1', '--untracked-files=all']),
  ]);
  const counts = countPorcelainStatus(status ?? '');
  const branchName = branch?.trim() ?? '';
  return {
    gitOrigin: origin?.trim() || null,
    head: head?.trim() || null,
    branch: branchName.length > 0 ? branchName : null,
    dirty: counts.staged + counts.unstaged + counts.untracked + counts.conflicted > 0,
    ...counts,
  };
}

/** Names of the fields whose values differ between two summaries. */
export function compareCwdState(saved: CwdState, current: CwdState): CwdStateField[] {
  const fields: CwdStateField[] = [
    'gitOrigin',
    'head',
    'branch',
    'dirty',
    'staged',
    'unstaged',
    'untracked',
    'conflicted',
  ];
  return fields.filter((field) => saved[field] !== current[field]);
}

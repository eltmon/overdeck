/**
 * The drain's quiet check (PAN-5342, WI-5, FR-4).
 *
 * Runs once, after every session stopped and the writers drained. It reports
 * and never blocks: a session pane still live, an `index.lock`, or a rebase or
 * merge left half done in any worktree of any registered project becomes a
 * warning on the final banner. Git runs through promisified `execFile` with a
 * timeout (NFR-1); a git failure skips that path silently.
 */
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { promisify } from 'node:util';

import { listLiveSessionIds } from './preview.js';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 5_000;

export interface VerifyDeps {
  readonly listLiveSessionIds: () => Promise<ReadonlySet<string> | null>;
  readonly listProjectPaths: () => Promise<readonly string[]>;
  /** `git <args>` stdout; throws on failure. */
  readonly git: (args: readonly string[]) => Promise<string>;
  readonly exists: (path: string) => Promise<boolean>;
}

const defaultVerifyDeps: VerifyDeps = {
  listLiveSessionIds: () => listLiveSessionIds(),
  listProjectPaths: async () => {
    const { listProjectsAsync } = await import('../../../../lib/projects.js');
    return (await listProjectsAsync()).map((p) => p.config.path).filter((p): p is string => typeof p === 'string' && p !== '');
  },
  git: async (args) => {
    const { stdout } = await execFileAsync('git', [...args], { timeout: GIT_TIMEOUT_MS, encoding: 'utf8' });
    return stdout;
  },
  exists: async (path) => {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  },
};

export function parseWorktreePaths(porcelain: string): string[] {
  return porcelain
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim())
    .filter(Boolean);
}

async function worktreeWarnings(path: string, deps: VerifyDeps): Promise<string[]> {
  let out: string;
  try {
    out = await deps.git(['-C', path, 'rev-parse',
      '--git-path', 'index.lock', '--git-path', 'rebase-merge', '--git-path', 'rebase-apply', '--git-path', 'MERGE_HEAD']);
  } catch {
    return [];
  }
  const [indexLock, ...inProgress] = out.split('\n').map((l) => l.trim()).filter(Boolean)
    .map((p) => (isAbsolute(p) ? p : resolve(path, p)));
  const warnings: string[] = [];
  if (indexLock && (await deps.exists(indexLock))) warnings.push(`${path}: index.lock is present`);
  const states = await Promise.all(inProgress.map((p) => deps.exists(p)));
  if (states.some(Boolean)) warnings.push(`${path}: a rebase or merge is in progress`);
  return warnings;
}

export async function verifyQuiet(overrides: Partial<VerifyDeps> = {}): Promise<string[]> {
  const deps = { ...defaultVerifyDeps, ...overrides };
  const warnings: string[] = [];
  const live = await deps.listLiveSessionIds().catch(() => null);
  if (live && live.size > 0) warnings.push(`Still live: ${[...live].sort().join(', ')}`);

  let projects: readonly string[] = [];
  try {
    projects = await deps.listProjectPaths();
  } catch (err) {
    warnings.push(`Could not list projects to check worktrees: ${err instanceof Error ? err.message : String(err)}`);
  }
  const seen = new Set<string>();
  for (const project of projects) {
    let worktrees: string[];
    try {
      worktrees = parseWorktreePaths(await deps.git(['-C', project, 'worktree', 'list', '--porcelain']));
    } catch {
      continue;
    }
    const fresh = worktrees.filter((w) => !seen.has(w));
    for (const w of fresh) seen.add(w);
    for (const found of await Promise.all(fresh.map((w) => worktreeWarnings(w, deps)))) warnings.push(...found);
  }
  return warnings;
}

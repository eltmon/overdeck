/**
 * The Deft state archive (PAN-4820 WI-12, AD-13).
 *
 * A hidden Directive install keeps its state (scopes, decisions, approved
 * scopes, escalations) in paths git never sees. `pan skills deft save`
 * copies that state into `<worktree>/.pan/deft/<ISSUE>/` and commits it on
 * the feature branch, so the PR carries it:
 *
 *   xbrief/<folder>/*.xbrief.json     → scopes/<folder>/<name>
 *   xbrief/decisions/*.decision.json  → decisions/<name>
 *   .deft/approved-scope/*.json       → approved-scope/<name>
 *   .deft/escalations/*.json          → escalations/<name>
 *
 * No archive path has an `xbrief/` or `.deft/` segment at the repo root, so
 * the merge guard's deposit rules never match the archive. The merge guard
 * refuses a PR whose archive differs from what `save` would write now.
 *
 * A native Directive project (one whose default branch tracks its own
 * deposit, AD-14) keeps its state in its own tracked `xbrief/`: nothing is
 * archived there.
 */
import { execFile } from 'node:child_process';
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { defaultBranchForRepo } from '../project-repos.js';
import { loadProjectsConfig } from '../projects.js';
import { findContainingProjectAsync } from '../projects/path-containment.js';
import { isDirectiveProjectAtRef } from './detect.js';

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;
const GIT_TIMEOUT_MS = 10_000;

export interface DeftArchiveEntry {
  /** Relative to the worktree, under `.pan/deft/<ISSUE>/`. */
  archivePath: string;
  /** Relative to the worktree. */
  sourcePath: string;
}

export function deftArchiveDir(issueId: string): string {
  return `.pan/deft/${issueId.toUpperCase()}`;
}

/**
 * The ref whose committed tree decides whether a project is natively a
 * Directive project: `origin/<default branch>`, else the local default branch
 * when the remote ref is absent.
 */
export async function directiveBaseRef(worktree: string): Promise<string> {
  // Async, mtime-cached project config: this runs on dashboard poll paths (PAN-4849).
  const project = await Effect.runPromise(loadProjectsConfig())
    .then(config => findContainingProjectAsync(config.projects, worktree))
    .catch(() => null);
  const branch = defaultBranchForRepo(project?.[1] ?? null, worktree);
  return (await gitExitCode(worktree, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`])) === 0
    ? `origin/${branch}`
    : branch;
}

/**
 * True for a project that tracks its own Directive deposit on its default
 * branch. Read from the committed base tree only: a worktree's own files
 * cannot decide it, because a temporary install leaves the same markers on
 * disk, and a deleted or corrupt install snapshot must not turn the merge
 * guard off.
 */
export async function isNativeDirectiveProject(worktree: string): Promise<boolean> {
  return isDirectiveProjectAtRef(worktree, await directiveBaseRef(worktree));
}

async function listNames(dir: string, filter: (name: string, isDir: boolean) => boolean): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter(entry => filter(entry.name, entry.isDirectory())).map(entry => entry.name).sort();
  } catch {
    return [];
  }
}

const isFileNamed = (suffix: string) => (name: string, isDir: boolean): boolean => !isDir && name.endsWith(suffix);

export async function planDeftArchive(worktree: string, issueId: string): Promise<DeftArchiveEntry[]> {
  if (await isNativeDirectiveProject(worktree)) return [];
  const root = deftArchiveDir(issueId);
  const plan: DeftArchiveEntry[] = [];
  const add = (sourceDir: string, archiveDir: string, names: string[]): void => {
    for (const name of names) plan.push({ sourcePath: `${sourceDir}/${name}`, archivePath: `${root}/${archiveDir}/${name}` });
  };

  const folders = await listNames(join(worktree, 'xbrief'), (name, isDir) => isDir && !name.startsWith('.') && name !== 'decisions');
  for (const folder of folders) {
    add(`xbrief/${folder}`, `scopes/${folder}`, await listNames(join(worktree, 'xbrief', folder), isFileNamed('.xbrief.json')));
  }
  add('xbrief/decisions', 'decisions', await listNames(join(worktree, 'xbrief', 'decisions'), isFileNamed('.decision.json')));
  add('.deft/approved-scope', 'approved-scope', await listNames(join(worktree, '.deft', 'approved-scope'), isFileNamed('.json')));
  add('.deft/escalations', 'escalations', await listNames(join(worktree, '.deft', 'escalations'), isFileNamed('.json')));
  return plan;
}

async function git(worktree: string, args: string[]): Promise<string> {
  return (await execFileAsync('git', args, { cwd: worktree, maxBuffer: MAX_BUFFER })).stdout;
}

async function gitExitCode(worktree: string, args: string[]): Promise<number> {
  try {
    await execFileAsync('git', args, { cwd: worktree, timeout: GIT_TIMEOUT_MS });
    return 0;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'number' ? code : 1;
  }
}

/**
 * Replace `.pan/deft/<ISSUE>/` with the current state and commit it when it
 * changed. The commit names only the archive path, so other staged work is
 * left alone.
 */
export async function saveDeftState(worktree: string, issueId: string): Promise<{ committed: boolean; sha?: string; files: number }> {
  const issue = issueId.toUpperCase();
  const plan = await planDeftArchive(worktree, issue);
  const root = deftArchiveDir(issue);

  await rm(join(worktree, root), { recursive: true, force: true });
  for (const entry of plan) {
    const target = join(worktree, entry.archivePath);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(worktree, entry.sourcePath), target);
  }

  const tracked = (await git(worktree, ['ls-files', '--', root])).trim();
  if (plan.length === 0 && !tracked) return { committed: false, files: 0 };
  await git(worktree, ['add', '-A', '--', root]);
  if ((await gitExitCode(worktree, ['diff', '--cached', '--quiet', '--', root])) === 0) {
    return { committed: false, files: plan.length };
  }
  await git(worktree, ['commit', '-q', '-m', `chore(deft): save Deft state for ${issue}`, '--', root]);
  return { committed: true, sha: (await git(worktree, ['rev-parse', 'HEAD'])).trim(), files: plan.length };
}

/**
 * True when the archive at `headSha` holds exactly the files `save` would
 * write now, with the same bytes. Git failures read as not current.
 */
export async function isDeftArchiveCurrent(worktree: string, issueId: string, headSha: string): Promise<boolean> {
  if (await isNativeDirectiveProject(worktree)) return true;
  const issue = issueId.toUpperCase();
  const plan = await planDeftArchive(worktree, issue);
  try {
    const tree = new Map<string, string>();
    for (const line of (await git(worktree, ['ls-tree', '-r', '-z', headSha, '--', `${deftArchiveDir(issue)}/`])).split('\0')) {
      const tab = line.indexOf('\t');
      if (tab < 0) continue;
      const [, type, blob] = line.slice(0, tab).split(' ');
      if (type === 'blob' && blob) tree.set(line.slice(tab + 1), blob);
    }
    if (tree.size !== plan.length || plan.some(entry => !tree.has(entry.archivePath))) return false;
    if (plan.length === 0) return true;
    const blobs = (await git(worktree, ['hash-object', '--', ...plan.map(entry => entry.sourcePath)])).trim().split('\n');
    return plan.every((entry, index) => tree.get(entry.archivePath) === blobs[index]);
  } catch {
    return false;
  }
}

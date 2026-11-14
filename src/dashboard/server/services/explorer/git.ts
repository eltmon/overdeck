/**
 * Explorer git status and index actions (PAN-5183, FR-4, FR-5, FR-A3).
 *
 * `gitStatus` parses `git status --porcelain=v2 -z --branch` into per-path
 * statuses, plus the files committed on this branch since the default
 * branch (`committed`, D-A10). `gitStage` stages, unstages or discards
 * root-relative paths. Git calls go through `runGit` (literal pathspecs, no
 * optional locks), except the base-ref lookup: `resolveBaseRef` from
 * checkpoint-manager runs its own read-only `git rev-parse --verify`, so the
 * Changed filter shares the vs-main diff panel's base (D-A10).
 *
 * Discard unstages index entries that are not in HEAD, moves what git then
 * lists as untracked to the Overdeck trash (`trashPaths`), and restores the
 * rest from HEAD; an ignored file is never trashed on its own. Path checks
 * and the HEAD and index reads run before anything changes. The result
 * carries the trash ids.
 */
import type {
  ExplorerGitCommittedEntry,
  ExplorerGitStageResult,
  ExplorerGitStatusEntry,
  ExplorerGitStatusResult,
} from '@overdeck/contracts';
import { resolveBaseRef } from '../../../../lib/checkpoint/checkpoint-manager.js';
import { explorerError } from './errors.js';
import { runGit, type GitRunResult } from './git-exec.js';
import { resolveInsideRoot } from './paths.js';
import type { ExplorerRoot } from './roots.js';
import { trashPaths } from './trash.js';

const DEFAULT_MAX_STATUS_ENTRIES = 20_000;
const STATUS_TIMEOUT_MS = 10_000;

function nulRecords(stdout: Buffer): string[] {
  const records = stdout.toString('utf8').split('\0');
  if (records.at(-1) === '') records.pop();
  return records;
}

/** Everything after the `n`th space of `record`. */
function afterSpaces(record: string, n: number): string {
  let index = -1;
  for (let i = 0; i < n; i += 1) {
    index = record.indexOf(' ', index + 1);
    if (index < 0) return '';
  }
  return record.slice(index + 1);
}

async function repoPrefix(root: ExplorerRoot): Promise<string> {
  const run = await runGit(root.absPath, ['rev-parse', '--show-prefix']);
  if (run.code !== 0) throw explorerError('NOT_A_GIT_REPO', `Root ${root.id} is not inside a git checkout`);
  return run.stdout.toString('utf8').trim();
}

/** Strips the root's prefix from a repository-relative path; null when the path is outside the root. */
function underPrefix(prefix: string, path: string): string | null {
  if (prefix === '') return path;
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

function failed(what: string, run: GitRunResult) {
  const why = run.timedOut ? 'timed out' : run.stderr.trim() || `exit ${run.code}`;
  return explorerError('EXPLORER_FAILED', `${what} failed: ${why}`);
}

/** Parses porcelain v2 records. Paths are repository-relative. */
export function parsePorcelainV2(records: readonly string[]): { branch: string | null; entries: ExplorerGitStatusEntry[] } {
  let branch: string | null = null;
  const entries: ExplorerGitStatusEntry[] = [];
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]!;
    const type = record[0];
    if (type === '#') {
      if (record.startsWith('# branch.head ')) {
        const name = record.slice('# branch.head '.length);
        branch = name === '(detached)' ? null : name;
      }
      continue;
    }
    const xy = record.slice(2, 4);
    const x = xy[0];
    const y = xy[1];
    if (type === '1') {
      const status = x === 'A' ? 'added' : x === 'D' || y === 'D' ? 'deleted' : 'modified';
      entries.push({ path: afterSpaces(record, 8), status, staged: x !== '.' });
    } else if (type === '2') {
      entries.push({ path: afterSpaces(record, 9), status: 'renamed', staged: x !== '.' });
      i += 1; // the next record is the original path
    } else if (type === 'u') {
      entries.push({ path: afterSpaces(record, 10), status: 'conflicted', staged: false });
    } else if (type === '?') {
      entries.push({ path: record.slice(2).replace(/\/$/, ''), status: 'untracked', staged: false });
    }
    // '!' (ignored) and anything unknown are skipped.
  }
  return { branch, entries };
}

/** Parses `git diff --name-status -z` records. Paths are repository-relative. */
export function parseNameStatus(records: readonly string[]): ExplorerGitCommittedEntry[] {
  const out: ExplorerGitCommittedEntry[] = [];
  for (let i = 0; i < records.length; ) {
    const letter = records[i]![0];
    if (letter === 'R' || letter === 'C') {
      out.push({ path: records[i + 2] ?? '', status: 'renamed' });
      i += 3;
      continue;
    }
    const path = records[i + 1] ?? '';
    i += 2;
    if (letter === 'A') out.push({ path, status: 'added' });
    else if (letter === 'M' || letter === 'T') out.push({ path, status: 'modified' });
    else if (letter === 'D') out.push({ path, status: 'deleted' });
  }
  return out;
}

async function committedSinceDefault(root: ExplorerRoot, prefix: string): Promise<ExplorerGitCommittedEntry[]> {
  if (root.kind === 'project') return [];
  const baseRef = await resolveBaseRef(root.absPath, root.defaultBranch);
  if (!baseRef) return [];
  const diff = await runGit(root.absPath, ['diff', '--name-status', '-z', '-M', `${baseRef}...HEAD`]);
  if (diff.code !== 0) return [];
  return parseNameStatus(nulRecords(diff.stdout)).flatMap((entry) => {
    const path = underPrefix(prefix, entry.path);
    return path === null ? [] : [{ ...entry, path }];
  });
}

export async function gitStatus(root: ExplorerRoot, opts: { maxEntries?: number } = {}): Promise<ExplorerGitStatusResult> {
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_STATUS_ENTRIES;
  const prefix = await repoPrefix(root);
  const status = await runGit(root.absPath, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=normal'], {
    timeoutMs: STATUS_TIMEOUT_MS,
  });
  if (status.code !== 0 || status.timedOut) throw failed('git status', status);

  const parsed = parsePorcelainV2(nulRecords(status.stdout));
  const entries = parsed.entries.flatMap((entry) => {
    const path = underPrefix(prefix, entry.path);
    return path === null ? [] : [{ ...entry, path }];
  });

  return {
    entries: entries.slice(0, maxEntries),
    committed: await committedSinceDefault(root, prefix),
    branch: parsed.branch,
    truncated: entries.length > maxEntries || status.truncated,
  };
}

/**
 * Splits `paths` into those with HEAD content (restorable with
 * `git restore --source=HEAD`) and those holding at least one index entry
 * that is not in HEAD (must be unstaged first, or a no-overlay restore
 * would delete it).
 */
async function discardPlan(root: ExplorerRoot, paths: readonly string[]): Promise<{ unstage: string[]; head: string[] }> {
  const tree = await runGit(root.absPath, ['ls-tree', '-r', '-z', '--name-only', 'HEAD', '--', ...paths]);
  if (tree.code !== 0 || tree.timedOut || tree.truncated) throw failed('git ls-tree', tree);
  const headFiles = new Set(nulRecords(tree.stdout));

  const index = await runGit(root.absPath, ['ls-files', '-z', '--', ...paths]);
  if (index.code !== 0 || index.timedOut || index.truncated) throw failed('git ls-files', index);
  const newIndex = nulRecords(index.stdout).filter((f) => !headFiles.has(f));

  const under = (p: string, f: string) => f === p || f.startsWith(`${p}/`);
  const head = paths.filter((p) => [...headFiles].some((f) => under(p, f)));
  const unstage = paths.filter((p) => newIndex.some((f) => under(p, f)));
  return { unstage, head };
}

/** Entries git lists as untracked under `paths`, after any unstaging has already run. */
async function untrackedEntries(root: ExplorerRoot, paths: readonly string[]): Promise<string[]> {
  const run = await runGit(root.absPath, [
    'ls-files',
    '-z',
    '--others',
    '--exclude-standard',
    '--directory',
    '--no-empty-directory',
    '--',
    ...paths,
  ]);
  if (run.code !== 0 || run.timedOut || run.truncated) throw failed('git ls-files --others', run);
  return nulRecords(run.stdout).map((r) => r.replace(/\/$/, ''));
}

export async function gitStage(
  root: ExplorerRoot,
  paths: readonly string[],
  action: 'stage' | 'unstage' | 'discard',
): Promise<ExplorerGitStageResult> {
  // A root that is not itself a checkout's top level (e.g. a polyrepo
  // wrapper dir) would let git find an enclosing repository and change its
  // index instead.
  const prefix = await repoPrefix(root);
  if (prefix !== '') {
    throw explorerError(
      'NOT_A_GIT_REPO',
      `Root ${root.id} is not the top level of a git checkout; refusing to change an enclosing repository`,
    );
  }
  if (paths.length === 0) return { trashIds: [] };
  for (const p of paths) await resolveInsideRoot(root, p, { forWrite: true });

  if (action === 'stage') {
    const run = await runGit(root.absPath, ['add', '--', ...paths]);
    if (run.code !== 0) throw failed('git stage', run);
    return { trashIds: [] };
  }
  if (action === 'unstage') {
    const run = await runGit(root.absPath, ['restore', '--staged', '--', ...paths]);
    if (run.code !== 0) throw failed('git unstage', run);
    return { trashIds: [] };
  }

  const { unstage, head } = await discardPlan(root, paths);
  if (unstage.length > 0) {
    const run = await runGit(root.absPath, ['restore', '--staged', '--', ...unstage]);
    if (run.code !== 0) throw failed('git restore --staged', run);
  }
  const untracked = await untrackedEntries(root, paths);
  const trashIds = untracked.length > 0 ? await trashPaths(root, untracked) : [];
  if (head.length > 0) {
    const run = await runGit(root.absPath, ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...head]);
    if (run.code !== 0) {
      if (trashIds.length > 0) {
        const why = run.timedOut ? 'timed out' : run.stderr.trim() || `exit ${run.code}`;
        throw explorerError('EXPLORER_FAILED', `git restore failed: ${why}; moved to the Overdeck trash: ${trashIds.join(', ')}`);
      }
      throw failed('git discard', run);
    }
  }
  return { trashIds };
}

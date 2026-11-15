/**
 * What an edit workspace will land (PAN-5290 C-D5): every file that differs
 * between its working tree (untracked files included) and its merge base
 * with `origin/<default branch>`, with +/− per file, plus the paths that are
 * still uncommitted. Create PR commits all of it (`commitAll`, `git add -A`),
 * so this is exactly what the PR will carry.
 *
 * It never calls `gh`, so the client may refetch it on every watch batch of
 * the edit root. Git runs through `runGit` only (async, NFR-1).
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { EditWorkspaceChangedFile, EditWorkspaceChanges } from '@overdeck/contracts';

import { resolveEditWorkspace, type EditWorkspaceDeps } from './edit-workspace.js';
import { baseRefFor } from './edit-workspace-pr.js';
import { runGit } from './git-exec.js';

const UNTRACKED_READ_MAX = 2 * 1024 * 1024;
/** git's own binary test looks for a NUL in the first 8000-odd bytes. */
const BINARY_SNIFF_BYTES = 8192;

type Git = typeof runGit;

function fields(out: Buffer): string[] {
  return out.toString('utf8').split('\0').filter((f) => f !== '');
}

async function gitOk(git: Git, cwd: string, args: string[]): Promise<Buffer> {
  const result = await git(cwd, args);
  if (result.code !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

/** Tracked files against the base: `--numstat -z` and `--name-status -z`, renames split. */
async function trackedFiles(git: Git, cwd: string, base: string): Promise<EditWorkspaceChangedFile[]> {
  const counts = new Map<string, { additions: number; deletions: number; binary: boolean }>();
  for (const record of fields(await gitOk(git, cwd, ['diff', '--numstat', '-z', '--no-renames', base]))) {
    const [add, del, ...rest] = record.split('\t');
    const path = rest.join('\t');
    const binary = add === '-' || del === '-';
    counts.set(path, { additions: binary ? 0 : Number(add), deletions: binary ? 0 : Number(del), binary });
  }
  const names = fields(await gitOk(git, cwd, ['diff', '--name-status', '-z', '--no-renames', base]));
  const files: EditWorkspaceChangedFile[] = [];
  for (let i = 0; i + 1 < names.length; i += 2) {
    const letter = names[i]![0];
    const path = names[i + 1]!;
    const status = letter === 'A' ? 'A' : letter === 'D' ? 'D' : 'M';
    files.push({ path, status, ...(counts.get(path) ?? { additions: 0, deletions: 0, binary: false }) });
  }
  return files;
}

/** An untracked file: its line count, or binary 0/0 when it has a NUL early, is too large or cannot be read. */
async function untrackedFile(cwd: string, path: string): Promise<EditWorkspaceChangedFile> {
  const binary: EditWorkspaceChangedFile = { path, status: 'A', additions: 0, deletions: 0, binary: true };
  try {
    const abs = join(cwd, path);
    const info = await stat(abs);
    if (!info.isFile() || info.size > UNTRACKED_READ_MAX) return binary;
    const bytes = await readFile(abs);
    if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return binary;
    const text = bytes.toString('utf8');
    const rows = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    return { path, status: 'A', additions: rows, deletions: 0, binary: false };
  } catch {
    return binary;
  }
}

/** Paths from `git status --porcelain=v2 -z --untracked-files=all` records 1, 2, u and ?; a rename lists both paths. */
function statusPaths(out: Buffer): string[] {
  const records = out.toString('utf8').split('\0');
  const paths: string[] = [];
  const after = (record: string, skip: number): string => record.split(' ').slice(skip).join(' ');
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    const kind = record[0];
    if (kind === '1') paths.push(after(record, 8));
    else if (kind === '2') {
      paths.push(after(record, 9));
      // The original path follows in its own field; committing removes it, so it is uncommitted too.
      const original = records[i + 1];
      if (original) paths.push(original);
      i += 1;
    } else if (kind === 'u') paths.push(after(record, 10));
    else if (kind === '?') paths.push(record.slice(2));
  }
  return paths;
}

export async function getEditWorkspaceChanges(
  workspaceId: string,
  deps: EditWorkspaceDeps = {},
): Promise<EditWorkspaceChanges> {
  const { root } = await resolveEditWorkspace(workspaceId, deps);
  const git = deps.runGit ?? runGit;
  const cwd = root.absPath;

  const mergeBase = await git(cwd, ['merge-base', 'HEAD', baseRefFor(root.defaultBranch)]);
  // A killed run says nothing about the base; only a git answer of "none" falls back to HEAD.
  if (mergeBase.timedOut || mergeBase.truncated || mergeBase.code === null) {
    throw new Error(`git merge-base did not finish: ${mergeBase.stderr.trim() || 'timed out'}`);
  }
  const base = mergeBase.code === 0 ? mergeBase.stdout.toString('utf8').trim() || 'HEAD' : 'HEAD';

  const files = await trackedFiles(git, cwd, base);
  for (const path of fields(await gitOk(git, cwd, ['ls-files', '--others', '--exclude-standard', '-z']))) {
    files.push(await untrackedFile(cwd, path));
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const uncommittedPaths = statusPaths(await gitOk(git, cwd, ['status', '--porcelain=v2', '-z', '--untracked-files=all']));
  return {
    base,
    files,
    additions: files.reduce((sum, f) => sum + f.additions, 0),
    deletions: files.reduce((sum, f) => sum + f.deletions, 0),
    uncommittedPaths,
  };
}

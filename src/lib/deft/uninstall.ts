/**
 * Undo a temporary Deft Directive install (PAN-4820 WI-3).
 *
 * Reads the snapshot that `installDeftIntoWorktree` wrote and puts the
 * worktree back byte for byte: tracked files lose `--skip-worktree` and get
 * their pre-install content, created paths are deleted, pre-existing
 * untracked or ignored files get their pre-install bytes, and only the
 * `@deftai` package leaves a pre-existing `node_modules/`. The worktree
 * hooks path and exclude file go away; `extensions.worktreeConfig` stays on
 * (AD-17). The snapshot is deleted last, so an interrupted undo can run again.
 *
 * Directive's own uninstaller is not used: it keeps `xbrief/` and settings,
 * and the snapshot is exact.
 */
import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { installPreRebaseHook } from '../workspace-manager/worktree-ops.js';
import { deftExcludeFilePath } from './install.js';
import { deftSnapshotPath, readDeftSnapshot, touchedDeftDir } from './install-snapshot.js';

const execFileAsync = promisify(execFile);

export interface DeftRemoveResult {
  /** Created paths and package directories deleted. */
  removed: string[];
  /** Files written back with their pre-install bytes. */
  restored: string[];
  /** Snapshot paths that resolve outside the worktree (or to the worktree itself); left alone. */
  refused: string[];
}

/** The absolute path of `path` inside `worktree`, or null when it escapes or names the worktree itself. */
function insideWorktree(worktree: string, path: string): string | null {
  const root = resolve(worktree);
  const full = resolve(root, path);
  const rel = relative(root, full);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return full;
}

async function git(worktree: string, args: string[]): Promise<string> {
  return (await execFileAsync('git', args, { cwd: worktree })).stdout;
}

/** `git config --worktree --unset <key>`; exit 5 means the key was not set. */
async function unsetWorktreeConfig(worktree: string, key: string): Promise<void> {
  try {
    await git(worktree, ['config', '--worktree', '--unset', key]);
  } catch (error) {
    if ((error as { code?: unknown }).code !== 5) throw error;
  }
}

async function restoreFile(worktree: string, path: string, contentB64: string, result: DeftRemoveResult): Promise<void> {
  const full = insideWorktree(worktree, path);
  if (!full) {
    result.refused.push(path);
    return;
  }
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, Buffer.from(contentB64, 'base64'));
  result.restored.push(path);
}

async function removePath(worktree: string, path: string, result: DeftRemoveResult): Promise<void> {
  const full = insideWorktree(worktree, path);
  if (!full) {
    result.refused.push(path);
    return;
  }
  await rm(full, { recursive: true, force: true });
  result.removed.push(path);
}

export async function removeDeftInstall(worktree: string): Promise<DeftRemoveResult> {
  const result: DeftRemoveResult = { removed: [], restored: [], refused: [] };
  const snapshot = await readDeftSnapshot(worktree);
  if (!snapshot) return result;

  // Tracked files: visible to git again, with their pre-install bytes.
  for (const entry of snapshot.modifiedTracked) {
    if (!insideWorktree(worktree, entry.path)) {
      result.refused.push(entry.path);
      continue;
    }
    await git(worktree, ['update-index', '--no-skip-worktree', '--', entry.path]);
    await restoreFile(worktree, entry.path, entry.restoreContentB64, result);
  }

  for (const path of snapshot.createdPaths) await removePath(worktree, path, result);
  for (const entry of snapshot.modifiedUntracked) await restoreFile(worktree, entry.path, entry.restoreContentB64, result);
  for (const entry of snapshot.touchedPreexisting) await removePath(worktree, touchedDeftDir(entry), result);
  await rm(join(worktree, '.overdeck', 'deft-run-summary.jsonl'), { force: true });
  await rm(join(worktree, '.overdeck', 'deft-lift'), { recursive: true, force: true });

  await unsetWorktreeConfig(worktree, 'core.hooksPath');
  await unsetWorktreeConfig(worktree, 'core.excludesFile');
  // Delete the exclude file install writes, never the snapshot's recorded path:
  // the snapshot sits in the worktree, so its paths are not trusted.
  await rm(await deftExcludeFilePath(worktree), { force: true });

  await installPreRebaseHook(worktree);
  await rm(deftSnapshotPath(worktree), { force: true });
  return result;
}

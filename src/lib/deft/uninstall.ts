/**
 * Undo a temporary Deft Directive install (PAN-4820 WI-3).
 *
 * Reads the snapshot that `installDeftIntoWorktree` wrote and puts the
 * worktree back byte for byte: tracked files lose `--skip-worktree` and get
 * their pre-install content, created paths are deleted, pre-existing
 * untracked or ignored files get their pre-install bytes, and only the
 * `@deftai` package leaves a pre-existing `node_modules/`. The worktree
 * hooks path and the `deft` exclude block go away (the exclude file and
 * `core.excludesFile` stay while another owner, such as SageOx, still has a
 * block); `extensions.worktreeConfig` stays on (AD-17). The snapshot is deleted last, so an interrupted undo can run again.
 *
 * Every path comes from a file inside the worktree, so none is trusted: each
 * one must resolve inside the worktree by realpath (a symlinked directory
 * cannot lead out), and a file is never written through a symlink.
 *
 * Without a readable snapshot the exact undo is impossible. The recovery
 * path then makes everything visible again instead: it clears the
 * skip-worktree flags, the worktree hooks path and the exclude file, and
 * reports `snapshotMissing` so the operator can review `git status`.
 *
 * Directive's own uninstaller is not used: it keeps `xbrief/` and settings,
 * and the snapshot is exact.
 */
import { execFile } from 'node:child_process';
import { lstat, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { readExcludeBlock, removeExcludeBlock } from '../git/worktree-exclude.js';
import { installPreRebaseHook } from '../workspace-manager/worktree-ops.js';
import {
  type DeftInstallSnapshot,
  deftSnapshotPath,
  legacyDeftExcludeFilePath,
  readDeftSnapshot,
  touchedDeftDir,
} from './install-snapshot.js';

const execFileAsync = promisify(execFile);

export interface DeftRemoveResult {
  /** Created paths and package directories deleted. */
  removed: string[];
  /** Files written back with their pre-install bytes. */
  restored: string[];
  /** Snapshot paths that resolve outside the worktree (or to the worktree itself, or through a symlink); left alone. */
  refused: string[];
  /** No readable snapshot, but install traces were cleared; the install's files are visible to git again. */
  snapshotMissing?: boolean;
  /** Tracked files whose skip-worktree flag the recovery path cleared, with the install's content still in place. */
  unhidden?: string[];
}

/** The parts of a snapshot the undo needs. */
export type DeftUndoPlan = Pick<DeftInstallSnapshot, 'createdPaths' | 'modifiedTracked' | 'modifiedUntracked' | 'touchedPreexisting'>;

function within(root: string, full: string): boolean {
  const rel = relative(root, full);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/** The realpath of `path`, or of its nearest existing ancestor joined with the rest. */
async function realpathOfNearest(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    const parent = dirname(path);
    if (parent === path) return path;
    return join(await realpathOfNearest(parent), path.slice(parent.length + 1));
  }
}

async function isSymlink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * The absolute path of `path` inside `worktree`, or null when it escapes the
 * worktree lexically or by realpath, names the worktree itself, or (for a
 * write) is a symlink that a write would follow.
 */
async function confined(worktree: string, path: string, forWrite: boolean): Promise<string | null> {
  const root = resolve(worktree);
  const full = resolve(root, path);
  if (!within(root, full)) return null;
  const realRoot = await realpathOfNearest(root);
  // The parent decides where the entry lives; the entry itself may be a symlink, which rm removes as a link.
  const realParent = await realpathOfNearest(dirname(full));
  if (realParent !== realRoot && !within(realRoot, realParent)) return null;
  if (forWrite && (await isSymlink(full))) return null;
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

async function worktreeConfig(worktree: string, key: string): Promise<string | null> {
  try {
    return (await git(worktree, ['config', '--worktree', '--get', key])).trim() || null;
  } catch {
    return null;
  }
}

async function restoreFile(worktree: string, path: string, contentB64: string, result: DeftRemoveResult): Promise<void> {
  const full = await confined(worktree, path, true);
  if (!full) {
    result.refused.push(path);
    return;
  }
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, Buffer.from(contentB64, 'base64'));
  result.restored.push(path);
}

async function removePath(worktree: string, path: string, result: DeftRemoveResult): Promise<void> {
  const full = await confined(worktree, path, false);
  if (!full) {
    result.refused.push(path);
    return;
  }
  await rm(full, { recursive: true, force: true });
  result.removed.push(path);
}

/** Drop the worktree hooks path and the `deft` exclude block, and point the rebase guard back at the normal hooks path. */
async function clearWorktreeWiring(worktree: string): Promise<void> {
  await unsetWorktreeConfig(worktree, 'core.hooksPath');
  await removeExcludeBlock(worktree, 'deft');
  // An install from before PAN-4852 wrote its own file. Its computed path, never
  // a recorded one: the snapshot sits in the worktree, so its paths are not trusted.
  const legacy = await legacyDeftExcludeFilePath(worktree);
  if ((await worktreeConfig(worktree, 'core.excludesFile')) === legacy) await unsetWorktreeConfig(worktree, 'core.excludesFile');
  await rm(legacy, { force: true });
  await installPreRebaseHook(worktree);
}

/**
 * Put back everything `plan` records, then clear the worktree wiring. Used by
 * {@link removeDeftInstall} and by the install's own rollback.
 */
export async function undoDeftChanges(worktree: string, plan: DeftUndoPlan): Promise<DeftRemoveResult> {
  const result: DeftRemoveResult = { removed: [], restored: [], refused: [] };

  // Tracked files: visible to git again, with their pre-install bytes.
  for (const entry of plan.modifiedTracked) {
    if (!(await confined(worktree, entry.path, true))) {
      result.refused.push(entry.path);
      continue;
    }
    await git(worktree, ['update-index', '--no-skip-worktree', '--', entry.path]);
    await restoreFile(worktree, entry.path, entry.restoreContentB64, result);
  }

  for (const path of plan.createdPaths) await removePath(worktree, path, result);
  for (const entry of plan.modifiedUntracked) await restoreFile(worktree, entry.path, entry.restoreContentB64, result);
  for (const entry of plan.touchedPreexisting) await removePath(worktree, touchedDeftDir(entry), result);
  await rm(join(worktree, '.overdeck', 'deft-run-summary.jsonl'), { force: true });
  await rm(join(worktree, '.overdeck', 'deft-lift'), { recursive: true, force: true });

  await clearWorktreeWiring(worktree);
  return result;
}

/** Tracked paths with the skip-worktree flag (`git ls-files -v` tag `S`). */
async function skipWorktreePaths(worktree: string): Promise<string[]> {
  return (await git(worktree, ['ls-files', '-v', '-z']))
    .split('\0')
    .filter(line => line.startsWith('S '))
    .map(line => line.slice(2));
}

/**
 * No readable snapshot: make the install visible instead of guessing. Clears
 * the skip-worktree flags, the worktree hooks path and the exclude file.
 * Returns null when the worktree carries none of Deft's wiring.
 */
async function recoverWithoutSnapshot(worktree: string): Promise<DeftRemoveResult | null> {
  // Only Deft's own wiring proves an install; a user's unrelated skip-worktree files are left alone otherwise.
  const hooksPath = await worktreeConfig(worktree, 'core.hooksPath');
  const excludesFile = await worktreeConfig(worktree, 'core.excludesFile');
  const wired =
    hooksPath === '.githooks' ||
    excludesFile === (await legacyDeftExcludeFilePath(worktree)) ||
    (await readExcludeBlock(worktree, 'deft')) !== null;
  if (!wired) return null;
  const unhidden = await skipWorktreePaths(worktree);
  if (unhidden.length > 0) await git(worktree, ['update-index', '--no-skip-worktree', '--', ...unhidden]);
  await clearWorktreeWiring(worktree);
  return { removed: [], restored: [], refused: [], snapshotMissing: true, unhidden };
}

export async function removeDeftInstall(worktree: string): Promise<DeftRemoveResult> {
  const snapshot = await readDeftSnapshot(worktree);
  if (!snapshot) return (await recoverWithoutSnapshot(worktree)) ?? { removed: [], restored: [], refused: [] };
  const result = await undoDeftChanges(worktree, snapshot);
  await rm(deftSnapshotPath(worktree), { force: true });
  return result;
}

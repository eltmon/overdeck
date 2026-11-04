/**
 * The record of a temporary Deft Directive install in one worktree (PAN-4820
 * WI-2): what the install created or changed, and what it takes to undo it.
 *
 * Stored at `<worktree>/.overdeck/deft-install.json`. The install writes it
 * after hiding the deposit from git; the undo (`removeDeftInstall`) reads it
 * and deletes it last. Its presence means "this worktree carries a hidden
 * Directive install".
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface DeftInstallSnapshot {
  version: 1;
  issueId: string;
  installedAt: string;
  /** From package.json devDependencies['@deftai/directive-runtime']. */
  runtimeVersion: string | null;
  /** Paths that did not exist before install (relative, '/'-separated; dirs end with '/'). */
  createdPaths: string[];
  /** Tracked paths whose content install changed; skip-worktree'd. */
  modifiedTracked: Array<{ path: string; restoreContentB64: string; postInstallSha256: string; baseBlob: string }>;
  /** Pre-existing untracked or ignored files whose content install changed (for example an ignored .claude/settings.json). */
  modifiedUntracked: Array<{ path: string; restoreContentB64: string; postInstallSha256: string }>;
  /** Pre-existing untracked/ignored directories install wrote into (for example node_modules/): never deleted wholesale. */
  touchedPreexisting: string[];
  /** Value of `git config --local --get core.hooksPath` before install. */
  sharedHooksPathBefore: string | null;
  /**
   * Absolute path of the worktree exclude file holding the `deft` block
   * (`<gitdir>/info/overdeck-exclude`); `<gitdir>/info/overdeck-deft-exclude`
   * for installs made before PAN-4852.
   */
  excludeFile: string;
  /**
   * Hidden tracked files whose install change could not be merged onto a new
   * base during a lifted rebase or sync (WI-4); they keep the install's bytes.
   */
  liftConflicts?: string[];
}

/**
 * The Directive package directory inside a pre-existing untracked or ignored
 * directory: `node_modules/@deftai` for a `node_modules/` entry, else
 * `<entry>/node_modules/@deftai`. Install records the entry; undo removes
 * only this directory.
 */
export function touchedDeftDir(entry: string): string {
  return entry === 'node_modules/' || entry.endsWith('/node_modules/')
    ? join(entry, '@deftai')
    : join(entry, 'node_modules', '@deftai');
}

/**
 * `<gitdir>/info/overdeck-deft-exclude`, the Deft-only exclude file installs
 * wrote before PAN-4852 moved the hide into `src/lib/git/worktree-exclude.ts`.
 * Uninstall still clears it; the git dir is per worktree.
 */
export async function legacyDeftExcludeFilePath(worktree: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: worktree });
  return join(resolve(worktree, stdout.trim()), 'info', 'overdeck-deft-exclude');
}

export function deftSnapshotPath(worktree: string): string {
  return join(worktree, '.overdeck', 'deft-install.json');
}

function isSnapshot(value: unknown): value is DeftInstallSnapshot {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return (
    s.version === 1 &&
    typeof s.issueId === 'string' &&
    Array.isArray(s.createdPaths) &&
    Array.isArray(s.modifiedTracked) &&
    Array.isArray(s.modifiedUntracked) &&
    Array.isArray(s.touchedPreexisting) &&
    typeof s.excludeFile === 'string'
  );
}

/** The worktree's snapshot, or null when there is none or it cannot be parsed. */
export async function readDeftSnapshot(worktree: string): Promise<DeftInstallSnapshot | null> {
  let text: string;
  try {
    text = await readFile(deftSnapshotPath(worktree), 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Write the snapshot atomically (temp file, then rename). */
export async function writeDeftSnapshot(worktree: string, s: DeftInstallSnapshot): Promise<void> {
  const path = deftSnapshotPath(worktree);
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(s, null, 2)}\n`, 'utf8');
  await rename(temp, path);
}

/**
 * Lift a hidden Deft Directive install around a git operation (PAN-4820 WI-4).
 *
 * `git rebase` and `git merge` abort when the target branch changed a
 * `--skip-worktree` file, and Deft's pre-push hook refuses Overdeck's own
 * pushes. So for the duration of a rebase or sync-main, the hidden tracked
 * files go back to their HEAD content and the worktree hooks path is unset.
 * Afterwards the install's bytes go back on top: unchanged when the file's
 * base did not move, else a three-way `git merge-file` of the new HEAD, the
 * old base, and the install's bytes. A conflict keeps the install's bytes and
 * is recorded in `snapshot.liftConflicts`.
 *
 * Created paths stay hidden by the worktree exclude file throughout. A target
 * that now tracks one of them is refused: switch the issue back to Overdeck.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { readDeftSnapshot, writeDeftSnapshot } from './install-snapshot.js';

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

export class DeftLiftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeftLiftError';
  }
}

async function git(worktree: string, args: string[]): Promise<string> {
  return (await execFileAsync('git', args, { cwd: worktree, maxBuffer: MAX_BUFFER })).stdout;
}

async function gitBytes(worktree: string, args: string[]): Promise<Buffer> {
  return (await execFileAsync('git', args, { cwd: worktree, encoding: 'buffer', maxBuffer: MAX_BUFFER })).stdout;
}

async function gitSucceeds(worktree: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync('git', args, { cwd: worktree });
    return true;
  } catch {
    return false;
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** `git merge-file -p current base other`: the merged bytes, or null on conflict. */
async function mergeThreeWay(worktree: string, path: string, current: Buffer, base: Buffer, other: Buffer): Promise<Buffer | null> {
  const dir = join(worktree, '.overdeck', 'deft-lift');
  await mkdir(dir, { recursive: true });
  const stem = createHash('sha256').update(path).digest('hex').slice(0, 16);
  const files = { current: join(dir, `${stem}.current`), base: join(dir, `${stem}.base`), other: join(dir, `${stem}.other`) };
  await Promise.all([writeFile(files.current, current), writeFile(files.base, base), writeFile(files.other, other)]);
  try {
    const { stdout } = await execFileAsync('git', ['merge-file', '-p', files.current, files.base, files.other], {
      cwd: worktree,
      encoding: 'buffer',
      maxBuffer: MAX_BUFFER,
    });
    return stdout;
  } catch (error) {
    // A positive exit is the conflict count; anything else is a real failure.
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'number' && code > 0) return null;
    throw error;
  } finally {
    await Promise.all(Object.values(files).map(file => rm(file, { force: true })));
  }
}

/**
 * Run `fn` with the worktree's hidden install lifted. Without a snapshot this
 * runs `fn` alone and touches nothing.
 */
export async function withDeftInstallLifted<T>(worktree: string, targetRef: string, fn: () => Promise<T>): Promise<T> {
  const snapshot = await readDeftSnapshot(worktree);
  if (!snapshot) return fn();

  // Check the target as the operation will see it: callers fetch inside `fn`,
  // so a stale remote ref would miss a path main only now tracks. Best effort:
  // when the fetch fails, the operation's own fetch fails the same way.
  const remoteBranch = /^origin\/(.+)$/.exec(targetRef)?.[1];
  if (remoteBranch) await gitSucceeds(worktree, ['fetch', '-q', 'origin', remoteBranch]);

  for (const path of snapshot.createdPaths) {
    const object = path.endsWith('/') ? path.slice(0, -1) : path;
    if (await gitSucceeds(worktree, ['cat-file', '-e', `${targetRef}:${object}`])) {
      throw new DeftLiftError(`main now tracks Deft install path ${path}; switch the issue back to Overdeck`);
    }
  }

  // Prepare: hidden tracked files back to HEAD, Deft's hooks off.
  const saved = new Map<string, Buffer>();
  for (const entry of snapshot.modifiedTracked) {
    saved.set(entry.path, await readFile(join(worktree, entry.path)));
    await git(worktree, ['update-index', '--no-skip-worktree', '--', entry.path]);
    await git(worktree, ['checkout', 'HEAD', '--', entry.path]);
  }
  await gitSucceeds(worktree, ['config', '--worktree', '--unset', 'core.hooksPath']);

  try {
    return await fn();
  } finally {
    const conflicts = new Set(snapshot.liftConflicts ?? []);
    for (const entry of snapshot.modifiedTracked) {
      const other = saved.get(entry.path);
      if (!other) continue;
      const headBlob = (await git(worktree, ['rev-parse', `HEAD:${entry.path}`])).trim();
      let bytes = other;
      if (headBlob !== entry.baseBlob) {
        const current = await gitBytes(worktree, ['show', `HEAD:${entry.path}`]);
        const base = await gitBytes(worktree, ['cat-file', 'blob', entry.baseBlob]);
        const merged = await mergeThreeWay(worktree, entry.path, current, base, other);
        if (merged === null) {
          conflicts.add(entry.path);
        } else {
          bytes = merged;
          entry.baseBlob = headBlob;
          entry.restoreContentB64 = current.toString('base64');
          entry.postInstallSha256 = sha256(merged);
          conflicts.delete(entry.path);
        }
      }
      await mkdir(dirname(join(worktree, entry.path)), { recursive: true });
      await writeFile(join(worktree, entry.path), bytes);
      await git(worktree, ['update-index', '--skip-worktree', '--', entry.path]);
    }
    await git(worktree, ['config', '--worktree', 'core.hooksPath', '.githooks']);
    if (conflicts.size > 0) snapshot.liftConflicts = [...conflicts].sort();
    else delete snapshot.liftConflicts;
    await writeDeftSnapshot(worktree, snapshot);
  }
}

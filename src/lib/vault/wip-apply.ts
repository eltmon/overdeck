/**
 * Session Vault WIP apply (PAN-4329, anywhere-accounts design 6.7).
 *
 * Recreate a captured code snapshot on the continuing machine: download and
 * decrypt the bundle parts, fetch origin (the bundle's prerequisite commits
 * may be newer than this clone), verify and unbundle into a temporary
 * `refs/overdeck/wip/<vaultId>`, check the branch out at the snapshot's base
 * (D-12: no branch ever moves backward or loses commits), then apply the
 * base..wip diff so every change lands unstaged. The temporary ref is always
 * deleted.
 *
 * A dirty checkout is never written to: `applyWipSnapshot` returns `dirty`
 * before any git call that could change it, and `applyWipSnapshotInWorktree`
 * applies into a fresh worktree instead, leaving the dirty checkout's index,
 * worktree and stash untouched.
 *
 * Imports only Node built-ins and sibling vault modules (NFR-1).
 */
import { mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readCwdState } from './cwd-state.js';
import { decodeWipParts, VaultAuthenticationError, type SessionRecord, type WipSnapshotRef } from './format.js';
import type { VaultSubkeys } from './identity.js';
import type { VaultStore } from './store/types.js';
import { buildWipCommit, latestWipEntry, runWipGit, WipGitError, type CapturedWip } from './wip-capture.js';

export type { CapturedWip } from './wip-capture.js';

export type WipApplyResult =
  | { status: 'applied'; cwd: string; head: string; branch: string | null; note?: string }
  | { status: 'dirty'; cwd: string }
  | { status: 'failed'; reason: string };

export interface ApplyWipOptions {
  cwd: string;
  vaultId: string;
  wip: CapturedWip;
  store: VaultStore;
  keys: VaultSubkeys;
}

export interface ApplyWipInWorktreeOptions {
  /** The (possibly dirty) checkout whose repository receives the new worktree. */
  repoCwd: string;
  /** The new worktree's directory; must not exist yet (or be empty). */
  worktreeDir: string;
  vaultId: string;
  wip: CapturedWip;
  store: VaultStore;
  keys: VaultSubkeys;
}

/** The record's latest WIP entry (D-11): what resume applies or reports. */
export function findLatestWip(record: SessionRecord): WipSnapshotRef | null {
  return latestWipEntry(record.settlements);
}

/**
 * True when the checkout at `cwd` already holds exactly this snapshot: same
 * base and the same working tree (minus ignored files). Resume then has
 * nothing to apply, even when the checkout is dirty.
 */
export async function isWipPresent(cwd: string, wip: CapturedWip): Promise<boolean> {
  let commit: Awaited<ReturnType<typeof buildWipCommit>>;
  try {
    commit = await buildWipCommit(cwd);
  } catch {
    return false;
  }
  if (commit === null) return false;
  try {
    return commit.base === wip.base && commit.tree === wip.tree;
  } finally {
    await commit.cleanup();
  }
}

/** An apply step failed; `message` is the operator-facing reason. */
class ApplyFailure extends Error {}

async function tryGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await runWipGit(cwd, args);
  } catch {
    return null;
  }
}

async function git(cwd: string, args: string[], context: string): Promise<string> {
  try {
    return await runWipGit(cwd, args);
  } catch (error) {
    throw new ApplyFailure(`${context}: ${(error as Error).message}`);
  }
}

function wipRef(vaultId: string): string {
  return `refs/overdeck/wip/${vaultId}`;
}

/**
 * Download, decrypt and unbundle the snapshot into `wipRef(vaultId)` of the
 * repository at `root`, after fetching origin so the bundle's prerequisites
 * exist (D-15). Checks the fetched commit against the record (D-13).
 */
async function unbundle(root: string, dir: string, options: Omit<ApplyWipOptions, 'cwd'>): Promise<string> {
  const { vaultId, wip, store, keys } = options;
  const parts: Array<{ id: string; bytes: Uint8Array }> = [];
  for (const id of wip.objects) {
    const bytes = await store.getObject(id);
    if (bytes === null) throw new ApplyFailure(`code snapshot object ${id} is missing from the backend`);
    parts.push({ id, bytes });
  }
  let bundle: Buffer;
  try {
    bundle = await decodeWipParts(parts, keys);
  } catch (error) {
    if (error instanceof VaultAuthenticationError) {
      throw new ApplyFailure(`code snapshot failed authentication: ${error.message}`);
    }
    throw error;
  }
  const bundlePath = join(dir, 'wip.bundle');
  await writeFile(bundlePath, bundle);

  if ((await tryGit(root, ['remote', 'get-url', 'origin'])) !== null) {
    await tryGit(root, ['fetch', '--quiet', 'origin']);
  }
  try {
    await runWipGit(root, ['bundle', 'verify', bundlePath]);
  } catch (error) {
    throw new ApplyFailure(
      `This code snapshot needs commits your clone does not have and could not fetch from origin: ${(error as Error).message}`,
    );
  }
  const heads = (await git(root, ['bundle', 'list-heads', bundlePath], 'cannot read the code snapshot'))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (heads.length !== 1) throw new ApplyFailure(`code snapshot has ${heads.length} heads; expected exactly one`);
  const head = heads[0]!.split(/\s+/)[1] ?? '';
  const ref = wipRef(vaultId);
  await git(root, ['fetch', '--quiet', '--no-tags', bundlePath, `+${head}:${ref}`], 'cannot unbundle the code snapshot');
  const tree = (await git(root, ['rev-parse', `${ref}^{tree}`], 'cannot read the code snapshot')).trim();
  const parent = (await tryGit(root, ['rev-parse', '--verify', '--quiet', `${ref}^`]))?.trim();
  if (tree !== wip.tree || parent !== wip.base) throw new ApplyFailure('snapshot does not match its record');
  return ref;
}

/** Path of another worktree that has `branch` checked out, or null. */
async function branchCheckedOutElsewhere(workCwd: string, branch: string): Promise<string | null> {
  const here = await realpath((await git(workCwd, ['rev-parse', '--show-toplevel'], 'cannot read the checkout')).trim());
  const listing = await git(workCwd, ['worktree', 'list', '--porcelain'], 'cannot list worktrees');
  let path: string | null = null;
  for (const line of listing.split('\n')) {
    if (line.startsWith('worktree ')) path = line.slice('worktree '.length);
    else if (line === `branch refs/heads/${branch}` && path !== null) {
      const resolved = await realpath(path).catch(() => path!);
      if (resolved !== here) return path;
    }
  }
  return null;
}

/** D-12: leave HEAD at `base`, on `branch` when that is safe. Returns a note when HEAD ends detached for a reason. */
async function checkoutBase(workCwd: string, wip: CapturedWip): Promise<string | undefined> {
  const { base, branch } = wip;
  const detach = async (note?: string) => {
    await git(workCwd, ['switch', '--quiet', '--detach', base], 'cannot check out the snapshot base');
    return note;
  };
  if (branch === null) return detach();
  const tip = (await tryGit(workCwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]))?.trim();
  if (!tip) {
    await git(workCwd, ['switch', '--quiet', '-c', branch, base], `cannot create branch ${branch}`);
    return undefined;
  }
  const elsewhere = await branchCheckedOutElsewhere(workCwd, branch);
  if (elsewhere !== null) {
    return detach(`Branch ${branch} is checked out in another worktree (${elsewhere}); HEAD is detached at ${base.slice(0, 12)}.`);
  }
  if (tip === base) {
    await git(workCwd, ['switch', '--quiet', branch], `cannot switch to ${branch}`);
    return undefined;
  }
  if ((await tryGit(workCwd, ['merge-base', '--is-ancestor', tip, base])) !== null) {
    await git(workCwd, ['switch', '--quiet', branch], `cannot switch to ${branch}`);
    await git(workCwd, ['merge', '--quiet', '--ff-only', base], `cannot fast-forward ${branch}`);
    return undefined;
  }
  return detach(
    `Local branch ${branch} has commits the snapshot lacks; it was left as is and HEAD is detached at ${base.slice(0, 12)}.`,
  );
}

/** Check out the base in `workCwd`, then apply base..ref there as unstaged changes. */
async function checkoutAndApply(workCwd: string, dir: string, wip: CapturedWip, ref: string): Promise<WipApplyResult> {
  const note = await checkoutBase(workCwd, wip);
  const patchPath = join(dir, 'wip.patch');
  await git(workCwd, [
    'diff', '--binary', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames',
    '--src-prefix=a/', '--dst-prefix=b/', `--output=${patchPath}`, wip.base, ref,
  ], 'cannot build the snapshot diff');
  if ((await stat(patchPath)).size > 0) {
    await git(workCwd, ['apply', patchPath], 'cannot apply the code snapshot');
  }
  const head = (await git(workCwd, ['rev-parse', 'HEAD'], 'cannot read HEAD')).trim();
  const branch = (await git(workCwd, ['branch', '--show-current'], 'cannot read the branch')).trim();
  return { status: 'applied', cwd: workCwd, head, branch: branch.length > 0 ? branch : null, ...(note ? { note } : {}) };
}

function failure(error: unknown): WipApplyResult {
  if (error instanceof ApplyFailure || error instanceof WipGitError) return { status: 'failed', reason: error.message };
  throw error;
}

/**
 * Apply `wip` in the checkout at `cwd` (FR-9). A dirty checkout returns
 * `dirty` untouched; the caller then offers `applyWipSnapshotInWorktree`.
 */
export async function applyWipSnapshot(options: ApplyWipOptions): Promise<WipApplyResult> {
  const state = await readCwdState(options.cwd);
  if (state === null) return { status: 'failed', reason: 'not a git work tree' };
  if (state.dirty) return { status: 'dirty', cwd: options.cwd };
  const root = (await runWipGit(options.cwd, ['rev-parse', '--show-toplevel'])).trim();
  const dir = await mkdtemp(join(tmpdir(), 'overdeck-wip-'));
  let ref: string | null = null;
  try {
    ref = await unbundle(root, dir, options);
    const result = await checkoutAndApply(root, dir, options.wip, ref);
    return result.status === 'applied' ? { ...result, cwd: options.cwd } : result;
  } catch (error) {
    return failure(error);
  } finally {
    if (ref !== null) await tryGit(root, ['update-ref', '-d', ref]);
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Apply `wip` into a new worktree at `worktreeDir` of the repository at
 * `repoCwd` (D-14). Only refs and objects of `repoCwd` change; its index,
 * worktree and stash are left as they are.
 */
export async function applyWipSnapshotInWorktree(options: ApplyWipInWorktreeOptions): Promise<WipApplyResult> {
  const state = await readCwdState(options.repoCwd);
  if (state === null) return { status: 'failed', reason: 'not a git work tree' };
  const root = (await runWipGit(options.repoCwd, ['rev-parse', '--show-toplevel'])).trim();
  const worktreeDir = resolve(options.worktreeDir);
  const dir = await mkdtemp(join(tmpdir(), 'overdeck-wip-'));
  let ref: string | null = null;
  try {
    ref = await unbundle(root, dir, options);
    await git(root, ['worktree', 'add', '--quiet', '--detach', worktreeDir, options.wip.base], `cannot create a worktree at ${worktreeDir}`);
    return await checkoutAndApply(worktreeDir, dir, options.wip, ref);
  } catch (error) {
    return failure(error);
  } finally {
    if (ref !== null) await tryGit(root, ['update-ref', '-d', ref]);
    await rm(dir, { recursive: true, force: true });
  }
}

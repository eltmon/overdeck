/**
 * Session Vault git backend (PAN-2609, PRD decision P-4).
 *
 * A local clone at `${OVERDECK_HOME}/vault/git/` tracks branch `main` of the
 * user's own remote. Every git call is a promisified `execFile` with
 * `GIT_TERMINAL_PROMPT=0`; credentials come from the user's git setup.
 *
 * - `putObjects` writes files into the clone without committing.
 * - `casRef` runs: fetch, `reset --hard origin/main` (this is the vault's own
 *   clone, never a project repo), compare the ref file's blob SHA with the
 *   expected version, write the ref, commit the pending objects and the ref
 *   in one commit, push. A non-fast-forward rejection repeats the cycle up to
 *   three times, then returns `conflict`. A network failure resets the clone
 *   to `origin/main` and throws `VaultOfflineError`, so no local commit ever
 *   outlives a failed push and there is never a divergent history to rebase.
 * - `putSlot` overwrites or deletes a reserved slot (`objects/keywrap/v1`)
 *   and commits and pushes only that path, with the same refresh, retry and
 *   offline-reset rules as `casRef`. Last write wins; there is no CAS.
 * - On a fresh empty remote there is no `origin/main`: fetch/reset are
 *   skipped, every ref has version `null`, and the first push creates `main`.
 *
 * Every process on the machine shares this one clone (Stop hooks, `save`,
 * `sync`, the dashboard timer), so the whole fetch/reset/write/commit/push
 * cycle, and every object write, runs under a cross-process lock file next to
 * the clone (`<clone>.lock`). Without it one process's `reset --hard` reverts
 * another's ref write and the CAS reports `conflict` for a value that landed.
 *
 * Never `git stash`; never touches any repository other than the vault clone.
 * Imports only Node built-ins and sibling vault modules.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { vaultDir } from '../config.js';
import { withFileLock } from '../file-lock.js';
import {
  VAULT_FORMAT_MARKER,
  VAULT_FORMAT_MARKER_FILE,
  VaultOfflineError,
  assertNotSlotName,
  assertRefName,
  assertSlotName,
  objectRelativePath,
  type CasResult,
  type VaultRef,
  type VaultStore,
} from './types.js';

const execFileAsync = promisify(execFile);

export const GIT_VAULT_BRANCH = 'main';
const CAS_ATTEMPTS = 3;
const GIT_ENV = { GIT_TERMINAL_PROMPT: '0' };
const COMMIT_IDENTITY = ['-c', 'user.name=overdeck-vault', '-c', 'user.email=vault@overdeck.local'];

export function gitVaultCloneDir(): string {
  return join(vaultDir(), 'git');
}

/** Lock file guarding the clone; beside it, not inside it, so `git add -A` never sees it. */
export function gitVaultLockPath(cloneDir: string): string {
  return `${cloneDir}.lock`;
}

/** The git blob SHA of `bytes`, which is what `version` means for this backend. */
export function blobSha(bytes: Uint8Array): string {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

class GitCommandError extends Error {
  constructor(readonly args: string[], readonly stderr: string, readonly code: number | string | undefined) {
    super(`git ${args.join(' ')} failed (${code ?? 'signal'}): ${stderr.trim()}`);
  }
}

/**
 * Only a real non-fast-forward rejection is retried. "failed to push some refs"
 * and "[rejected]" also appear when a hook declines or a quota rejects the
 * push, and those must surface as VaultOfflineError, not as a CAS conflict.
 */
function isNonFastForward(error: GitCommandError): boolean {
  // "cannot lock ref … is at X but expected Y" / "failed to update ref" is the
  // remote's answer when another push landed between our fetch and our push.
  return /non-fast-forward|fetch first|remote ref updated since checkout|cannot lock ref '[^']+': is at \w+ but expected|failed to update ref/i
    .test(error.stderr);
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      env: { ...process.env, ...GIT_ENV },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string; code?: number | string };
    throw new GitCommandError(args, String(failure.stderr ?? failure.message ?? ''), failure.code);
  }
}

async function readOrNull(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function writeAtomic(target: string, bytes: Uint8Array | string): Promise<void> {
  const temp = `${target}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  try {
    await writeFile(temp, bytes);
    await rename(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clone `url` into `cloneDir` and make it a vault. An empty remote gets the
 * `VAULT-FORMAT` marker committed and pushed as the first commit of `main`.
 * A remote that has content but no marker is refused: the clone is removed
 * and nothing is committed or pushed.
 */
export async function initGitVault(url: string, cloneDir = gitVaultCloneDir()): Promise<GitVaultStore> {
  if (await pathExists(cloneDir)) {
    throw new Error(`Vault clone already exists at ${cloneDir}; remove it or run pan vault status`);
  }
  await mkdir(dirname(cloneDir), { recursive: true });
  try {
    await git(dirname(cloneDir), ['clone', '--quiet', '--', url, cloneDir]);
  } catch (error) {
    await rm(cloneDir, { recursive: true, force: true });
    throw new VaultOfflineError(`Could not clone vault remote ${url}: ${(error as Error).message}`, { cause: error });
  }
  let heads: string;
  try {
    heads = await git(cloneDir, ['ls-remote', '--heads', 'origin']);
  } catch (error) {
    await rm(cloneDir, { recursive: true, force: true });
    throw new VaultOfflineError(`Could not list vault remote ${url}`, { cause: error });
  }
  if (heads.trim().length === 0) {
    // Empty remote: create main with the marker as its first commit.
    await git(cloneDir, ['symbolic-ref', 'HEAD', `refs/heads/${GIT_VAULT_BRANCH}`]);
    await writeFile(join(cloneDir, VAULT_FORMAT_MARKER_FILE), VAULT_FORMAT_MARKER);
    await git(cloneDir, ['add', '--', VAULT_FORMAT_MARKER_FILE]);
    await git(cloneDir, [...COMMIT_IDENTITY, 'commit', '--quiet', '-m', 'vault: init']);
    try {
      await git(cloneDir, ['push', '--quiet', '-u', 'origin', GIT_VAULT_BRANCH]);
    } catch (error) {
      await rm(cloneDir, { recursive: true, force: true });
      throw new VaultOfflineError(`Could not push the vault marker to ${url}`, { cause: error });
    }
    return new GitVaultStore(cloneDir);
  }
  const hasMain = heads.split('\n').some((line) => line.trim().endsWith(`refs/heads/${GIT_VAULT_BRANCH}`));
  if (hasMain) {
    // The remote's HEAD may point at another (possibly unborn) branch, in which
    // case git clone leaves an empty checkout. Put the clone on main explicitly.
    await git(cloneDir, ['symbolic-ref', 'HEAD', `refs/heads/${GIT_VAULT_BRANCH}`]);
    await git(cloneDir, ['reset', '--quiet', '--hard', `origin/${GIT_VAULT_BRANCH}`]);
  }
  const marker = hasMain ? await readOrNull(join(cloneDir, VAULT_FORMAT_MARKER_FILE)) : null;
  if (marker === null || marker.toString('utf8') !== VAULT_FORMAT_MARKER) {
    await rm(cloneDir, { recursive: true, force: true });
    throw new Error(`${url} is neither empty nor a vault (no ${VAULT_FORMAT_MARKER_FILE} on ${GIT_VAULT_BRANCH}); nothing was written`);
  }
  return new GitVaultStore(cloneDir);
}

export class GitVaultStore implements VaultStore {
  private casQueue: Promise<unknown> = Promise.resolve();

  constructor(readonly cloneDir: string) {}

  /** Open an existing vault clone (created by `initGitVault`). */
  static async open(cloneDir = gitVaultCloneDir()): Promise<GitVaultStore> {
    if (!(await pathExists(join(cloneDir, '.git')))) {
      throw new Error(`No vault clone at ${cloneDir}; run pan vault setup or pan vault join first`);
    }
    return new GitVaultStore(cloneDir);
  }

  private objectPath(id: string): string {
    return join(this.cloneDir, 'objects', ...objectRelativePath(id).split('/'));
  }

  private refRelPath(name: string): string {
    assertRefName(name);
    return join('refs', ...name.split('/'));
  }

  private async hasRemoteMain(): Promise<boolean> {
    try {
      await git(this.cloneDir, ['rev-parse', '--verify', '--quiet', `origin/${GIT_VAULT_BRANCH}`]);
      return true;
    } catch {
      return false;
    }
  }

  private locked<T>(fn: () => Promise<T>): Promise<T> {
    return withFileLock(gitVaultLockPath(this.cloneDir), fn);
  }

  /** Fetch and hard-reset the vault clone to origin/main. Offline → VaultOfflineError. */
  async refresh(): Promise<void> {
    return this.locked(() => this.refreshUnlocked());
  }

  private async refreshUnlocked(): Promise<void> {
    try {
      await git(this.cloneDir, ['fetch', '--quiet', 'origin']);
    } catch (error) {
      await this.resetToRemote();
      throw new VaultOfflineError(`Vault remote is unreachable: ${(error as Error).message}`, { cause: error });
    }
    await this.resetToRemote();
  }

  private async resetToRemote(): Promise<void> {
    if (await this.hasRemoteMain()) {
      await git(this.cloneDir, ['reset', '--quiet', '--hard', `origin/${GIT_VAULT_BRANCH}`]);
    }
  }

  async putObjects(objects: ReadonlyArray<{ id: string; bytes: Uint8Array }>): Promise<void> {
    for (const { id } of objects) assertNotSlotName(id);
    await this.locked(async () => {
      for (const { id, bytes } of objects) {
        const path = this.objectPath(id);
        // Ids bind the plaintext (keyed HMAC) and decodeChunk authenticates on
        // read, so an existing id is already stored: a re-encode of the same
        // lines after a failed push carries a fresh nonce and must not fail.
        if ((await readOrNull(path)) !== null) continue;
        await writeAtomic(path, bytes);
      }
    });
  }

  async getObject(id: string): Promise<Uint8Array | null> {
    return readOrNull(this.objectPath(id));
  }

  async hasObjects(ids: readonly string[]): Promise<Set<string>> {
    const present = new Set<string>();
    for (const id of ids) {
      if (await pathExists(this.objectPath(id))) present.add(id);
    }
    return present;
  }

  async readRef(name: string): Promise<VaultRef | null> {
    const bytes = await readOrNull(join(this.cloneDir, this.refRelPath(name)));
    if (bytes === null) return null;
    return { value: bytes, version: blobSha(bytes) };
  }

  async casRef(name: string, expectedVersion: string | null, value: Uint8Array): Promise<CasResult> {
    const rel = this.refRelPath(name);
    const run = this.casQueue.then(() => this.locked(() => this.casRefSerialized(rel, expectedVersion, value)));
    this.casQueue = run.catch(() => undefined);
    return run;
  }

  private async casRefSerialized(rel: string, expectedVersion: string | null, value: Uint8Array): Promise<CasResult> {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
      await this.refreshUnlocked();
      const remoteMain = await this.hasRemoteMain();
      const current = remoteMain ? await this.remoteBlobSha(rel) : null;
      if (current !== expectedVersion) return 'conflict';

      await writeAtomic(join(this.cloneDir, rel), value);
      if (!remoteMain) await git(this.cloneDir, ['symbolic-ref', 'HEAD', `refs/heads/${GIT_VAULT_BRANCH}`]);
      await git(this.cloneDir, ['add', '-A', '--', '.']);
      await git(this.cloneDir, [...COMMIT_IDENTITY, 'commit', '--quiet', '--allow-empty', '-m', 'vault: settle']);
      try {
        await git(this.cloneDir, remoteMain
          ? ['push', '--quiet', 'origin', `HEAD:${GIT_VAULT_BRANCH}`]
          : ['push', '--quiet', '-u', 'origin', GIT_VAULT_BRANCH]);
        return 'ok';
      } catch (error) {
        const failure = error as GitCommandError;
        // Drop the local commit either way; objects are untracked again and
        // survive for the next attempt. The unpushed ref file must not: a new
        // record's ref would otherwise ride along with the next push.
        await this.undoLocalCommit();
        await git(this.cloneDir, ['clean', '-fdq', '--', 'refs']).catch(() => undefined);
        if (failure instanceof GitCommandError && isNonFastForward(failure)) continue;
        await this.resetToRemote();
        throw new VaultOfflineError(`Vault push failed: ${failure.message}`, { cause: failure });
      }
    }
    return 'conflict';
  }

  async putSlot(name: string, bytes: Uint8Array | null): Promise<void> {
    assertSlotName(name);
    const run = this.casQueue.then(() => this.locked(() => this.putSlotSerialized(name, bytes)));
    this.casQueue = run.catch(() => undefined);
    return run;
  }

  private async putSlotSerialized(name: string, bytes: Uint8Array | null): Promise<void> {
    const path = this.objectPath(name);
    // Scope every git call to the slot directory so pending content objects
    // (untracked until the next settle) never ride along with a keywrap commit.
    const scope = `objects/${name.split('/')[0]}`;
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
      await this.refreshUnlocked();
      if (bytes === null) {
        const tracked = (await git(this.cloneDir, ['ls-files', '--', `objects/${name}`])).trim().length > 0;
        await rm(path, { force: true });
        // A pathspec that matches nothing makes `git add` fail, so deleting a
        // slot the remote does not have ends here (an untracked leftover is gone).
        if (!tracked) return;
      } else {
        await writeAtomic(path, bytes);
      }
      await git(this.cloneDir, ['add', '-A', '--', scope]);
      // Not `--quiet`: it exits 1 when there are changes and git() throws on that.
      const staged = await git(this.cloneDir, ['diff', '--cached', '--name-only', '--', scope]);
      if (staged.trim().length === 0) return;
      await git(this.cloneDir, [...COMMIT_IDENTITY, 'commit', '--quiet', '-m', 'vault: keywrap']);
      try {
        await git(this.cloneDir, ['push', '--quiet', 'origin', `HEAD:${GIT_VAULT_BRANCH}`]);
        return;
      } catch (error) {
        const failure = error as GitCommandError;
        await this.undoLocalCommit();
        await this.resetToRemote();
        // A brand-new slot file is untracked after the reset and would
        // otherwise be swept into the next settle's `add -A -- .`.
        await git(this.cloneDir, ['clean', '-fdq', '--', scope]).catch(() => undefined);
        if (failure instanceof GitCommandError && isNonFastForward(failure)) continue;
        throw new VaultOfflineError(`Vault keywrap push failed: ${failure.message}`, { cause: failure });
      }
    }
    throw new VaultOfflineError('Vault keywrap push kept conflicting');
  }

  /** Blob SHA of `rel` at origin/main, or null when the ref does not exist there. */
  private async remoteBlobSha(rel: string): Promise<string | null> {
    try {
      const out = await git(this.cloneDir, ['rev-parse', '--verify', '--quiet', `origin/${GIT_VAULT_BRANCH}:${rel.split(sep).join('/')}`]);
      return out.trim() || null;
    } catch {
      return null;
    }
  }

  /** Undo the last local commit but keep its files in the working tree (as untracked/modified). */
  private async undoLocalCommit(): Promise<void> {
    if (await this.hasRemoteMain()) {
      await git(this.cloneDir, ['reset', '--quiet', '--soft', `origin/${GIT_VAULT_BRANCH}`]);
      await git(this.cloneDir, ['reset', '--quiet']);
    } else {
      await git(this.cloneDir, ['update-ref', '-d', `refs/heads/${GIT_VAULT_BRANCH}`]);
      await git(this.cloneDir, ['reset', '--quiet']);
    }
  }

  async listRefs(prefix: string): Promise<Array<{ name: string; version: string }>> {
    const refsRoot = join(this.cloneDir, 'refs');
    const out: Array<{ name: string; version: string }> = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!entry.isFile() || entry.name.endsWith('.tmp')) continue;
        const name = relative(refsRoot, full).split(sep).join('/');
        if (!name.startsWith(prefix)) continue;
        out.push({ name, version: blobSha(await readFile(full)) });
      }
    };
    await walk(refsRoot);
    return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
}

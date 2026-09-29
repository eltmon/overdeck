/**
 * Session Vault WIP capture (PAN-4329, anywhere-accounts design 6.7).
 *
 * Snapshot the owner's uncommitted code with a settlement so a conversation
 * resumed elsewhere carries its edits. The snapshot is a git bundle of a WIP
 * commit (built from a temporary index seeded with a copy of the user's index)
 * plus every local commit the remote-tracking refs lack. The bundle is secret-
 * scanned, size-capped, then stored as encrypted parts (`format.ts`
 * `encodeWipParts`); it never goes to the project's git host.
 *
 * Capture never touches the user's index file, worktree, stash list or refs,
 * apart from creating and deleting its own `refs/overdeck/wip/<vaultId>-<pid>`.
 * Git runs through promisified `execFile` only (never `execSync`, never
 * `git stash`, no shell pipes); intermediate output goes to temp files.
 *
 * Imports only Node built-ins and sibling vault modules (NFR-1).
 */
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { encodeWipParts, type Settlement, type WipSnapshotRef } from './format.js';
import type { VaultSubkeys } from './identity.js';
import { scanWipPatch, type WipSecretHit } from './secrets.js';
import { VaultOfflineError, type VaultStore } from './store/types.js';

const execFileAsync = promisify(execFile);

export type WipMode = 'auto' | 'force' | 'off';
/** `'auto'` captures at most once per this many seconds (D-1). */
export const WIP_MIN_INTERVAL_SEC = 300;
/** Captured snapshots kept per record (D-8). */
export const WIP_KEEP = 5;

export type CapturedWip = Extract<WipSnapshotRef, { objects: string[] }>;
export type SkippedWip = Extract<WipSnapshotRef, { skipped: string }>;

export type WipCaptureResult =
  | { status: 'off' | 'throttled' | 'unchanged' | 'no-git' }
  | { status: 'captured'; wip: CapturedWip }
  | { status: 'skipped'; wip: SkippedWip; hits?: WipSecretHit[] };

/** A git command failed; `message` is the first stderr line, at most 200 chars. */
export class WipGitError extends Error {
  override readonly name = 'WipGitError';
}

// Inherited variables that would point git at another repository or index.
const INHERITED_GIT_VARS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_PREFIX',
];

const WIP_IDENTITY = 'Overdeck Session Vault';
const WIP_EMAIL = 'vault@overdeck.invalid';

function firstLine(text: string): string {
  return (text.split('\n').find((line) => line.trim().length > 0) ?? '').trim().slice(0, 200);
}

/**
 * Run git in `cwd` (D-10) and return stdout. The environment drops inherited
 * repository overrides, never takes optional locks or prompts, and carries a
 * fixed author/committer so a machine without `user.name` can still build the
 * WIP commit. Failure throws WipGitError with the first stderr line.
 */
export async function runWipGit(
  cwd: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; maxBuffer?: number } = {},
): Promise<string> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of INHERITED_GIT_VARS) delete env[name];
  Object.assign(env, {
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: WIP_IDENTITY,
    GIT_AUTHOR_EMAIL: WIP_EMAIL,
    GIT_COMMITTER_NAME: WIP_IDENTITY,
    GIT_COMMITTER_EMAIL: WIP_EMAIL,
  }, options.env);
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      env,
      encoding: 'utf8',
      maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const failure = error as Error & { stderr?: unknown };
    const stderr = typeof failure.stderr === 'string' ? firstLine(failure.stderr) : '';
    throw new WipGitError(stderr || firstLine(failure.message) || `git ${args[0] ?? ''} failed`, { cause: error });
  }
}

/** Like runWipGit, but a failure yields null. */
async function tryWipGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await runWipGit(cwd, args);
  } catch {
    return null;
  }
}

/** The WIP entry of the most recent settlement that has one (D-1). */
export function latestWipEntry(settlements: readonly Settlement[]): WipSnapshotRef | null {
  for (let index = settlements.length - 1; index >= 0; index--) {
    const wip = settlements[index]!.wip;
    if (wip !== undefined) return wip;
  }
  return null;
}

function isCaptured(wip: WipSnapshotRef | undefined): wip is CapturedWip {
  return wip !== undefined && Array.isArray((wip as CapturedWip).objects);
}

/**
 * Drop the `wip` field of every captured entry older than the `keep` most
 * recent captured ones (D-8). Skipped entries hold no objects and stay. Returns
 * a new array; changed settlements are copies.
 */
export function pruneWipEntries(settlements: Settlement[], keep = WIP_KEEP): Settlement[] {
  let seen = 0;
  const result = [...settlements];
  for (let index = result.length - 1; index >= 0; index--) {
    const settlement = result[index]!;
    if (!isCaptured(settlement.wip)) continue;
    seen++;
    if (seen <= keep) continue;
    const { wip: _dropped, ...rest } = settlement;
    result[index] = rest;
  }
  return result;
}

export interface WipCommit {
  /** Full HEAD sha: the WIP commit's parent. */
  base: string;
  /** Current branch, or null when detached. */
  branch: string | null;
  /** Tree of the WIP commit: the whole working tree minus ignored files. */
  tree: string;
  /** The WIP commit sha. It is on no branch. */
  wip: string;
  /** Top level of the work tree; every later git call runs here. */
  root: string;
  /** Temp directory owned by this commit; removed by cleanup(). */
  dir: string;
  cleanup(): Promise<void>;
}

/**
 * Build the WIP commit for `cwd`. Returns null when `cwd` is not inside a git
 * work tree, git is unavailable, or HEAD is unborn ("no-git"). The temporary
 * index is a copy of the user's, so tracked-but-ignored files stay tracked;
 * the user's index file is never written.
 */
export async function buildWipCommit(cwd: string, vaultId = 'snapshot'): Promise<WipCommit | null> {
  const inside = await tryWipGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (inside === null || inside.trim() !== 'true') return null;
  const base = (await tryWipGit(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']))?.trim() ?? '';
  if (base.length === 0) return null;
  const root = (await runWipGit(cwd, ['rev-parse', '--show-toplevel'])).trim();
  const branchName = (await runWipGit(root, ['branch', '--show-current'])).trim();
  const indexPath = resolve(root, (await runWipGit(root, ['rev-parse', '--git-path', 'index'])).trim());

  const dir = await mkdtemp(join(tmpdir(), 'overdeck-wip-'));
  const cleanup = () => rm(dir, { recursive: true, force: true });
  try {
    const tempIndex = join(dir, 'index');
    try {
      await copyFile(indexPath, tempIndex);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const env = { GIT_INDEX_FILE: tempIndex };
    await runWipGit(root, ['add', '-A'], { env });
    const tree = (await runWipGit(root, ['write-tree'], { env })).trim();
    const wip = (
      await runWipGit(root, ['commit-tree', '--no-gpg-sign', tree, '-p', base, '-m', `overdeck wip ${vaultId}`])
    ).trim();
    return { base, branch: branchName.length > 0 ? branchName : null, tree, wip, root, dir, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/**
 * The patch of every commit the bundle carries (D-4): `git log -p` of the WIP
 * commit and every commit the remote-tracking refs lack. Fixed prefixes and no
 * textconv or external diff, whatever the user's diff config says. Binary files
 * appear as "Binary files … differ" and are not scanned.
 */
export async function wipPatch(cwd: string, wip: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'overdeck-wip-'));
  try {
    const output = join(dir, 'wip.patch');
    await runWipGit(cwd, [
      'log', '-p', '--no-color', '--no-ext-diff', '--no-textconv',
      '--src-prefix=a/', '--dst-prefix=b/', '--format=%H', `--output=${output}`,
      wip, '--not', '--remotes',
    ]);
    return await readFile(output, 'utf8');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function sameRef(previous: WipSnapshotRef, base: string, tree: string): boolean {
  return (previous as { base?: string }).base === base && (previous as { tree?: string }).tree === tree;
}

/** D-1: whether (base, tree) needs no new capture given the latest entry. */
function isUnchanged(mode: 'auto' | 'force', previous: WipSnapshotRef | null, base: string, tree: string): boolean {
  if (previous === null || !sameRef(previous, base, tree)) return false;
  if (mode === 'auto') return true;
  if (isCaptured(previous)) return true;
  return previous.skipped === 'clean' || previous.skipped === 'too-large';
}

function errorReason(error: unknown): string {
  return firstLine((error as Error).message ?? String(error)) || 'capture failed';
}

export interface CaptureWipOptions {
  cwd: string;
  vaultId: string;
  mode: WipMode;
  /** The record's latest WIP entry (`latestWipEntry`), or null. */
  previous: WipSnapshotRef | null;
  store: VaultStore;
  keys: VaultSubkeys;
  maxBytes: number;
  now: () => Date;
}

/**
 * Capture the WIP snapshot for one settlement (PRD WI-3). `off`, `throttled`,
 * `unchanged` and `no-git` persist nothing; `captured` and `skipped` are the
 * entry to store on the settlement. Any failure other than VaultOfflineError
 * becomes `skipped: 'error'`, so a code snapshot never blocks the transcript.
 */
export async function captureWip(options: CaptureWipOptions): Promise<WipCaptureResult> {
  const { cwd, vaultId, mode, previous, store, keys, maxBytes, now } = options;
  if (mode === 'off') return { status: 'off' };
  if (mode === 'auto' && previous?.at !== undefined) {
    const elapsedMs = now().getTime() - Date.parse(previous.at);
    if (elapsedMs < WIP_MIN_INTERVAL_SEC * 1000) return { status: 'throttled' };
  }

  let commit: WipCommit | null;
  try {
    commit = await buildWipCommit(cwd, vaultId);
  } catch (error) {
    const base = (await tryWipGit(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']))?.trim();
    return {
      status: 'skipped',
      wip: { skipped: 'error', ...(base ? { base } : {}), at: now().toISOString(), reason: errorReason(error) },
    };
  }
  if (commit === null) return { status: 'no-git' };

  const { base, branch, tree, wip, root, dir } = commit;
  const skip = (skipped: SkippedWip['skipped'], extra: Omit<Partial<SkippedWip>, 'skipped'> = {}): WipCaptureResult => ({
    status: 'skipped',
    wip: { skipped, base, tree, at: now().toISOString(), ...extra },
  });
  const tempRef = `refs/overdeck/wip/${vaultId}-${process.pid}`;
  let refCreated = false;
  try {
    if (isUnchanged(mode, previous, base, tree)) return { status: 'unchanged' };

    const headTree = (await runWipGit(root, ['rev-parse', `${base}^{tree}`])).trim();
    if (headTree === tree) {
      const unpushed = (await runWipGit(root, ['rev-list', '--count', base, '--not', '--remotes'])).trim();
      if (unpushed === '0') return skip('clean');
    }

    await runWipGit(root, ['update-ref', tempRef, wip]);
    refCreated = true;
    const bundlePath = join(dir, 'wip.bundle');
    await runWipGit(root, ['bundle', 'create', bundlePath, tempRef, '--not', '--remotes']);
    const bytes = (await stat(bundlePath)).size;
    if (bytes > maxBytes) return skip('too-large', { bytes });

    const hits = await scanWipPatch(vaultId, await wipPatch(root, wip));
    if (hits.length > 0) {
      return {
        status: 'skipped',
        wip: { skipped: 'secret', base, tree, at: now().toISOString(), reason: `${hits.length} secret hit(s)` },
        hits,
      };
    }

    const parts = await encodeWipParts(await readFile(bundlePath), keys);
    await store.putObjects(parts);
    return {
      status: 'captured',
      wip: { base, branch, tree, objects: parts.map((part) => part.id), bytes, at: now().toISOString() },
    };
  } catch (error) {
    if (error instanceof VaultOfflineError) throw error;
    return skip('error', { reason: errorReason(error) });
  } finally {
    if (refCreated) await tryWipGit(root, ['update-ref', '-d', tempRef]);
    await commit.cleanup();
  }
}

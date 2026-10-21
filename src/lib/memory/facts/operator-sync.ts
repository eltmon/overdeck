/**
 * Operator memory sync (PAN-4578). The operator store (`~/.overdeck/context/memory/`)
 * travels between the operator's machines as a plain git clone of a private
 * repository the operator owns. "Sync is on" means the store has a `.git`; there is
 * no config key and the remote URL lives only in `.git/config`.
 *
 * - `setupOperatorMemorySync` checks the remote is reachable, moves home-path facts
 *   into the machine store, runs `git init` + `remote add origin`, then syncs (D9).
 * - `syncOperatorMemory` commits local changes (minus held-back files), fetches,
 *   merges `origin/main`, and pushes, retrying a non-fast-forward push (D8). It
 *   never throws: every error becomes an `offline` or `failed` outcome (D7).
 * - `readOperatorMemorySyncStatus` reports the clone's state without the network (D13).
 *
 * Every git call is an async `execFile` with `GIT_TERMINAL_PROMPT=0` (D6). Never
 * `git stash`, never `reset --hard`: the operator may have uncommitted facts in the
 * store, unlike the vault's own clone. The whole run holds a lock file beside the
 * store (`<dir>.lock`). The launch path (render.ts, materialize.ts) must never
 * import this module: launches never touch git or the network.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { readEnvironmentIdentity } from '../../environment-identity.js';
import { redactSensitiveText } from '../../secret-redaction.js';
import { withFileLock } from '../../vault/file-lock.js';
import { MACHINE_PATH_PATTERN, machineMemoryDir, readMemoryFactsSync, userMemoryDir } from './store.js';

const execFileAsync = promisify(execFile);

export const SYNC_NETWORK_TIMEOUT_MS = 30_000;
const SYNC_BRANCH = 'main';
const PUSH_ATTEMPTS = 3;
// A run can spend up to 3 × (fetch + push) × 30 s on the network, so the stale
// window must exceed that or a second process would steal a live lock.
const SYNC_LOCK_STALE_MS = 300_000;
const SYNC_CONFLICT_REVIEW = 'sync-conflict';

export interface HeldBackFile {
  path: string;
  reason: 'secret-like content' | 'machine-specific path';
}

export type OperatorMemorySyncOutcome =
  | { status: 'not-configured'; dir: string }
  | {
      status: 'synced';
      dir: string;
      committed: boolean;
      pulled: string[];
      pushed: boolean;
      conflicts: string[];
      heldBack: HeldBackFile[];
    }
  | { status: 'offline'; dir: string; error: string; committed: boolean; heldBack: HeldBackFile[] }
  | { status: 'failed'; dir: string; error: string };

export interface OperatorMemorySyncStatus {
  configured: boolean;
  dir: string;
  remote: string | null;
  lastCommit: { sha: string; date: string; subject: string } | null;
  ahead: number;
  behind: number;
  uncommitted: number;
  conflicts: string[];
}

export interface OperatorMemorySetupResult {
  migrated: Array<{ id: string; to: string }>;
  kept: string[];
  outcome: OperatorMemorySyncOutcome;
}

export class OperatorMemorySetupError extends Error {}

class GitCommandError extends Error {
  constructor(readonly args: string[], readonly stderr: string, readonly code: number | string | undefined) {
    super(`git ${args.join(' ')} failed (${code ?? 'signal'}): ${stderr.trim()}`);
  }
}

/** A network command (fetch/push/ls-remote) failed or timed out: the outcome is `offline`. */
class SyncOfflineError extends Error {}

interface GitRun {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | string | undefined;
}

async function runGit(cwd: string, args: string[], network = false): Promise<GitRun> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', OVERDECK_PAN_GIT_OP: '1' },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      ...(network ? { timeout: SYNC_NETWORK_TIMEOUT_MS } : {}),
    });
    return { ok: true, stdout, stderr, code: 0 };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string };
    return {
      ok: false,
      stdout: String(failure.stdout ?? ''),
      stderr: String(failure.stderr ?? failure.message ?? ''),
      code: failure.code,
    };
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await runGit(cwd, args);
  if (!result.ok) throw new GitCommandError(args, result.stderr, result.code);
  return result.stdout;
}

function identityArgs(label: string): string[] {
  return ['-c', `user.name=pan memory sync (${label})`, '-c', 'user.email=memory-sync@overdeck.local'];
}

/** Copied from the vault (`vault/store/git.ts`): only a real non-fast-forward rejection is retried. */
function isNonFastForward(stderr: string): boolean {
  return /non-fast-forward|fetch first|remote ref updated since checkout|cannot lock ref '[^']+': is at \w+ but expected|failed to update ref/i
    .test(stderr);
}

function splitNul(text: string): string[] {
  return text.split('\0').filter(Boolean);
}

function splitLines(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

function isTopLevelFactFile(path: string): boolean {
  return path.endsWith('.md') && path !== 'README.md' && !path.includes('/');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isOperatorMemorySynced(dir: string = userMemoryDir()): boolean {
  return existsSync(join(dir, '.git'));
}

/** Strip `userinfo@` from `scheme://userinfo@host/…` so an embedded token never prints (D5). */
export function redactRemoteUrl(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]+@/i, '$1');
}

export function labelSlug(label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  return slug || 'machine';
}

export async function resolveMachineLabel(): Promise<string> {
  try {
    const identity = await readEnvironmentIdentity();
    if (identity?.label) return identity.label;
  } catch {
    // An unreadable identity file falls back to the hostname.
  }
  return hostname();
}

async function lockedOnStore<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(dirname(dir), { recursive: true });
  return withFileLock(`${dir}.lock`, fn, { staleMs: SYNC_LOCK_STALE_MS });
}

/** D8 step 3: stage everything, then unstage each changed fact that must not leave this machine. */
async function stageWithHoldBack(dir: string): Promise<HeldBackFile[]> {
  await git(dir, ['add', '-A']);
  const changed = splitNul(await git(dir, ['diff', '--cached', '--name-only', '--diff-filter=AMR', '-z']));
  const heldBack: HeldBackFile[] = [];
  for (const path of changed) {
    if (!isTopLevelFactFile(path)) continue;
    const text = await readFile(join(dir, path), 'utf8');
    let reason: HeldBackFile['reason'] | null = null;
    if (redactSensitiveText(text) !== text) reason = 'secret-like content';
    else if (MACHINE_PATH_PATTERN.test(text)) reason = 'machine-specific path';
    if (reason === null) continue;
    await git(dir, ['reset', '-q', '--', path]);
    heldBack.push({ path, reason });
  }
  return heldBack;
}

async function fetchOrigin(dir: string): Promise<void> {
  const fetched = await runGit(dir, ['fetch', 'origin'], true);
  if (!fetched.ok) throw new SyncOfflineError(`fetch failed: ${fetched.stderr.trim()}`);
}

async function refExists(dir: string, ref: string): Promise<boolean> {
  return (await runGit(dir, ['rev-parse', '--verify', '-q', ref])).ok;
}

/** Push HEAD to `main`; returns false on a non-fast-forward rejection, throws offline otherwise. */
async function pushHead(dir: string, setUpstream: boolean): Promise<boolean> {
  const args = setUpstream ? ['push', '-u', 'origin', `HEAD:${SYNC_BRANCH}`] : ['push', 'origin', `HEAD:${SYNC_BRANCH}`];
  const pushed = await runGit(dir, args, true);
  if (pushed.ok) return true;
  if (isNonFastForward(pushed.stderr)) return false;
  throw new SyncOfflineError(`push failed: ${pushed.stderr.trim()}`);
}

/** Merge `origin/main` into HEAD; returns the top-level fact files the merge changed. */
async function mergeOrigin(dir: string, label: string): Promise<string[]> {
  const pre = (await git(dir, ['rev-parse', 'HEAD'])).trim();
  const merged = await runGit(dir, [
    ...identityArgs(label),
    'merge',
    '--no-edit',
    '--allow-unrelated-histories',
    `origin/${SYNC_BRANCH}`,
  ]);
  if (!merged.ok) {
    const conflicted = splitLines((await runGit(dir, ['diff', '--name-only', '--diff-filter=U'])).stdout);
    if (existsSync(join(dir, '.git', 'MERGE_HEAD'))) await git(dir, ['merge', '--abort']);
    if (conflicted.length > 0) throw new Error(`merge conflict in ${conflicted.join(', ')}; nothing was changed`);
    throw new Error(`merge failed: ${(merged.stderr || merged.stdout).trim()}`);
  }
  return splitLines(await git(dir, ['diff', '--name-only', pre, 'HEAD'])).filter(isTopLevelFactFile);
}

/** D8. The caller holds the store lock. Never throws. */
async function syncLocked(dir: string, label: string): Promise<OperatorMemorySyncOutcome> {
  if (!isOperatorMemorySynced(dir)) return { status: 'not-configured', dir };

  let committed = false;
  let heldBack: HeldBackFile[] = [];
  try {
    if (existsSync(join(dir, '.git', 'MERGE_HEAD'))) await git(dir, ['merge', '--abort']);

    heldBack = await stageWithHoldBack(dir);
    if (!(await runGit(dir, ['diff', '--cached', '--quiet'])).ok) {
      await git(dir, [...identityArgs(label), 'commit', '-q', '-m', `memory: sync from ${label}`]);
      committed = true;
    }

    const pulled = new Set<string>();
    let pushed = false;
    for (let attempt = 1; attempt <= PUSH_ATTEMPTS; attempt += 1) {
      await fetchOrigin(dir);

      if (!(await refExists(dir, `refs/remotes/origin/${SYNC_BRANCH}`))) {
        // An empty remote: the first push creates main.
        if (!(await refExists(dir, 'HEAD'))) break;
        if (await pushHead(dir, true)) {
          pushed = true;
          break;
        }
        continue;
      }

      if (!(await refExists(dir, 'HEAD'))) {
        // Nothing was ever committed here: adopt the remote branch as-is.
        const checkedOut = await runGit(dir, ['checkout', '-q', '-B', SYNC_BRANCH, '--track', `origin/${SYNC_BRANCH}`]);
        if (!checkedOut.ok) return { status: 'failed', dir, error: `checkout failed: ${checkedOut.stderr.trim()}` };
        for (const path of splitLines(await git(dir, ['ls-files']))) {
          if (isTopLevelFactFile(path)) pulled.add(path);
        }
      } else {
        for (const path of await mergeOrigin(dir, label)) pulled.add(path);
      }

      const ahead = Number((await git(dir, ['rev-list', '--count', `origin/${SYNC_BRANCH}..HEAD`])).trim());
      if (ahead === 0) break;
      if (await pushHead(dir, false)) {
        pushed = true;
        break;
      }
      if (attempt === PUSH_ATTEMPTS) {
        return { status: 'offline', dir, error: `push rejected ${PUSH_ATTEMPTS} times`, committed, heldBack };
      }
    }

    return { status: 'synced', dir, committed, pulled: [...pulled].sort(), pushed, conflicts: [], heldBack };
  } catch (error) {
    if (error instanceof SyncOfflineError) {
      return { status: 'offline', dir, error: error.message, committed, heldBack };
    }
    return { status: 'failed', dir, error: errorMessage(error) };
  }
}

export async function syncOperatorMemory(opts?: { dir?: string; label?: string }): Promise<OperatorMemorySyncOutcome> {
  const dir = opts?.dir ?? userMemoryDir();
  if (!isOperatorMemorySynced(dir)) return { status: 'not-configured', dir };
  try {
    const label = opts?.label ?? await resolveMachineLabel();
    return await lockedOnStore(dir, () => syncLocked(dir, label));
  } catch (error) {
    return { status: 'failed', dir, error: errorMessage(error) };
  }
}

async function assertReachable(remoteUrl: string): Promise<void> {
  const reached = await runGit(tmpdir(), ['ls-remote', remoteUrl], true);
  if (!reached.ok) {
    throw new OperatorMemorySetupError(`cannot reach ${redactRemoteUrl(remoteUrl)}: ${reached.stderr.trim()}`);
  }
}

/** D9 step 3: move every home-path operator fact into the machine store before the first commit. */
async function migrateMachineFacts(
  dir: string,
  machineDir: string,
): Promise<{ migrated: Array<{ id: string; to: string }>; kept: string[] }> {
  const migrated: Array<{ id: string; to: string }> = [];
  const kept: string[] = [];
  if (!existsSync(dir)) return { migrated, kept };

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith('.') || !isTopLevelFactFile(entry.name)) continue;
    const from = join(dir, entry.name);
    if (!MACHINE_PATH_PATTERN.test(await readFile(from, 'utf8'))) continue;

    const id = entry.name.replace(/\.md$/, '');
    const to = join(machineDir, entry.name);
    if (existsSync(to)) {
      kept.push(id);
      continue;
    }
    await mkdir(machineDir, { recursive: true });
    await rename(from, to);
    migrated.push({ id, to });
  }
  return { migrated, kept };
}

export async function setupOperatorMemorySync(
  remoteUrl: string,
  opts?: { dir?: string; machineDir?: string; label?: string },
): Promise<OperatorMemorySetupResult> {
  const dir = opts?.dir ?? userMemoryDir();
  const machineDir = opts?.machineDir ?? machineMemoryDir();
  const label = opts?.label ?? await resolveMachineLabel();

  try {
    return await lockedOnStore(dir, () => setupLocked(dir, machineDir, label, remoteUrl));
  } catch (error) {
    if (error instanceof OperatorMemorySetupError) throw error;
    throw new OperatorMemorySetupError(`setup failed: ${errorMessage(error)}`);
  }
}

async function setupLocked(
  dir: string,
  machineDir: string,
  label: string,
  remoteUrl: string,
): Promise<OperatorMemorySetupResult> {
  let migrated: Array<{ id: string; to: string }> = [];
  let kept: string[] = [];

  if (isOperatorMemorySynced(dir)) {
    const origin = await runGit(dir, ['remote', 'get-url', 'origin']);
    if (origin.ok) {
      const existing = origin.stdout.trim();
      if (existing !== remoteUrl) {
        throw new OperatorMemorySetupError(
          `already synced with ${redactRemoteUrl(existing)}; to switch, run git -C ${dir} remote set-url origin <url>`,
        );
      }
    } else {
      await assertReachable(remoteUrl);
      await git(dir, ['remote', 'add', 'origin', remoteUrl]);
    }
  } else {
    await assertReachable(remoteUrl);
    ({ migrated, kept } = await migrateMachineFacts(dir, machineDir));
    await mkdir(dir, { recursive: true });
    await git(dir, ['init', '-q']);
    await git(dir, ['symbolic-ref', 'HEAD', `refs/heads/${SYNC_BRANCH}`]);
    await git(dir, ['remote', 'add', 'origin', remoteUrl]);
  }

  return { migrated, kept, outcome: await syncLocked(dir, label) };
}

export async function readOperatorMemorySyncStatus(opts?: { dir?: string }): Promise<OperatorMemorySyncStatus> {
  const dir = opts?.dir ?? userMemoryDir();
  const status: OperatorMemorySyncStatus = {
    configured: isOperatorMemorySynced(dir),
    dir,
    remote: null,
    lastCommit: null,
    ahead: 0,
    behind: 0,
    uncommitted: 0,
    conflicts: [],
  };
  if (!status.configured) return status;

  const origin = await runGit(dir, ['remote', 'get-url', 'origin']);
  if (origin.ok) status.remote = redactRemoteUrl(origin.stdout.trim());

  const hasHead = await refExists(dir, 'HEAD');
  const hasOrigin = await refExists(dir, `refs/remotes/origin/${SYNC_BRANCH}`);
  if (hasHead) {
    const [sha = '', date = '', subject = ''] = (await git(dir, ['log', '-1', '--format=%H%x00%cI%x00%s'])).trim().split('\0');
    status.lastCommit = { sha, date, subject };
  }
  if (hasHead && hasOrigin) {
    const [ahead = '0', behind = '0'] = (await git(dir, ['rev-list', '--left-right', '--count', `HEAD...origin/${SYNC_BRANCH}`]))
      .trim()
      .split(/\s+/);
    status.ahead = Number(ahead);
    status.behind = Number(behind);
  } else if (hasHead) {
    status.ahead = Number((await git(dir, ['rev-list', '--count', 'HEAD'])).trim());
  } else if (hasOrigin) {
    status.behind = Number((await git(dir, ['rev-list', '--count', `origin/${SYNC_BRANCH}`])).trim());
  }

  status.uncommitted = splitLines(await git(dir, ['status', '--porcelain'])).length;
  status.conflicts = readMemoryFactsSync(dir, 'user').facts
    .filter((fact) => fact.review.includes(SYNC_CONFLICT_REVIEW))
    .map((fact) => fact.id);
  return status;
}

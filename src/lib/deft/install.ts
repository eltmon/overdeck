/**
 * Temporary Deft Directive install into one worktree (PAN-4820 WI-2).
 *
 * The install runs Directive's own installer, then hides everything it
 * deposited from git so the feature branch never carries it:
 * - created paths go into the `deft` block of the worktree exclude file
 *   (`src/lib/git/worktree-exclude.ts`: `<gitdir>/info/overdeck-exclude`, set
 *   as the worktree's `core.excludesFile`, seeded with the effective global
 *   excludes because a worktree value replaces them);
 * - tracked files the install changed get `--skip-worktree`;
 * - `core.hooksPath` is `.githooks` for this worktree only
 *   (`extensions.worktreeConfig`), and the shared value is restored.
 *
 * The snapshot (`install-snapshot.ts`) records the pre-install bytes, so the
 * undo (`removeDeftInstall`) is exact.
 *
 * Bun projects: Directive's launcher refuses `bun.lock`/`bun.lockb`, because
 * it only has npm and pnpm recipes. By operator decision the default runner
 * then adds the runtime with `bun add` and calls the runtime's own setup
 * step, which the launcher would otherwise hand off to.
 *
 * Async only: every child process goes through execFile.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, lstat, readFile, readlink, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { setExcludeBlock } from '../git/worktree-exclude.js';
import { installPreRebaseHook } from '../workspace-manager/worktree-ops.js';
import { isNativeDirectiveProject } from './archive.js';
import {
  type DeftInstallSnapshot,
  readDeftSnapshot,
  touchedDeftDir,
  writeDeftSnapshot,
} from './install-snapshot.js';
import { undoDeftChanges, type DeftUndoPlan } from './uninstall.js';

const execFileAsync = promisify(execFile);

/** AD-1: the install may need the registry and a package-manager run. */
export const DEFT_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;
const RUNTIME_PACKAGE = '@deftai/directive-runtime';
const HOOKS_PATH = '.githooks';
/** Overdeck's own runtime files for a Deft worktree; `.overdeck/` is not ignored in every project. */
const RUNTIME_EXCLUDES = ['/.overdeck/deft-install.json', '/.overdeck/deft-run-summary.jsonl', '/.overdeck/deft-lift/'];

export interface DeftInstallRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface DeftInstallDeps {
  /** Runs the install in the worktree. Defaults to `runDirectiveInstall`. */
  runInstall?: (worktree: string) => Promise<DeftInstallRun>;
}

export type DeftInstallResult =
  | { ok: true; mode: 'installed'; snapshot: DeftInstallSnapshot; alreadyInstalled: boolean }
  /** The project already holds a Directive deposit; nothing was installed. */
  | { ok: true; mode: 'directive-project' }
  /**
   * When `snapshot` is present, the worktree was changed and hidden; the
   * caller undoes it with `removeDeftInstall`.
   */
  | { ok: false; error: string; snapshot?: DeftInstallSnapshot };

// ── child processes ──────────────────────────────────────────────────────

async function run(
  file: string,
  args: string[],
  cwd: string,
  timeout = 60_000,
): Promise<DeftInstallRun> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, { cwd, timeout, maxBuffer: GIT_MAX_BUFFER });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: unknown; stdout?: string; stderr?: string; message?: string; killed?: boolean };
    const exitCode = typeof e.code === 'number' ? e.code : 1;
    const timedOut = e.killed ? `\ntimed out after ${timeout} ms` : '';
    return { exitCode, stdout: e.stdout ?? '', stderr: `${e.stderr ?? e.message ?? ''}${timedOut}` };
  }
}

async function git(cwd: string, args: string[]): Promise<DeftInstallRun> {
  return run('git', args, cwd);
}

async function gitOut(cwd: string, args: string[]): Promise<string> {
  const result = await git(cwd, args);
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

async function gitBytes(cwd: string, args: string[]): Promise<Buffer> {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'buffer', maxBuffer: GIT_MAX_BUFFER });
  return stdout;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// ── the default runner (AD-1, plus the Bun step) ─────────────────────────

async function isBunProject(worktree: string): Promise<boolean> {
  return (await exists(join(worktree, 'bun.lock'))) || (await exists(join(worktree, 'bun.lockb')));
}

function remaining(deadline: number): number {
  return Math.max(1, deadline - Date.now());
}

/**
 * Install Directive into `worktree`. npm and pnpm projects run the launcher
 * (`directive` when on PATH, else `npx --yes @deftai/directive`). Bun
 * projects run `bun add` for the runtime, then the runtime's setup step.
 */
export async function runDirectiveInstall(worktree: string): Promise<DeftInstallRun> {
  const deadline = Date.now() + DEFT_INSTALL_TIMEOUT_MS;
  if (!(await isBunProject(worktree))) {
    const onPath = (await run('sh', ['-c', 'command -v directive'], worktree)).exitCode === 0;
    const [file, args] = onPath
      ? ['directive', ['install', '--yes', '--root', worktree]]
      : ['npx', ['--yes', '@deftai/directive', 'install', '--yes', '--root', worktree]];
    return run(file, args, worktree, remaining(deadline));
  }

  const view = await run('npm', ['view', RUNTIME_PACKAGE, 'version'], worktree, remaining(deadline));
  const version = view.stdout.trim();
  if (view.exitCode !== 0 || !version) {
    return { exitCode: view.exitCode || 1, stdout: view.stdout, stderr: `npm view ${RUNTIME_PACKAGE} version failed\n${view.stderr}` };
  }
  const add = await run(
    'bun',
    ['add', '-d', '--exact', '--ignore-scripts', `${RUNTIME_PACKAGE}@${version}`],
    worktree,
    remaining(deadline),
  );
  if (add.exitCode !== 0) return add;
  const setup = await run(
    join(worktree, 'node_modules', '.bin', 'directive-runtime'),
    ['setup', '--operation', 'install', '--from', 'none', '--root', worktree],
    worktree,
    remaining(deadline),
  );
  return { exitCode: setup.exitCode, stdout: `${add.stdout}${setup.stdout}`, stderr: `${add.stderr}${setup.stderr}` };
}

// ── status snapshots ─────────────────────────────────────────────────────

interface StatusEntry {
  /** Porcelain v1 XY code, e.g. ` M`, `??`, `!!`. */
  code: string;
  /** Relative, '/'-separated; collapsed directories end with '/'. */
  path: string;
}

function parseStatusZ(out: string): StatusEntry[] {
  const parts = out.split('\0');
  const entries: StatusEntry[] = [];
  for (let i = 0; i < parts.length; i++) {
    const record = parts[i];
    if (!record) continue;
    const code = record.slice(0, 2);
    entries.push({ code, path: record.slice(3) });
    // Renames and copies carry the original path as the next record.
    if (code[0] === 'R' || code[0] === 'C') i++;
  }
  return entries;
}

async function statusEntries(worktree: string, ignored: boolean): Promise<StatusEntry[]> {
  const args = ['status', '--porcelain=v1', '-z', '--untracked-files=all'];
  if (ignored) args.push('--ignored=matching');
  return parseStatusZ(await gitOut(worktree, args));
}

const isUntrackedOrIgnored = (entry: StatusEntry): boolean => entry.code === '??' || entry.code === '!!';
const isDir = (path: string): boolean => path.endsWith('/');

/** The bytes of a file (or a symlink's target text); null for a missing path or a directory. */
async function readEntryBytes(worktree: string, path: string): Promise<Buffer | null> {
  const full = join(worktree, path);
  try {
    const stat = await lstat(full);
    if (stat.isSymbolicLink()) return Buffer.from(await readlink(full), 'utf8');
    if (!stat.isFile()) return null;
    return await readFile(full);
  } catch {
    return null;
  }
}

function sha256(bytes: Buffer | null): string {
  return bytes === null ? '' : createHash('sha256').update(bytes).digest('hex');
}

interface BeforeState {
  entries: StatusEntry[];
  /** Pre-install bytes of every listed file (dirty tracked, untracked, ignored). */
  bytes: Map<string, Buffer>;
}

async function captureBefore(worktree: string): Promise<BeforeState> {
  const entries = await statusEntries(worktree, true);
  const bytes = new Map<string, Buffer>();
  for (const entry of entries) {
    if (isDir(entry.path)) continue;
    const content = await readEntryBytes(worktree, entry.path);
    if (content !== null) bytes.set(entry.path, content);
  }
  return { entries, bytes };
}

/** Every ancestor directory of a path, top first, each ending with '/'. */
function ancestors(path: string): string[] {
  const parts = path.replace(/\/$/, '').split('/');
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(`${parts.slice(0, i).join('/')}/`);
  return out;
}

/**
 * New paths, with a directory collapsed to `dir/` when nothing under it
 * existed before (no tracked file and no pre-install listing entry).
 */
function collapseCreated(created: string[], occupied: Set<string>): string[] {
  const out = new Set<string>();
  for (const path of created) {
    const root = ancestors(path).find(dir => !occupied.has(dir));
    out.add(root ?? path);
  }
  const sorted = [...out].sort();
  return sorted.filter(path => !sorted.some(other => other !== path && isDir(other) && path.startsWith(other)));
}

// ── hiding ───────────────────────────────────────────────────────────────

/** Escape a path for one anchored gitignore line. */
function excludeLine(path: string): string {
  const escaped = path.replace(/[\\*?[]/g, ch => `\\${ch}`).replace(/ $/, '\\ ');
  return `/${escaped}`;
}

function tail(text: string, lines: number): string {
  return text.trimEnd().split('\n').slice(-lines).join('\n');
}

interface InstallChanges {
  createdPaths: string[];
  modifiedTracked: DeftInstallSnapshot['modifiedTracked'];
  modifiedUntracked: DeftInstallSnapshot['modifiedUntracked'];
  touchedPreexisting: string[];
}

function hasChanges(c: InstallChanges): boolean {
  return c.createdPaths.length + c.modifiedTracked.length + c.modifiedUntracked.length + c.touchedPreexisting.length > 0;
}

async function computeChanges(worktree: string, before: BeforeState): Promise<InstallChanges> {
  const after = await statusEntries(worktree, true);
  const beforePaths = new Set(before.entries.map(entry => entry.path));
  const beforeByPath = new Map(before.entries.map(entry => [entry.path, entry]));

  const occupied = new Set<string>();
  for (const path of (await gitOut(worktree, ['ls-files', '-z'])).split('\0')) {
    for (const dir of ancestors(path)) occupied.add(dir);
  }
  for (const entry of before.entries) {
    for (const dir of ancestors(entry.path)) occupied.add(dir);
    if (isDir(entry.path)) occupied.add(entry.path);
  }
  const createdPaths = collapseCreated(
    after.filter(entry => isUntrackedOrIgnored(entry) && !beforePaths.has(entry.path)).map(entry => entry.path),
    occupied,
  );

  const modifiedTracked: InstallChanges['modifiedTracked'] = [];
  for (const entry of after) {
    if (isUntrackedOrIgnored(entry)) continue;
    const current = await readEntryBytes(worktree, entry.path);
    const previous = beforeByPath.get(entry.path);
    let restore: Buffer | undefined;
    if (previous && !isUntrackedOrIgnored(previous)) {
      // Dirty before the install: hide it only when the install changed it again.
      restore = before.bytes.get(entry.path);
      if (restore === undefined || sha256(restore) === sha256(current)) continue;
    } else {
      // Clean before the install, and the index is HEAD after `git reset -q`.
      restore = await gitBytes(worktree, ['show', `HEAD:${entry.path}`]);
    }
    modifiedTracked.push({
      path: entry.path,
      restoreContentB64: restore.toString('base64'),
      postInstallSha256: sha256(current),
      baseBlob: (await gitOut(worktree, ['rev-parse', `HEAD:${entry.path}`])).trim(),
    });
  }

  const modifiedUntracked: InstallChanges['modifiedUntracked'] = [];
  for (const entry of before.entries) {
    if (!isUntrackedOrIgnored(entry) || isDir(entry.path)) continue;
    const restore = before.bytes.get(entry.path);
    if (restore === undefined) continue;
    const current = await readEntryBytes(worktree, entry.path);
    if (sha256(current) === sha256(restore)) continue;
    modifiedUntracked.push({ path: entry.path, restoreContentB64: restore.toString('base64'), postInstallSha256: sha256(current) });
  }

  const touchedPreexisting: string[] = [];
  for (const entry of before.entries) {
    if (!isUntrackedOrIgnored(entry) || !isDir(entry.path)) continue;
    if (await exists(join(worktree, touchedDeftDir(entry.path)))) touchedPreexisting.push(entry.path);
  }

  return { createdPaths, modifiedTracked, modifiedUntracked, touchedPreexisting };
}

/** Put the shared `core.hooksPath` back to its pre-install value when an installer changed it. */
async function restoreSharedHooksPath(worktree: string, before: string | null): Promise<void> {
  const now = (await git(worktree, ['config', '--local', '--get', 'core.hooksPath'])).stdout.trim() || null;
  if (now === before) return;
  if (before === null) await git(worktree, ['config', '--local', '--unset', 'core.hooksPath']);
  else await gitOut(worktree, ['config', '--local', 'core.hooksPath', before]);
}

/**
 * Undo a half-done install that has no snapshot yet: restore the shared
 * hooks path, unstage, and put back whatever the diff against `before` shows.
 * Best effort: each step runs even when an earlier one fails.
 */
async function rollbackInstall(worktree: string, before: BeforeState, sharedHooksPathBefore: string | null): Promise<void> {
  await restoreSharedHooksPath(worktree, sharedHooksPathBefore).catch(() => undefined);
  await git(worktree, ['reset', '-q']).catch(() => undefined);
  let plan: DeftUndoPlan = { createdPaths: [], modifiedTracked: [], modifiedUntracked: [], touchedPreexisting: [] };
  try {
    plan = await computeChanges(worktree, before);
  } catch {
    // Nothing more is knowable; the wiring is still cleared below.
  }
  await undoDeftChanges(worktree, plan).catch(() => undefined);
}

/**
 * The install writes `--worktree` config, so it must run at the root of a
 * linked worktree: a subdirectory or the primary checkout would wire the
 * wrong checkout.
 */
async function linkedWorktreeRootError(worktree: string): Promise<string | null> {
  try {
    const top = (await gitOut(worktree, ['rev-parse', '--show-toplevel'])).trim();
    const gitDir = resolve(worktree, (await gitOut(worktree, ['rev-parse', '--git-dir'])).trim());
    const commonDir = resolve(worktree, (await gitOut(worktree, ['rev-parse', '--git-common-dir'])).trim());
    if ((await realpath(top)) !== (await realpath(worktree))) return `${worktree} is not the root of its git worktree (${top})`;
    if ((await realpath(gitDir)) === (await realpath(commonDir))) return `${worktree} is a primary checkout, not a linked issue worktree`;
    return null;
  } catch (error) {
    return `${worktree} is not a git worktree: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ── the install ──────────────────────────────────────────────────────────

/**
 * Install Directive into `worktree` and hide the deposit from git. Idempotent:
 * an existing snapshot is returned as is. Refuses staged or unmerged changes,
 * because the post-install `git reset -q` would unstage them.
 */
export async function installDeftIntoWorktree(
  worktree: string,
  issueId: string,
  deps: DeftInstallDeps = {},
): Promise<DeftInstallResult> {
  const runInstall = deps.runInstall ?? runDirectiveInstall;

  // 1. Early returns.
  const existing = await readDeftSnapshot(worktree);
  if (existing) return { ok: true, mode: 'installed', snapshot: existing, alreadyInstalled: true };
  const notLinked = await linkedWorktreeRootError(worktree);
  if (notLinked) return { ok: false, error: notLinked };
  if (await isNativeDirectiveProject(worktree)) return { ok: true, mode: 'directive-project' };
  const staged = await git(worktree, ['diff', '--cached', '--quiet']);
  const unmerged = (await gitOut(worktree, ['ls-files', '-u'])).trim();
  if (staged.exitCode !== 0 || unmerged) {
    return { ok: false, error: 'commit or discard staged changes first' };
  }

  // 2. Record the before state. The worktree hooksPath makes Directive's
  // setup see `.githooks`, so it neither refuses a foreign value nor writes
  // the shared config.
  const before = await captureBefore(worktree);
  const sharedHooksPathBefore = (await git(worktree, ['config', '--local', '--get', 'core.hooksPath'])).stdout.trim() || null;
  // Any failure before the snapshot exists is rolled back here: nothing
  // else could undo it later.
  let snapshotWritten = false;
  try {
    await gitOut(worktree, ['config', 'extensions.worktreeConfig', 'true']);
    await gitOut(worktree, ['config', '--worktree', 'core.hooksPath', HOOKS_PATH]);

    // 3. Run the install.
    const installRun = await runInstall(worktree);

    // 4. Restore the shared config (an installer may still write it).
    await restoreSharedHooksPath(worktree, sharedHooksPathBefore);

    // 5. Unstage what the install added.
    await gitOut(worktree, ['reset', '-q']);

    // 6. Diff the after state against the before state. A failed install that
    // changed nothing leaves nothing to hide: drop the worktree hooks path and
    // stop before the rebase guard writes into `.githooks/`.
    let changes = await computeChanges(worktree, before);
    if (installRun.exitCode !== 0 && !hasChanges(changes)) {
      await git(worktree, ['config', '--worktree', '--unset', 'core.hooksPath']);
      return { ok: false, error: `directive install failed: ${tail(installRun.stderr || installRun.stdout, 20)}` };
    }
    // Re-point the rebase guard at the new hooks path, then diff again so its files are hidden too.
    await installPreRebaseHook(worktree);
    changes = await computeChanges(worktree, before);
    const { createdPaths, modifiedTracked, modifiedUntracked, touchedPreexisting } = changes;

    // 7. Hide.
    const { file: excludeFile } = await setExcludeBlock(worktree, 'deft', [...RUNTIME_EXCLUDES, ...createdPaths.map(excludeLine)]);
    if (modifiedTracked.length > 0) {
      await gitOut(worktree, ['update-index', '--skip-worktree', '--', ...modifiedTracked.map(entry => entry.path)]);
    }

    // 8. Write the snapshot, then prove the worktree looks as it did before.
    const snapshot: DeftInstallSnapshot = {
      version: 1,
      issueId,
      installedAt: new Date().toISOString(),
      runtimeVersion: await readRuntimeVersion(worktree),
      createdPaths,
      modifiedTracked,
      modifiedUntracked,
      touchedPreexisting,
      sharedHooksPathBefore,
      excludeFile,
    };
    await writeDeftSnapshot(worktree, snapshot);
    snapshotWritten = true;

    if (installRun.exitCode !== 0) {
      return { ok: false, error: `directive install failed: ${tail(installRun.stderr || installRun.stdout, 20)}`, snapshot };
    }

    const beforeLines = new Set(before.entries.map(entry => `${entry.code} ${entry.path}`));
    const hidden = [...createdPaths, ...modifiedTracked.map(entry => entry.path)];
    const extra = (await statusEntries(worktree, false))
      .filter(entry =>
        !beforeLines.has(`${entry.code} ${entry.path}`) ||
        hidden.some(path => entry.path === path || (isDir(path) && entry.path.startsWith(path))))
      .map(entry => `${entry.code} ${entry.path}`);
    if (extra.length > 0) {
      return { ok: false, error: `the Directive install is still visible to git:\n${extra.join('\n')}`, snapshot };
    }
    return { ok: true, mode: 'installed', snapshot, alreadyInstalled: false };
  } catch (error) {
    if (!snapshotWritten) await rollbackInstall(worktree, before, sharedHooksPathBefore);
    throw error;
  }
}

async function readRuntimeVersion(worktree: string): Promise<string | null> {
  try {
    const pkg = JSON.parse(await readFile(join(worktree, 'package.json'), 'utf8')) as {
      devDependencies?: Record<string, unknown>;
      dependencies?: Record<string, unknown>;
    };
    const version = pkg.devDependencies?.[RUNTIME_PACKAGE] ?? pkg.dependencies?.[RUNTIME_PACKAGE];
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}

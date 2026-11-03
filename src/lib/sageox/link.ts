/**
 * `pan skills pack sageox link` (PAN-4852 WI-14): create a project's SageOx
 * binding without touching any of its checkouts.
 *
 * `ox init` runs in a detached throwaway worktree under `<packdir>/tmp/`
 * (AD-12), in host-managed mode with the network on. The untracked,
 * non-ignored files it leaves under `.sageox/` become the binding (AD-11).
 * `link` then waits up to 120 s for `ox` to clone the ledger (AD-13) and
 * removes the worktree. The ledger is keyed by the binding's `repo_id`, not
 * by the worktree, so removing the worktree afterwards is safe.
 *
 * Every subprocess (git and ox) goes through `deps.run`, so tests can fake
 * `ox` and pass git through to a real runner.
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { resolveDefaultBranchForRepo } from '../project-repos.js';
import { getProjectSync } from '../projects.js';
import { packCacheDir } from '../skill-packs/sources.js';
import { resolveOxBinary, type OxBinary } from './binary.js';
import { bindingDir, defaultBranchTracksSageox, readBinding, writeBinding } from './binding.js';

export interface LinkDeps {
  run: (cmd: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv; timeout: number }) => Promise<{ stdout: string }>;
  resolveBinary: () => Promise<OxBinary>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export type LinkResult =
  | { status: 'linked'; dir: string; files: string[]; ledger: 'ready' | 'pending'; bin: string }
  | { status: 'already-linked'; dir: string }
  | { status: 'committed' };

export class SageoxLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SageoxLinkError';
  }
}

const GIT_TIMEOUT_MS = 120_000;
const OX_INIT_TIMEOUT_MS = 5 * 60_000;
const OX_STATUS_TIMEOUT_MS = 30_000;
export const LEDGER_POLL_INTERVAL_MS = 5_000;
export const LEDGER_POLL_LIMIT_MS = 120_000;
const STDERR_TAIL_LINES = 20;

/**
 * AD-13 checkpoint, read at the pinned fork commit 0e6c7e2d
 * (overdeck/host-managed-v0.25.0): `ox status --json` prints
 * `ledger: { configured, path, exists, error, … }` (`internal/status/types.go`,
 * `LedgerJSON`), filled in `cmd/ox/status.go` `buildStatusJSON` from
 * `getGitRepoStatus(localCfg.Ledger.Path)`. `configured` means
 * `.sageox/config.local.toml` names a ledger path; `exists` is an `os.Stat` of
 * that path; `error` is `"not a git repo"` while the clone is still incomplete.
 * `ox status --json` exits 0 even when setup is incomplete, so readiness is
 * read from stdout only.
 */
export const LEDGER_READY_FIELD = 'ledger.exists';

function isLedgerReady(stdout: string): boolean {
  let parsed: { ledger?: { configured?: unknown; exists?: unknown; error?: unknown } | null } | null;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return false;
  }
  const ledger = parsed?.ledger;
  return ledger?.configured === true && ledger.exists === true && !ledger.error;
}

const execFileAsync = promisify(execFile);

/** promisified execFile; stdin is closed at once so `ox` never waits on a prompt. */
const execFileRunner: LinkDeps['run'] = async (cmd, args, opts) => {
  const pending = execFileAsync(cmd, args, { ...opts, maxBuffer: 16 * 1024 * 1024 });
  pending.child.stdin?.end();
  const { stdout } = await pending;
  return { stdout };
};

const defaultSleep = (ms: number): Promise<void> => new Promise(done => setTimeout(done, ms));

/** AD-14: where `ox login` keeps its token (`internal/paths/paths.go` `ConfigDir`). */
export function sageoxAuthFilePath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.OX_XDG_DISABLE) return join(homedir(), '.sageox', 'config', 'auth.json');
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'sageox', 'auth.json');
}

/** True when the token file exists and is non-empty. Never reads its content (D1). */
async function hasSageoxLogin(): Promise<boolean> {
  try {
    const info = await stat(sageoxAuthFilePath());
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

function stderrTail(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  const text = typeof stderr === 'string' ? stderr : Buffer.isBuffer(stderr) ? stderr.toString('utf8') : '';
  const lines = text.trimEnd().split('\n').filter(line => line.length > 0);
  return lines.slice(-STDERR_TAIL_LINES).join('\n');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Paths from `git status --porcelain -z`; a rename or copy also reports its source path. */
function porcelainPaths(stdout: string): string[] {
  const tokens = stdout.split('\0').filter(token => token.length > 0);
  const paths: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i];
    paths.push(entry.slice(3));
    if (entry[0] === 'R' || entry[0] === 'C') {
      i++;
      if (i < tokens.length) paths.push(tokens[i]);
    }
  }
  return paths;
}

interface LinkContext {
  deps: Required<LinkDeps>;
  root: string;
  defaultBranch: string;
  bin: string;
  team?: string;
}

function oxEnv(dir: string): NodeJS.ProcessEnv {
  return { ...process.env, OX_HOST_MANAGED: '1', OX_HOST_NETWORK: 'on', OX_PROJECT_ROOT: dir };
}

async function runOxInit(ctx: LinkContext, dir: string): Promise<void> {
  const args = ['init', '--quiet', ...(ctx.team ? ['--team', ctx.team] : [])];
  try {
    await ctx.deps.run(ctx.bin, args, { cwd: dir, env: oxEnv(dir), timeout: OX_INIT_TIMEOUT_MS });
  } catch (error) {
    const tail = stderrTail(error);
    throw new SageoxLinkError(`ox init failed: ${errorMessage(error).split('\n')[0]}${tail ? `\n${tail}` : ''}`);
  }
}

/** Paths `ox init` changed outside `.sageox/` (AD-12 step 7). */
async function pathsOutsideSageox(ctx: LinkContext, dir: string): Promise<string[]> {
  const { stdout } = await ctx.deps.run('git', ['-C', dir, 'status', '--porcelain', '-z', '--untracked-files=all'], {
    cwd: dir,
    timeout: GIT_TIMEOUT_MS,
  });
  return porcelainPaths(stdout).filter(path => !path.startsWith('.sageox/'));
}

/**
 * AD-11: the untracked files under `.sageox/` that its own `.gitignore` files
 * do not ignore. Only per-directory `.gitignore` files are honored: a
 * primary-checkout `info/exclude` block (H2) hides `/.sageox/` in every
 * worktree of the repo and would otherwise empty the list.
 */
async function bindingFiles(ctx: LinkContext, dir: string): Promise<string[]> {
  const { stdout } = await ctx.deps.run(
    'git',
    ['-C', dir, 'ls-files', '--others', '-z', '--exclude-per-directory=.gitignore', '--', '.sageox'],
    { cwd: dir, timeout: GIT_TIMEOUT_MS },
  );
  return stdout
    .split('\0')
    .filter(path => path.startsWith('.sageox/'))
    .map(path => path.slice('.sageox/'.length))
    .sort();
}

async function pollLedger(ctx: LinkContext, dir: string): Promise<'ready' | 'pending'> {
  const start = ctx.deps.now();
  for (;;) {
    try {
      const { stdout } = await ctx.deps.run(ctx.bin, ['status', '--json'], {
        cwd: dir,
        env: oxEnv(dir),
        timeout: OX_STATUS_TIMEOUT_MS,
      });
      if (isLedgerReady(stdout)) return 'ready';
    } catch {
      // A failed status read means "not ready yet"; the binding is already stored.
    }
    if (ctx.deps.now() - start >= LEDGER_POLL_LIMIT_MS) return 'pending';
    await ctx.deps.sleep(LEDGER_POLL_INTERVAL_MS);
  }
}

/** Deletes a throwaway directory only when it resolves inside `<packdir>/tmp/` (NFR-3). */
async function removeTmpDir(tmpRoot: string, dir: string): Promise<void> {
  const rel = relative(tmpRoot, resolve(dir));
  if (!rel || rel.startsWith('..') || rel.includes(sep)) return;
  await rm(dir, { recursive: true, force: true });
}

async function removeWorktree(ctx: LinkContext, tmpRoot: string, dir: string): Promise<void> {
  try {
    await ctx.deps.run('git', ['-C', ctx.root, 'worktree', 'remove', '--force', dir], { cwd: ctx.root, timeout: GIT_TIMEOUT_MS });
  } catch {
    await removeTmpDir(tmpRoot, dir);
  }
  try {
    await ctx.deps.run('git', ['-C', ctx.root, 'worktree', 'prune'], { cwd: ctx.root, timeout: GIT_TIMEOUT_MS });
  } catch {
    // A stale worktree record is harmless; the next prune clears it.
  }
}

async function storeAndPoll(ctx: LinkContext, projectKey: string, dir: string): Promise<{ files: string[]; ledger: 'ready' | 'pending' }> {
  const files = await bindingFiles(ctx, dir);
  try {
    await writeBinding(projectKey, join(dir, '.sageox'), files);
  } catch (error) {
    throw new SageoxLinkError(errorMessage(error));
  }
  const ledger = await pollLedger(ctx, dir);
  return { files, ledger };
}

/** AD-12 fallback: a fresh shallow clone of `origin/<default>`, deleted afterwards. */
async function linkInClone(ctx: LinkContext, projectKey: string, tmpRoot: string, tmp: string) {
  const clone = `${tmp}-clone`;
  try {
    const { stdout } = await ctx.deps.run('git', ['-C', ctx.root, 'remote', 'get-url', 'origin'], { cwd: ctx.root, timeout: GIT_TIMEOUT_MS });
    const url = stdout.trim();
    await ctx.deps.run('git', ['clone', '--quiet', '--depth', '1', '--branch', ctx.defaultBranch, '--', url, clone], {
      cwd: tmpRoot,
      timeout: GIT_TIMEOUT_MS,
    });
    await runOxInit(ctx, clone);
    const outside = await pathsOutsideSageox(ctx, clone);
    if (outside.length > 0) {
      throw new SageoxLinkError(`ox init wrote outside .sageox/: ${outside.join(', ')}`);
    }
    return await storeAndPoll(ctx, projectKey, clone);
  } finally {
    await removeTmpDir(tmpRoot, clone);
  }
}

export async function linkSageoxProject(projectKey: string, opts: { team?: string }, deps?: LinkDeps): Promise<LinkResult> {
  const project = getProjectSync(projectKey);
  if (!project?.path) throw new SageoxLinkError(`unknown project: ${projectKey}`);
  const root = project.path;
  const defaultBranch = resolveDefaultBranchForRepo(root, projectKey);

  const binary = await (deps?.resolveBinary ?? resolveOxBinary)();
  if (!binary.ok) throw new SageoxLinkError(binary.message);

  if (!(await hasSageoxLogin())) throw new SageoxLinkError(`SageOx login not found. Run: ${binary.bin} login`);

  const ctx: LinkContext = {
    deps: {
      run: deps?.run ?? execFileRunner,
      resolveBinary: deps?.resolveBinary ?? resolveOxBinary,
      now: deps?.now ?? Date.now,
      sleep: deps?.sleep ?? defaultSleep,
    },
    root,
    defaultBranch,
    bin: binary.bin,
    team: opts.team,
  };

  try {
    await ctx.deps.run('git', ['-C', root, 'fetch', '--quiet', 'origin', defaultBranch], { cwd: root, timeout: GIT_TIMEOUT_MS });
  } catch (error) {
    throw new SageoxLinkError(`git fetch origin ${defaultBranch} failed: ${errorMessage(error).split('\n')[0]}`);
  }
  if (await defaultBranchTracksSageox(root, defaultBranch)) return { status: 'committed' };

  const dir = bindingDir(projectKey);
  if (await readBinding(projectKey)) return { status: 'already-linked', dir };

  const tmpRoot = join(packCacheDir('sageox'), 'tmp');
  await mkdir(tmpRoot, { recursive: true });
  const tmp = join(tmpRoot, `link-${projectKey}-${randomBytes(4).toString('hex')}`);

  let worktreeAdded = false;
  try {
    try {
      await ctx.deps.run('git', ['-C', root, 'worktree', 'add', '--quiet', '--detach', tmp, `origin/${defaultBranch}`], {
        cwd: root,
        timeout: GIT_TIMEOUT_MS,
      });
      worktreeAdded = true;
    } catch {
      // AD-12: no worktree → fresh clone fallback.
    }

    let result: { files: string[]; ledger: 'ready' | 'pending' };
    if (worktreeAdded) {
      await runOxInit(ctx, tmp);
      if ((await pathsOutsideSageox(ctx, tmp)).length > 0) {
        await removeWorktree(ctx, tmpRoot, tmp);
        worktreeAdded = false;
        result = await linkInClone(ctx, projectKey, tmpRoot, tmp);
      } else {
        result = await storeAndPoll(ctx, projectKey, tmp);
      }
    } else {
      result = await linkInClone(ctx, projectKey, tmpRoot, tmp);
    }
    return { status: 'linked', dir, files: result.files, ledger: result.ledger, bin: binary.bin };
  } finally {
    if (worktreeAdded) await removeWorktree(ctx, tmpRoot, tmp);
  }
}

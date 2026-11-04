/**
 * PAN-4852 WI-14: `linkSageoxProject` against a scratch project repo with a
 * bare `origin`, the binding store under a temp OVERDECK_HOME, and an injected
 * runner that passes git through and fakes `ox init` / `ox status --json`.
 */
import { execFile, execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { overdeckHome } = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sageox-link-home-'));
  process.env.OVERDECK_HOME = home;
  return { overdeckHome: home };
});

import { invalidateProjectsConfigCache } from '../../projects.js';
import type { OxBinary } from '../binary.js';
import { bindingDir, readBinding } from '../binding.js';
import { linkSageoxProject, SageoxLinkError, type LinkDeps } from '../link.js';

const execFileAsync = promisify(execFile);
const scratch = mkdtempSync(join(tmpdir(), 'sageox-link-scratch-'));
const FIVE_FILES = ['.gitignore', '.repo_0a1b2c3d-1111-2222-3333-444455556666', 'README.md', 'config.json', 'discovered.jsonl'];
const BIN = '/fake/pack/abc/bin/ox';

const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8' });
}

let caseNo = 0;
let root = '';
let configHome = '';

/** A project repo on `main` pushed to a bare `origin`, registered as project `app`. */
function makeProject(trackSageox = false): string {
  const dir = join(scratch, `case-${++caseNo}`);
  const repo = join(dir, 'app');
  const bare = join(dir, 'origin.git');
  mkdirSync(repo, { recursive: true });
  git(dir, ['init', '-q', '--bare', '-b', 'main', bare]);
  git(repo, ['init', '-q', '-b', 'main']);
  writeFileSync(join(repo, 'README.md'), 'readme\n');
  if (trackSageox) {
    mkdirSync(join(repo, '.sageox'));
    writeFileSync(join(repo, '.sageox', 'config.json'), '{}\n');
  }
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'init']);
  git(repo, ['remote', 'add', 'origin', bare]);
  git(repo, ['push', '-q', 'origin', 'main']);
  writeFileSync(join(overdeckHome, 'projects.yaml'), `projects:\n  app:\n    name: App\n    path: ${repo}\n`);
  invalidateProjectsConfigCache();
  return repo;
}

function login(): void {
  mkdirSync(join(configHome, 'sageox'), { recursive: true });
  writeFileSync(join(configHome, 'sageox', 'auth.json'), '{"token":"t"}\n');
}

/** Writes what `ox init` leaves: the five link files plus ignored runtime data. */
function fakeOxInit(cwd: string): void {
  const sageox = join(cwd, '.sageox');
  mkdirSync(join(sageox, 'logs'), { recursive: true });
  for (const file of FIVE_FILES) {
    writeFileSync(join(sageox, file), file === '.gitignore' ? 'logs/\nconfig.local.toml\n' : `content of ${file}\n`);
  }
  writeFileSync(join(sageox, 'logs', 'init.log'), 'log\n');
  writeFileSync(join(sageox, 'config.local.toml'), '[ledger]\n');
}

const READY = JSON.stringify({ ledger: { configured: true, path: '/data/ledgers/repo_x', exists: true, status: 'synced' } });
const NOT_CLONED = JSON.stringify({ ledger: { configured: true, path: '/data/ledgers/repo_x', exists: false, error: 'not found' } });

interface FakeOx { init?: (cwd: string) => void; status?: () => string }

function makeDeps(ox: FakeOx = {}): LinkDeps & { calls: { cmd: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv }[] } {
  const calls: { cmd: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv }[] = [];
  return {
    calls,
    resolveBinary: async (): Promise<OxBinary> => ({ ok: true, bin: BIN, binDir: '/fake/pack/abc/bin', commit: 'a'.repeat(40) }),
    run: async (cmd, args, opts) => {
      calls.push({ cmd, args, cwd: opts.cwd, env: opts.env });
      if (cmd === 'git') {
        const { stdout } = await execFileAsync('git', args, { cwd: opts.cwd, env: gitEnv });
        return { stdout };
      }
      if (cmd === BIN && args[0] === 'init') {
        (ox.init ?? fakeOxInit)(opts.cwd);
        return { stdout: '' };
      }
      if (cmd === BIN && args[0] === 'status') return { stdout: (ox.status ?? (() => READY))() };
      throw new Error(`unexpected command: ${cmd} ${args.join(' ')}`);
    },
  };
}

/**
 * Real git calls finish on real event-loop turns (setImmediate stays real), so
 * fake time advances only while the ledger poll sleeps on a fake setTimeout.
 * The fake runner passes git through without a `timeout` option on purpose: a
 * child-process timer would count in getTimerCount() and advance the clock
 * during git calls, which would change the exact poll count asserted below.
 */
async function driveFakeClock<T>(work: Promise<T>): Promise<T> {
  let settled = false;
  const tracked = work.finally(() => { settled = true; });
  const deadline = performance.now() + 20_000;
  while (!settled && performance.now() < deadline) {
    await new Promise(done => setImmediate(done));
    if (vi.getTimerCount() > 0) await vi.advanceTimersByTimeAsync(5_000);
  }
  return tracked;
}

function worktreeCount(repo: string): number {
  return git(repo, ['worktree', 'list', '--porcelain']).split('\n').filter(line => line.startsWith('worktree ')).length;
}

function tmpEntries(): string[] {
  const tmp = join(overdeckHome, 'packs', 'sageox', 'tmp');
  return existsSync(tmp) ? readdirSync(tmp) : [];
}

beforeEach(() => {
  rmSync(join(overdeckHome, 'packs'), { recursive: true, force: true });
  configHome = join(scratch, `config-${caseNo + 1}`);
  vi.stubEnv('XDG_CONFIG_HOME', configHome);
  vi.stubEnv('OX_XDG_DISABLE', '');
  root = makeProject();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

afterAll(() => {
  rmSync(overdeckHome, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

describe('linkSageoxProject', () => {
  it('stores the five link files, removes the throwaway worktree and leaves the checkout unchanged', async () => {
    login();
    const statusBefore = git(root, ['status', '--porcelain']);
    const deps = makeDeps();

    const result = await linkSageoxProject('app', {}, deps);

    expect(result).toEqual({ status: 'linked', dir: bindingDir('app'), files: [...FIVE_FILES].sort(), ledger: 'ready', bin: BIN });
    expect(await readBinding('app')).toEqual({ files: [...FIVE_FILES].sort() });
    expect(worktreeCount(root)).toBe(1);
    expect(tmpEntries()).toEqual([]);
    expect(git(root, ['status', '--porcelain'])).toBe(statusBefore);
    expect(existsSync(join(root, '.sageox'))).toBe(false);

    const init = deps.calls.find(call => call.cmd === BIN && call.args[0] === 'init');
    expect(init?.args).toEqual(['init', '--quiet']);
    expect(init?.cwd).toMatch(/packs\/sageox\/tmp\/link-app-[0-9a-f]{8}$/);
    expect(init?.env).toMatchObject({ OX_HOST_MANAGED: '1', OX_HOST_NETWORK: 'on', OX_PROJECT_ROOT: init?.cwd });
  });

  it('passes --team through to ox init', async () => {
    login();
    const deps = makeDeps();
    await linkSageoxProject('app', { team: 'core' }, deps);
    expect(deps.calls.find(call => call.cmd === BIN && call.args[0] === 'init')?.args).toEqual(['init', '--quiet', '--team', 'core']);
  });

  it('refuses without a SageOx login and creates no worktree', async () => {
    const deps = makeDeps();
    const error = await linkSageoxProject('app', {}, deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SageoxLinkError);
    expect((error as Error).message.startsWith(`SageOx login not found. Run: ${BIN} login`)).toBe(true);
    expect(deps.calls).toEqual([]);
    expect(worktreeCount(root)).toBe(1);
  });

  it('treats an empty auth.json as no login', async () => {
    mkdirSync(join(configHome, 'sageox'), { recursive: true });
    writeFileSync(join(configHome, 'sageox', 'auth.json'), '');
    await expect(linkSageoxProject('app', {}, makeDeps())).rejects.toThrow(/^SageOx login not found/);
  });

  it('reports committed and never runs ox init when main tracks .sageox/config.json', async () => {
    root = makeProject(true);
    login();
    const deps = makeDeps();
    expect(await linkSageoxProject('app', {}, deps)).toEqual({ status: 'committed' });
    expect(deps.calls.some(call => call.cmd === BIN)).toBe(false);
    expect(worktreeCount(root)).toBe(1);
  });

  it('reports already-linked when a binding exists', async () => {
    login();
    await linkSageoxProject('app', {}, makeDeps());
    const deps = makeDeps();
    expect(await linkSageoxProject('app', {}, deps)).toEqual({ status: 'already-linked', dir: bindingDir('app') });
    expect(deps.calls.some(call => call.cmd === BIN)).toBe(false);
  });

  it('refuses an unknown project and a missing build', async () => {
    login();
    await expect(linkSageoxProject('nope', {}, makeDeps())).rejects.toThrow('unknown project: nope');
    const deps = makeDeps();
    deps.resolveBinary = async () => ({ ok: false, reason: 'not-built', commit: 'a'.repeat(40), message: 'ox is not built for the sageox pack (aaaaaaa); run pan skills pack sync sageox' });
    await expect(linkSageoxProject('app', {}, deps)).rejects.toThrow(/run pan skills pack sync sageox/);
  });

  it('collects the files when a primary-checkout info/exclude block hides .sageox/', async () => {
    login();
    appendFileSync(join(root, '.git', 'info', 'exclude'), '# overdeck:sageox begin\n/.sageox/\n# overdeck:sageox end\n');
    const result = await linkSageoxProject('app', {}, makeDeps());
    expect(result).toMatchObject({ status: 'linked', files: [...FIVE_FILES].sort() });
  });

  it('retries once in a fresh clone when ox init writes outside .sageox/', async () => {
    login();
    const inits: string[] = [];
    const deps = makeDeps({
      init: cwd => {
        inits.push(cwd);
        fakeOxInit(cwd);
        if (inits.length === 1) writeFileSync(join(cwd, 'AGENTS.md'), 'marker\n');
      },
    });
    const result = await linkSageoxProject('app', {}, deps);
    expect(result).toMatchObject({ status: 'linked', files: [...FIVE_FILES].sort(), ledger: 'ready' });
    expect(inits).toHaveLength(2);
    expect(inits[1]).toBe(`${inits[0]}-clone`);
    expect(worktreeCount(root)).toBe(1);
    expect(tmpEntries()).toEqual([]);
  });

  it('fails with the tail of ox stderr when ox init fails, and removes the worktree', async () => {
    login();
    const deps = makeDeps({
      init: () => {
        throw Object.assign(new Error('Command failed: ox init'), {
          stderr: `${Array.from({ length: 25 }, (_, i) => `line ${i}`).join('\n')}\n`,
        });
      },
    });
    const error = (await linkSageoxProject('app', {}, deps).catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(SageoxLinkError);
    expect(error.message).toContain('ox init failed: Command failed: ox init');
    expect(error.message).toContain('line 24');
    expect(error.message).toContain('line 5');
    expect(error.message).not.toContain('line 4\n');
    expect(await readBinding('app')).toBeNull();
    expect(worktreeCount(root)).toBe(1);
    expect(tmpEntries()).toEqual([]);
  });

  it('returns ledger pending after 120 s of polling and still removes the worktree', async () => {
    login();
    let statusCalls = 0;
    const deps = makeDeps({ status: () => { statusCalls++; return NOT_CLONED; } });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });

    const result = await driveFakeClock(linkSageoxProject('app', {}, deps));
    expect(result).toMatchObject({ status: 'linked', ledger: 'pending', files: [...FIVE_FILES].sort() });
    expect(statusCalls).toBe(25);
    expect(await readBinding('app')).toEqual({ files: [...FIVE_FILES].sort() });
    expect(worktreeCount(root)).toBe(1);
    expect(tmpEntries()).toEqual([]);
  }, 30_000);

  it('stops polling as soon as ox status reports the ledger cloned', async () => {
    login();
    let statusCalls = 0;
    const deps = makeDeps({ status: () => (++statusCalls < 3 ? NOT_CLONED : READY) });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });

    expect(await driveFakeClock(linkSageoxProject('app', {}, deps))).toMatchObject({ status: 'linked', ledger: 'ready' });
    expect(statusCalls).toBe(3);
  }, 30_000);
});

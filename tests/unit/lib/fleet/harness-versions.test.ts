/**
 * PAN-4654 WI-3: harness CLI versions and update plans. Every seam is
 * injected; nothing here runs a real binary or touches the file system.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getRuntimeBehavior } from '@overdeck/contracts';

import {
  _resetHarnessVersionCacheForTests,
  type HarnessVersionsDeps,
  harnessUpdatePlan,
  listInstalledHarnessClis,
  parseCliVersion,
  readCliVersion,
  VERSION_CACHE_MS,
} from '../../../../src/lib/fleet/harness-versions.js';

function deps(overrides: Partial<HarnessVersionsDeps> = {}): HarnessVersionsDeps {
  return {
    resolveBinary: async () => null,
    realpath: async (path) => path,
    stat: async () => ({ mtimeMs: 1 }),
    execVersion: async () => '1.0.0',
    canWrite: async () => true,
    isExecutable: async () => true,
    platform: 'linux',
    now: () => 0,
    ...overrides,
  };
}

const capabilities = (harness: string) => getRuntimeBehavior(harness as never).capabilities;

afterEach(() => {
  _resetHarnessVersionCacheForTests();
});

describe('parseCliVersion (D-15)', () => {
  it.each([
    ['2.1.293 (Claude Code)', '2.1.293'],
    ['codex-cli 0.159.0', '0.159.0'],
    ['2.0.2', '2.0.2'],
    ['1.18.31', '1.18.31'],
    ['Muse Code 1.4.7 (1.4.7-R6101.1)', '1.4.7'],
    ['0.8.0', '0.8.0'],
    ['omp/17.4.1', '17.4.1'],
    ['tool 1.2.3-beta.4\n', '1.2.3-beta.4'],
    ['nothing', null],
  ])('%j ⇒ %j', (banner, version) => {
    expect(parseCliVersion(banner)).toBe(version);
  });
});

describe('harnessUpdatePlan (D-7)', () => {
  it('an npm install is updated with the prefix npm into that prefix', async () => {
    const plan = await harnessUpdatePlan(capabilities('codex'), 'codex', '/p/bin/codex', '/p/lib/node_modules/@openai/codex/bin/codex.js', deps());
    expect(plan).toEqual({
      argv: ['/p/bin/npm', 'install', '-g', '--prefix', '/p', '@openai/codex@latest'],
      display: '/p/bin/npm install -g --prefix /p @openai/codex@latest',
      reason: null,
    });
  });

  it('falls back to npm on PATH when the prefix has no executable npm', async () => {
    const plan = await harnessUpdatePlan(capabilities('claude-code'), 'claude', '/p/bin/claude', '/p/lib/node_modules/@anthropic-ai/claude-code/cli.js', deps({ isExecutable: async () => false }));
    expect(plan.argv).toEqual(['npm', 'install', '-g', '--prefix', '/p', '@anthropic-ai/claude-code@latest']);
  });

  it('a native kimi runs its own upgrade argv', async () => {
    const plan = await harnessUpdatePlan(capabilities('kimi-code'), 'kimi', '/home/u/.kimi-code/bin/kimi', '/home/u/.kimi-code/bin/kimi', deps());
    expect(plan).toEqual({ argv: ['/home/u/.kimi-code/bin/kimi', 'upgrade', '--yes'], display: 'kimi upgrade --yes', reason: null });
  });

  it('an unwritable npm prefix gives no argv and the sudo command', async () => {
    const plan = await harnessUpdatePlan(capabilities('codex'), 'codex', '/usr/bin/codex', '/usr/lib/node_modules/@openai/codex/bin/codex.js', deps({ canWrite: async () => false }));
    expect(plan.argv).toBeNull();
    expect(plan.display).toBe('sudo npm install -g --prefix /usr @openai/codex@latest');
    expect(plan.reason).toContain('not writable');
  });

  it('a Homebrew install is shown, not run', async () => {
    const plan = await harnessUpdatePlan(capabilities('opencode'), 'opencode', '/opt/homebrew/bin/opencode', '/opt/homebrew/Cellar/opencode/1.18.31/bin/opencode', deps());
    expect(plan).toEqual({ argv: null, display: 'brew upgrade opencode', reason: 'installed with Homebrew' });
  });

  it('Windows is never run', async () => {
    const plan = await harnessUpdatePlan(capabilities('codex'), 'codex', 'C:/n/codex', 'C:/n/lib/node_modules/@openai/codex/bin/codex.js', deps({ platform: 'win32' }));
    expect(plan).toEqual({ argv: null, display: 'codex update', reason: 'Overdeck does not update CLIs on Windows' });
  });

  it.each(['muse', 'prime-agent', 'ohmypi'])('%s declares no update and gets no argv', async (harness) => {
    const plan = await harnessUpdatePlan(capabilities(harness), 'x', '/b/x', '/b/x', deps());
    expect(plan.argv).toBeNull();
    expect(plan.reason).toBe(`Overdeck does not update ${capabilities(harness).binaryLabel}`);
  });

  it('prime-agent installed with npm is still not updated (pinned)', async () => {
    const plan = await harnessUpdatePlan(capabilities('prime-agent'), 'prime-agent', '/p/bin/prime-agent', '/p/lib/node_modules/prime-agent/bin/cli.js', deps());
    expect(plan.argv).toBeNull();
  });
});

describe('listInstalledHarnessClis', () => {
  it('lists kimi once for acp and kimi-code, skips unresolved CLIs, and orders per D-16', async () => {
    const found: Record<string, string> = {
      'claude-code': '/b/claude',
      ohmypi: '/b/omp',
      codex: '/b/codex',
      acp: '/b/kimi',
      'kimi-code': '/b/kimi',
      muse: '/b/muse',
    };
    const resolveBinary = vi.fn(async (harness: string) => found[harness] ?? null);
    const clis = await listInstalledHarnessClis({ refresh: false }, deps({ resolveBinary }));
    expect(clis.map((cli) => cli.binary)).toEqual(['claude', 'codex', 'kimi', 'muse', 'omp']);
    const kimi = clis.find((cli) => cli.binary === 'kimi')!;
    expect(kimi).toMatchObject({ harnesses: ['acp', 'kimi-code'], label: 'Kimi Code CLI', version: '1.0.0', updatable: true, command: 'kimi upgrade --yes', reason: null });
    expect(clis.find((cli) => cli.binary === 'muse')).toMatchObject({ updatable: false, reason: 'Overdeck does not update Muse Code' });
    expect(kimi).not.toHaveProperty('binaryPath');
    expect(kimi).not.toHaveProperty('plan');
  });
});

describe('readCliVersion cache (NFR-2)', () => {
  it('serves a second read within 60 s without exec; refresh and expiry exec again', async () => {
    let now = 0;
    const execVersion = vi.fn(async () => 'codex-cli 0.159.0');
    const d = deps({ execVersion, now: () => now });
    expect(await readCliVersion('/b/codex', { refresh: false }, d)).toBe('0.159.0');
    expect(await readCliVersion('/b/codex', { refresh: false }, d)).toBe('0.159.0');
    expect(execVersion).toHaveBeenCalledTimes(1);
    expect(await readCliVersion('/b/codex', { refresh: true }, d)).toBe('0.159.0');
    expect(execVersion).toHaveBeenCalledTimes(2);
    now = VERSION_CACHE_MS;
    await readCliVersion('/b/codex', { refresh: false }, d);
    expect(execVersion).toHaveBeenCalledTimes(3);
  });

  it('a changed modification time is a cache miss', async () => {
    let mtimeMs = 1;
    const execVersion = vi.fn(async () => '1.0.0');
    const d = deps({ execVersion, stat: async () => ({ mtimeMs }) });
    await readCliVersion('/b/claude', { refresh: false }, d);
    mtimeMs = 2;
    await readCliVersion('/b/claude', { refresh: false }, d);
    expect(execVersion).toHaveBeenCalledTimes(2);
  });
});

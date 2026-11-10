import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstalledHarnessCli } from '../../../../lib/fleet/harness-versions.js';
import {
  getHarnessAutoUpdateSnapshot,
  HARNESS_AUTO_UPDATE_BOOT_DELAY_MS,
  HARNESS_AUTO_UPDATE_INTERVAL_MS,
  runHarnessAutoUpdatePassOnce,
  startHarnessAutoUpdateService,
  stopHarnessAutoUpdateService,
  type HarnessAutoUpdateServiceDeps,
} from '../harness-auto-update-service.js';

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function npmCli(binary: string, label: string, version: string | null, npmPackage: string): InstalledHarnessCli {
  const argv = [`/p/bin/npm`, 'install', '-g', '--prefix', '/p', `${npmPackage}@latest`];
  return {
    binary, label, harnesses: [binary], version, updatable: true, command: argv.join(' '), reason: null,
    binaryPath: `/p/bin/${binary}`,
    plan: { argv, display: argv.join(' '), reason: null, npmPackage },
  };
}

function nativeCli(): InstalledHarnessCli {
  return {
    binary: 'kimi', label: 'Kimi Code', harnesses: ['kimi-code'], version: '1.0.0', updatable: true,
    command: 'kimi upgrade --yes', reason: null, binaryPath: '/home/u/.kimi/bin/kimi',
    plan: { argv: ['/home/u/.kimi/bin/kimi', 'upgrade', '--yes'], display: 'kimi upgrade --yes', reason: null, npmPackage: null },
  };
}

function noPlanCli(): InstalledHarnessCli {
  return {
    binary: 'muse', label: 'Muse Code', harnesses: ['muse'], version: '1.4.7', updatable: false,
    command: '', reason: 'Overdeck does not update Muse Code', binaryPath: '/b/muse',
    plan: { argv: null, display: '', reason: 'Overdeck does not update Muse Code', npmPackage: null },
  };
}

describe('harness auto-update service (PAN-5108)', () => {
  let log: ReturnType<typeof vi.fn<(line: string) => void>>;
  let emit: ReturnType<typeof vi.fn>;
  let clis: InstalledHarnessCli[];
  let latest: Record<string, string>;
  let versionsAfter: Record<string, string | null>;
  let isEnabled: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
  let detectClis: ReturnType<typeof vi.fn<() => Promise<InstalledHarnessCli[]>>>;
  let runUpdate: ReturnType<typeof vi.fn<HarnessAutoUpdateServiceDeps['runUpdate']>>;

  function makeDeps(overrides: Partial<HarnessAutoUpdateServiceDeps> = {}): Partial<HarnessAutoUpdateServiceDeps> {
    return {
      isEnabled,
      detectClis,
      latestVersion: async (_npm, pkg) => latest[pkg]!,
      runUpdate,
      readVersion: async (binaryPath) => versionsAfter[binaryPath] ?? null,
      log,
      emit: emit as unknown as HarnessAutoUpdateServiceDeps['emit'],
      now: () => Date.now(),
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 10, 10, 12, 0, 0));
    log = vi.fn<(line: string) => void>();
    emit = vi.fn();
    clis = [];
    latest = {};
    versionsAfter = {};
    isEnabled = vi.fn(async () => true);
    detectClis = vi.fn(async () => clis);
    runUpdate = vi.fn<HarnessAutoUpdateServiceDeps['runUpdate']>(async () => ({ code: 0, output: '' }));
  });

  afterEach(() => {
    stopHarnessAutoUpdateService();
    vi.useRealTimers();
  });

  it('runs the first pass 2 minutes after start and the next 24 hours later', async () => {
    startHarnessAutoUpdateService(makeDeps());

    await vi.advanceTimersByTimeAsync(HARNESS_AUTO_UPDATE_BOOT_DELAY_MS - 1);
    expect(detectClis).not.toHaveBeenCalled();
    expect(getHarnessAutoUpdateSnapshot().enabled).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    expect(detectClis).toHaveBeenCalledTimes(1);
    expect(getHarnessAutoUpdateSnapshot().enabled).toBe(true);
    expect(getHarnessAutoUpdateSnapshot().nextRunAt).toBe(new Date(Date.now() + HARNESS_AUTO_UPDATE_INTERVAL_MS).toISOString());

    await vi.advanceTimersByTimeAsync(HARNESS_AUTO_UPDATE_INTERVAL_MS - 1);
    expect(detectClis).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(detectClis).toHaveBeenCalledTimes(2);
  });

  it('updates an outdated npm CLI and logs that running sessions keep the old version', async () => {
    const claude = npmCli('claude', 'Claude Code', '2.1.293', '@anthropic-ai/claude-code');
    clis = [claude];
    latest = { '@anthropic-ai/claude-code': '2.1.321' };
    versionsAfter = { '/p/bin/claude': '2.1.321' };
    startHarnessAutoUpdateService(makeDeps());

    await runHarnessAutoUpdatePassOnce();

    expect(runUpdate).toHaveBeenCalledTimes(1);
    expect(runUpdate).toHaveBeenCalledWith(claude.plan.argv, '/p/bin');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toContain('updated 2.1.293 -> 2.1.321');
    expect(log.mock.calls[0]![0]).toContain('running sessions keep 2.1.293');
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ level: 'info' }));
    expect(getHarnessAutoUpdateSnapshot().failures).toEqual([]);
  });

  it('skips a current npm CLI with one log line', async () => {
    clis = [npmCli('codex', 'Codex CLI', '0.50.0', '@openai/codex')];
    latest = { '@openai/codex': '0.50.0' };
    startHarnessAutoUpdateService(makeDeps());

    await runHarnessAutoUpdatePassOnce();

    expect(runUpdate).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toContain('0.50.0 is current');
  });

  it('skips and logs a CLI with no update plan and one with a non-npm plan', async () => {
    clis = [noPlanCli(), nativeCli()];
    startHarnessAutoUpdateService(makeDeps());

    await runHarnessAutoUpdatePassOnce();

    expect(runUpdate).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0]![0]).toContain('Muse Code: skipped, Overdeck has no update it can run');
    expect(log.mock.calls[1]![0]).toContain('Kimi Code: skipped, its update is not npm-based. Update it yourself: kimi upgrade --yes');
  });

  it('records a failure without throwing and clears it when a later pass finds the CLI current', async () => {
    clis = [npmCli('claude', 'Claude Code', '2.1.293', '@anthropic-ai/claude-code')];
    latest = { '@anthropic-ai/claude-code': '2.1.321' };
    versionsAfter = { '/p/bin/claude': '2.1.293' };
    runUpdate.mockResolvedValueOnce({ code: 1, output: 'npm ERR! code E404' });
    startHarnessAutoUpdateService(makeDeps());

    await expect(runHarnessAutoUpdatePassOnce()).resolves.toBeUndefined();

    const { failures } = getHarnessAutoUpdateSnapshot();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ binary: 'claude', label: 'Claude Code', command: clis[0]!.plan.display });
    expect(failures[0]!.error).toContain('E404');
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' }));
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toContain('Overdeck retries at the next daily check');

    clis = [npmCli('claude', 'Claude Code', '2.1.321', '@anthropic-ai/claude-code')];
    await runHarnessAutoUpdatePassOnce();
    expect(getHarnessAutoUpdateSnapshot().failures).toEqual([]);
  });

  it('records a failure when npm cannot report the latest version', async () => {
    clis = [npmCli('codex', 'Codex CLI', '0.50.0', '@openai/codex')];
    startHarnessAutoUpdateService(makeDeps({ latestVersion: async () => { throw new Error('ETIMEDOUT'); } }));

    await runHarnessAutoUpdatePassOnce();

    expect(runUpdate).not.toHaveBeenCalled();
    expect(getHarnessAutoUpdateSnapshot().failures[0]!.error).toContain('could not read the latest version from npm: ETIMEDOUT');
  });

  it('updates one CLI at a time', async () => {
    clis = [
      npmCli('claude', 'Claude Code', '2.1.293', '@anthropic-ai/claude-code'),
      npmCli('codex', 'Codex CLI', '0.40.0', '@openai/codex'),
    ];
    latest = { '@anthropic-ai/claude-code': '2.1.321', '@openai/codex': '0.50.0' };
    versionsAfter = { '/p/bin/claude': '2.1.321', '/p/bin/codex': '0.50.0' };
    const first = deferred<{ code: number; output: string }>();
    runUpdate.mockImplementationOnce(() => first.promise);
    startHarnessAutoUpdateService(makeDeps());

    const pass = runHarnessAutoUpdatePassOnce();
    await vi.advanceTimersByTimeAsync(0);
    expect(runUpdate).toHaveBeenCalledTimes(1);

    first.resolve({ code: 0, output: '' });
    await pass;
    expect(runUpdate).toHaveBeenCalledTimes(2);
    expect(runUpdate.mock.calls[1]![1]).toBe('/p/bin');
  });

  it('does nothing but log when auto-update is off, and empties the failure list', async () => {
    clis = [npmCli('claude', 'Claude Code', '2.1.293', '@anthropic-ai/claude-code')];
    latest = { '@anthropic-ai/claude-code': '2.1.321' };
    runUpdate.mockResolvedValueOnce({ code: 1, output: 'EACCES' });
    startHarnessAutoUpdateService(makeDeps());
    await runHarnessAutoUpdatePassOnce();
    expect(getHarnessAutoUpdateSnapshot().failures).toHaveLength(1);
    detectClis.mockClear();
    log.mockClear();

    isEnabled.mockResolvedValue(false);
    await runHarnessAutoUpdatePassOnce();

    expect(detectClis).not.toHaveBeenCalled();
    expect(getHarnessAutoUpdateSnapshot()).toMatchObject({ enabled: false, failures: [] });
    expect(log).toHaveBeenCalledWith('[harness-auto-update] skipped: harnesses.auto_update is off');
  });

  it('returns an empty snapshot when not started', () => {
    expect(getHarnessAutoUpdateSnapshot()).toEqual({ enabled: null, running: false, lastRunAt: null, nextRunAt: null, failures: [] });
  });
});

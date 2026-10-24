import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mergeConfigs } from '../../../lib/config-yaml/merge.js';
import { checkSemgrep, SEMGREP_REGISTRY_PROBE_URL } from '../doctor-semgrep.js';

function enabledConfig() {
  return mergeConfigs(null, { security: { semgrep: { enabled: true } } }).config;
}

function disabledConfig() {
  return mergeConfigs(null).config;
}

function registryOkFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    expect(String(input)).toBe(SEMGREP_REGISTRY_PROBE_URL);
    return { ok: true, status: 200 } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe('checkSemgrep', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns no rows when the feature is disabled', async () => {
    const checks = await checkSemgrep({ config: disabledConfig() });
    expect(checks).toEqual([]);
  });

  it('warns that Windows is unsupported and stops before any version/registry check', async () => {
    const readVersion = vi.fn();
    const checks = await checkSemgrep({
      config: enabledConfig(),
      platform: 'win32',
      readVersion,
    });
    expect(checks).toEqual([{
      name: 'Semgrep',
      status: 'warn',
      message: 'Enabled, but Semgrep support is Linux and macOS only',
    }]);
    expect(readVersion).not.toHaveBeenCalled();
  });

  it('errors when enabled but not installed', async () => {
    const checks = await checkSemgrep({
      config: enabledConfig(),
      platform: 'linux',
      readVersion: async () => null,
      fetchImpl: registryOkFetch(),
    });
    expect(checks[0]).toEqual({
      name: 'Semgrep',
      status: 'error',
      message: 'Enabled, but not installed at ~/.overdeck/bin/semgrep',
      fix: 'pan sync',
    });
  });

  it('warns on a version mismatch against the pin', async () => {
    const checks = await checkSemgrep({
      config: enabledConfig(),
      platform: 'linux',
      readVersion: async () => '1.179.0',
      fetchImpl: registryOkFetch(),
    });
    expect(checks[0]).toEqual({
      name: 'Semgrep',
      status: 'warn',
      message: 'Installed 1.179.0, expected 1.180.0',
      fix: 'pan sync',
    });
  });

  it('reports ok when the installed version matches the pin', async () => {
    const checks = await checkSemgrep({
      config: enabledConfig(),
      platform: 'linux',
      readVersion: async () => '1.180.0',
      fetchImpl: registryOkFetch(),
    });
    expect(checks[0]).toEqual({ name: 'Semgrep', status: 'ok', message: '1.180.0 (pinned)' });
  });

  it('reports the registry reachable on a redirect response', async () => {
    const checks = await checkSemgrep({
      config: enabledConfig(),
      platform: 'linux',
      readVersion: async () => '1.180.0',
      fetchImpl: (async () => ({ ok: false, status: 302 }) as unknown as Response) as unknown as typeof fetch,
    });
    expect(checks[1]).toEqual({ name: 'Semgrep registry', status: 'ok', message: 'semgrep.dev reachable' });
  });

  it('warns when the registry responds with a non-2xx/3xx status', async () => {
    const checks = await checkSemgrep({
      config: enabledConfig(),
      platform: 'linux',
      readVersion: async () => '1.180.0',
      fetchImpl: (async () => ({ ok: false, status: 500 }) as unknown as Response) as unknown as typeof fetch,
    });
    expect(checks[1]).toEqual({
      name: 'Semgrep registry',
      status: 'warn',
      message: 'semgrep.dev unreachable — registry rule packs such as p/default cannot be downloaded',
      fix: 'Check network access to https://semgrep.dev',
    });
  });

  it('warns on a 5s registry timeout', async () => {
    vi.useFakeTimers();
    const neverResolves: typeof fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof fetch;

    const resultPromise = checkSemgrep({
      config: enabledConfig(),
      platform: 'linux',
      readVersion: async () => '1.180.0',
      fetchImpl: neverResolves,
    });
    await vi.advanceTimersByTimeAsync(5_000);
    const checks = await resultPromise;
    expect(checks[1]).toEqual({
      name: 'Semgrep registry',
      status: 'warn',
      message: 'semgrep.dev unreachable — registry rule packs such as p/default cannot be downloaded',
      fix: 'Check network access to https://semgrep.dev',
    });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import { collectSystem, type CollectSystemDeps } from '../../../../src/lib/diagnostics/collect-system.js';

function baseDeps(overrides: Partial<CollectSystemDeps> = {}): Partial<CollectSystemDeps> {
  return {
    readPackageVersion: async () => '1.2.3',
    getBuildInfo: () => ({ buildCommit: 'abc123', builtAt: '2026-11-01T00:00:00.000Z', buildDirty: false, buildBranch: 'main' }),
    hostTerminalBackendName: async () => 'herdr',
    getDashboardApiUrl: () => 'http://localhost:3011',
    getSupervisorUrl: () => 'http://localhost:3012',
    isSupervisorRunning: () => true,
    execFile: async () => ({ stdout: 'v1.0.0', stderr: '' }),
    fetch: vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok' }),
    }) as unknown as typeof fetch,
    ...overrides,
  };
}

function entryJson(entries: { path: string; content: string }[], path: string): any {
  const entry = entries.find((e) => e.path === path);
  if (!entry) throw new Error(`no entry for ${path}`);
  return JSON.parse(entry.content);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('collectSystem', () => {
  it('produces environment.json and services.json entries with no failures on the happy path', async () => {
    const outcome = await collectSystem(baseDeps());
    expect(outcome.entries.map((e) => e.path).sort()).toEqual(['environment.json', 'services.json']);
    expect(outcome.failures).toEqual([]);

    const environment = entryJson(outcome.entries, 'environment.json');
    expect(environment.overdeckVersion).toBe('1.2.3');
    expect(environment.buildCommit).toBe('abc123');
    expect(environment.terminalBackend).toBe('herdr');
    expect(environment.harnesses.claudeCode).toEqual({ installed: true, version: 'v1.0.0' });

    const services = entryJson(outcome.entries, 'services.json');
    expect(services.dashboard.reachable).toBe(true);
    expect(services.supervisor.pidAlive).toBe(true);
  });

  it('still produces both entries and reports unreachable services when fetch rejects and isSupervisorRunning is false', async () => {
    const outcome = await collectSystem(baseDeps({
      fetch: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:3011')) as unknown as typeof fetch,
      isSupervisorRunning: () => false,
    }));

    expect(outcome.entries).toHaveLength(2);
    const services = entryJson(outcome.entries, 'services.json');
    expect(services.dashboard.reachable).toBe(false);
    expect(services.dashboard.error).toContain('ECONNREFUSED');
    expect(services.supervisor.pidAlive).toBe(false);
    expect(services.supervisor.reachable).toBe(false);
    expect(services.supervisor.error).toContain('ECONNREFUSED');
  });

  it('reports a harness as not installed on ENOENT', async () => {
    const outcome = await collectSystem(baseDeps({
      execFile: async () => {
        throw Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
      },
    }));

    const environment = entryJson(outcome.entries, 'environment.json');
    expect(environment.harnesses.claudeCode).toEqual({ installed: false, version: null });
    expect(environment.harnesses.codex).toEqual({ installed: false, version: null });
  });

  it('aborts a fetch that never settles after 2s', async () => {
    vi.useFakeTimers();

    const neverSettlingFetch = vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));
      });
    })) as unknown as typeof fetch;

    const promise = collectSystem(baseDeps({ fetch: neverSettlingFetch }));
    await vi.advanceTimersByTimeAsync(2000);
    const outcome = await promise;

    const services = entryJson(outcome.entries, 'services.json');
    expect(services.dashboard.reachable).toBe(false);
    expect(services.supervisor.reachable).toBe(false);
    expect(neverSettlingFetch).toHaveBeenCalledTimes(2);
  });
});

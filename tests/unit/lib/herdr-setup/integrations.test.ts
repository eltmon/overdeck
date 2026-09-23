import { describe, expect, it, vi } from 'vitest';

import {
  classifyIntegrationDetail,
  ensureHerdrIntegrations,
  parseIntegrationStatus,
} from '../../../../src/lib/herdr-setup/integrations.js';
import type { HerdrExec } from '../../../../src/lib/herdr-setup/status.js';
import { INTEGRATION_STATUS_TEXT, integrationStatusAllInstalled } from './fixtures.js';

const BINARY = '/home/op/.local/bin/herdr';

describe('parseIntegrationStatus (PAN-3956 W8)', () => {
  it('classifies the recorded lines as not-installed with their paths', () => {
    const rows = parseIntegrationStatus(INTEGRATION_STATUS_TEXT);
    expect(rows.slice(0, 3)).toEqual([
      {
        target: 'pi',
        state: 'not-installed',
        detail: 'not installed',
        path: '/home/eltmon/.pi/agent/extensions/herdr-agent-state.ts',
      },
      {
        target: 'omp',
        state: 'not-installed',
        detail: 'not installed',
        path: '/home/eltmon/.omp/agent/extensions/herdr-omp-agent-state.ts',
      },
      {
        target: 'claude',
        state: 'not-installed',
        detail: 'not installed',
        path: '/home/eltmon/.claude/hooks/herdr-agent-state.sh',
      },
    ]);
    expect(rows.find((row) => row.target === 'letta')).toMatchObject({ state: 'not-installed' });
    expect(rows.every((row) => row.state === 'not-installed')).toBe(true);
  });

  it('classifies installed, outdated and unknown wording tolerantly', () => {
    expect(classifyIntegrationDetail('installed')).toBe('installed');
    expect(classifyIntegrationDetail('outdated')).toBe('outdated');
    expect(classifyIntegrationDetail('installed, update available')).toBe('outdated');
    expect(classifyIntegrationDetail('not installed')).toBe('not-installed');
    expect(classifyIntegrationDetail('broken symlink')).toBe('unknown');
  });
});

function execFor(statusText: string) {
  return vi.fn<HerdrExec>(async (_file, args) => {
    if (args[0] === 'integration' && args[1] === 'status') return { stdout: statusText, stderr: '', exitCode: 0 };
    return { stdout: '', stderr: '', exitCode: 0 };
  });
}

function installCalls(exec: ReturnType<typeof execFor>): string[] {
  return exec.mock.calls
    .filter(([, args]) => args[0] === 'integration' && args[1] === 'install')
    .map(([, args]) => args[2] as string);
}

describe('ensureHerdrIntegrations (FR-7, D2, D11)', () => {
  it('installs only pilot targets whose binary resolves; never claude, codex or hermes', async () => {
    const exec = execFor(INTEGRATION_STATUS_TEXT);
    const result = await ensureHerdrIntegrations({
      binary: BINARY,
      exec,
      resolveBinary: async (name) => (name === 'opencode' ? null : `/usr/bin/${name}`),
      kimiVersion: '2.0.1',
    });
    expect(installCalls(exec)).toEqual(['pi', 'omp', 'kimi']);
    expect(result.installed).toEqual(['pi', 'omp', 'kimi']);
    expect(result.skipped).toEqual([{ target: 'opencode', reason: 'opencode binary not found' }]);
  });

  it('skips kimi below 0.14.0', async () => {
    const exec = execFor(INTEGRATION_STATUS_TEXT);
    const result = await ensureHerdrIntegrations({
      binary: BINARY,
      exec,
      resolveBinary: async (name) => `/usr/bin/${name}`,
      kimiVersion: '0.13.2',
    });
    expect(installCalls(exec)).toEqual(['pi', 'omp', 'opencode']);
    expect(result.skipped).toEqual([{ target: 'kimi', reason: 'kimi 0.13.2 < 0.14.0' }]);
  });

  it('makes zero install calls when every pilot integration is installed (idempotent)', async () => {
    const exec = execFor(integrationStatusAllInstalled());
    const result = await ensureHerdrIntegrations({
      binary: BINARY,
      exec,
      resolveBinary: async (name) => `/usr/bin/${name}`,
      kimiVersion: '2.0.1',
    });
    expect(installCalls(exec)).toEqual([]);
    expect(result.already).toEqual(['pi', 'omp', 'kimi', 'opencode']);
  });

  it('never reinstalls an integration whose status it cannot classify ([checkpoint] fallback)', async () => {
    const exec = execFor(INTEGRATION_STATUS_TEXT.replace('pi: not installed', 'pi: weird state'));
    const result = await ensureHerdrIntegrations({
      binary: BINARY,
      exec,
      resolveBinary: async (name) => `/usr/bin/${name}`,
      kimiVersion: '2.0.1',
    });
    expect(installCalls(exec)).not.toContain('pi');
    expect(result.skipped).toContainEqual({ target: 'pi', reason: 'status not recognized: weird state' });
  });

  it('reports a failed install as skipped with the reason', async () => {
    const exec = vi.fn<HerdrExec>(async (_file, args) => (
      args[1] === 'status'
        ? { stdout: INTEGRATION_STATUS_TEXT, stderr: '', exitCode: 0 }
        : { stdout: '', stderr: 'permission denied', exitCode: 1 }
    ));
    const result = await ensureHerdrIntegrations({
      binary: BINARY,
      exec,
      resolveBinary: async (name) => (name === 'pi' ? '/usr/bin/pi' : null),
    });
    expect(result.skipped).toContainEqual({ target: 'pi', reason: 'install failed (exit 1): permission denied' });
  });
});

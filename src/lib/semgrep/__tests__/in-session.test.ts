import { describe, expect, it } from 'vitest';

import {
  SEMGREP_MCP_DISABLED_TOOLS_ENV,
  isSemgrepMcpRole,
  resolveSemgrepMcpServer,
  semgrepInSessionEnv,
  type SemgrepInSessionDeps,
  type SemgrepMcpOwner,
} from '../in-session.js';
import { managedSemgrepPath } from '../install.js';

const ENABLED_MCP_CFG = { enabled: true, mcp: true };

function baseDeps(overrides: Partial<SemgrepInSessionDeps> = {}): SemgrepInSessionDeps {
  return {
    loadSemgrepConfig: async () => ENABLED_MCP_CFG,
    home: '/h',
    platform: 'linux',
    env: {},
    inspectLauncher: async () => 'managed',
    warn: () => {},
    ...overrides,
  };
}

describe('semgrepInSessionEnv (PAN-4591 WI-2)', () => {
  it('matches the documented shape', () => {
    expect(semgrepInSessionEnv('/h')).toEqual({
      SEMGREP_ENABLE_VERSION_CHECK: '0',
      SEMGREP_SEND_METRICS: 'off',
      SEMGREP_SETTINGS_FILE: '/h/tools/semgrep/settings.yml',
      SEMGREP_LOG_FILE: '/h/tools/semgrep/semgrep.log',
    });
  });
});

describe('isSemgrepMcpRole (PAN-4591 WI-2)', () => {
  it('is true for role work', () => {
    expect(isSemgrepMcpRole({ agentId: 'a', agentKind: 'agent', role: 'work' })).toBe(true);
  });

  it('is true for role review with subRole security', () => {
    expect(isSemgrepMcpRole({ agentId: 'a', agentKind: 'agent', role: 'review', subRole: 'security' })).toBe(true);
  });

  it('is false for review with a non-security subRole or no subRole', () => {
    expect(isSemgrepMcpRole({ agentId: 'a', agentKind: 'agent', role: 'review', subRole: 'correctness' })).toBe(false);
    expect(isSemgrepMcpRole({ agentId: 'a', agentKind: 'agent', role: 'review' })).toBe(false);
  });

  it('is false for conversation owners', () => {
    expect(isSemgrepMcpRole({ agentId: 'a', agentKind: 'conversation', role: 'work' })).toBe(false);
  });
});

describe('resolveSemgrepMcpServer (PAN-4591 WI-2)', () => {
  it('returns the stdio server for role work with a managed launcher', async () => {
    const owner: SemgrepMcpOwner = { agentId: 'agent-1', agentKind: 'agent', role: 'work' };
    const server = await resolveSemgrepMcpServer(owner, baseDeps());
    expect(server).not.toBeNull();
    expect(server?.type).toBe('stdio');
    expect(server?.command).toBe('/usr/bin/env');
    expect(server?.args.slice(0, 4)).toEqual(['-u', 'SEMGREP_APP_TOKEN', '-u', 'SEMGREP_RULES']);
    expect(server?.args).toContain(managedSemgrepPath('/h'));
    expect(server?.args[server.args.length - 1]).toBe('mcp');
  });

  it('returns the stdio server for role review with subRole security', async () => {
    const owner: SemgrepMcpOwner = { agentId: 'agent-1', agentKind: 'agent', role: 'review', subRole: 'security' };
    const server = await resolveSemgrepMcpServer(owner, baseDeps());
    expect(server).not.toBeNull();
  });

  it('returns null for review sub-roles other than security, and for roles plan/test/ship/worker, and conversation owners', async () => {
    const deps = baseDeps();
    for (const subRole of ['correctness', 'performance', 'requirements']) {
      expect(
        await resolveSemgrepMcpServer({ agentId: 'a', agentKind: 'agent', role: 'review', subRole }, deps),
      ).toBeNull();
    }
    for (const role of ['plan', 'test', 'ship', 'worker']) {
      expect(await resolveSemgrepMcpServer({ agentId: 'a', agentKind: 'agent', role }, deps)).toBeNull();
    }
    expect(await resolveSemgrepMcpServer({ agentId: 'a', agentKind: 'conversation', role: 'work' }, deps)).toBeNull();
  });

  it('returns null when enabled is false', async () => {
    const deps = baseDeps({ loadSemgrepConfig: async () => ({ enabled: false, mcp: true }) });
    expect(await resolveSemgrepMcpServer({ agentId: 'a', agentKind: 'agent', role: 'work' }, deps)).toBeNull();
  });

  it('returns null when mcp is false', async () => {
    const deps = baseDeps({ loadSemgrepConfig: async () => ({ enabled: true, mcp: false }) });
    expect(await resolveSemgrepMcpServer({ agentId: 'a', agentKind: 'agent', role: 'work' }, deps)).toBeNull();
  });

  it('returns null when the config has no security block', async () => {
    const deps = baseDeps({ loadSemgrepConfig: async () => undefined });
    expect(await resolveSemgrepMcpServer({ agentId: 'a', agentKind: 'agent', role: 'work' }, deps)).toBeNull();
  });

  it('returns null with OVERDECK_DOCKER_WORKSPACE=1', async () => {
    const deps = baseDeps({ env: { OVERDECK_DOCKER_WORKSPACE: '1' } });
    expect(await resolveSemgrepMcpServer({ agentId: 'a', agentKind: 'agent', role: 'work' }, deps)).toBeNull();
  });

  it('returns null with PAN_DOCKER=1', async () => {
    const deps = baseDeps({ env: { PAN_DOCKER: '1' } });
    expect(await resolveSemgrepMcpServer({ agentId: 'a', agentKind: 'agent', role: 'work' }, deps)).toBeNull();
  });

  it('returns null on win32', async () => {
    const deps = baseDeps({ platform: 'win32' });
    expect(await resolveSemgrepMcpServer({ agentId: 'a', agentKind: 'agent', role: 'work' }, deps)).toBeNull();
  });

  it('returns null and warns once containing "run pan sync" when the launcher is absent', async () => {
    const warnings: string[] = [];
    const deps = baseDeps({ inspectLauncher: async () => 'absent', warn: (line) => warnings.push(line) });
    const server = await resolveSemgrepMcpServer({ agentId: 'agent-7', agentKind: 'agent', role: 'work' }, deps);
    expect(server).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('run pan sync');
    expect(warnings[0]).toContain('agent-7');
  });

  it('returns null and warns once containing "run pan sync" when the launcher is foreign', async () => {
    const warnings: string[] = [];
    const deps = baseDeps({ inspectLauncher: async () => 'foreign', warn: (line) => warnings.push(line) });
    const server = await resolveSemgrepMcpServer({ agentId: 'agent-8', agentKind: 'agent', role: 'work' }, deps);
    expect(server).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('run pan sync');
  });

  it('env contains the quiet, tracing-disabled and tool-disable vars under Overdeck-owned paths', async () => {
    const server = await resolveSemgrepMcpServer({ agentId: 'a', agentKind: 'agent', role: 'work' }, baseDeps());
    expect(server?.env).toEqual({
      SEMGREP_ENABLE_VERSION_CHECK: '0',
      SEMGREP_SEND_METRICS: 'off',
      SEMGREP_SETTINGS_FILE: '/h/tools/semgrep/settings.yml',
      SEMGREP_LOG_FILE: '/h/tools/semgrep/semgrep.log',
      SEMGREP_MCP_DISABLE_TRACING: 'true',
      ...SEMGREP_MCP_DISABLED_TOOLS_ENV,
    });
  });
});

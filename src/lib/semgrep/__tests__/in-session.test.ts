import { describe, expect, it } from 'vitest';

import {
  SEMGREP_MCP_DISABLED_TOOLS_ENV,
  isSemgrepMcpRole,
  mergeClaudeHookMaps,
  resolveSemgrepLaunchSettings,
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

describe('resolveSemgrepLaunchSettings (PAN-4591 WI-5)', () => {
  const EDIT_HOOK_CFG = { enabled: true, edit_hook: true };

  it('returns a PostToolUse hook for an eligible claude-code launch', async () => {
    const settings = await resolveSemgrepLaunchSettings(
      { harness: 'claude-code' },
      { loadSemgrepConfig: async () => EDIT_HOOK_CFG, home: '/h', platform: 'linux' },
    );
    expect(settings.hideSkill).toBe(false);
    expect(settings.claudeHooks).not.toBeNull();
    const hooks = settings.claudeHooks!.PostToolUse as Array<{ matcher: string; hooks: Array<{ command: string; timeout: number }> }>;
    expect(hooks[0]!.matcher).toBe('Edit|Write|MultiEdit');
    expect(hooks[0]!.hooks[0]!.command).toContain('semgrep-edit-hook');
    expect(hooks[0]!.hooks[0]!.timeout).toBe(40);
  });

  it('hides the skill and adds no hook when disabled', async () => {
    const settings = await resolveSemgrepLaunchSettings({ harness: 'claude-code' }, { loadSemgrepConfig: async () => undefined });
    expect(settings).toEqual({ hideSkill: true, claudeHooks: null });
  });

  it('returns claudeHooks null for codex', async () => {
    const settings = await resolveSemgrepLaunchSettings({ harness: 'codex' }, { loadSemgrepConfig: async () => EDIT_HOOK_CFG });
    expect(settings.claudeHooks).toBeNull();
  });

  it('returns claudeHooks null for a conversation launch', async () => {
    const settings = await resolveSemgrepLaunchSettings(
      { harness: 'claude-code', conversation: 'conv-1' },
      { loadSemgrepConfig: async () => EDIT_HOOK_CFG },
    );
    expect(settings.claudeHooks).toBeNull();
  });

  it('returns claudeHooks null when edit_hook is false', async () => {
    const settings = await resolveSemgrepLaunchSettings(
      { harness: 'claude-code' },
      { loadSemgrepConfig: async () => ({ enabled: true, edit_hook: false }) },
    );
    expect(settings.claudeHooks).toBeNull();
  });

  it('returns claudeHooks null when enabled is false', async () => {
    const settings = await resolveSemgrepLaunchSettings(
      { harness: 'claude-code' },
      { loadSemgrepConfig: async () => ({ enabled: false, edit_hook: true }) },
    );
    expect(settings.claudeHooks).toBeNull();
  });

  it('returns claudeHooks null on win32', async () => {
    const settings = await resolveSemgrepLaunchSettings(
      { harness: 'claude-code' },
      { loadSemgrepConfig: async () => EDIT_HOOK_CFG, platform: 'win32' },
    );
    expect(settings.claudeHooks).toBeNull();
  });

  it('returns claudeHooks null with OVERDECK_DOCKER_WORKSPACE=1', async () => {
    const previous = process.env.OVERDECK_DOCKER_WORKSPACE;
    process.env.OVERDECK_DOCKER_WORKSPACE = '1';
    try {
      const settings = await resolveSemgrepLaunchSettings({ harness: 'claude-code' }, { loadSemgrepConfig: async () => EDIT_HOOK_CFG });
      expect(settings.claudeHooks).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.OVERDECK_DOCKER_WORKSPACE;
      else process.env.OVERDECK_DOCKER_WORKSPACE = previous;
    }
  });

  it('returns claudeHooks null with PAN_DOCKER=1', async () => {
    const previous = process.env.PAN_DOCKER;
    process.env.PAN_DOCKER = '1';
    try {
      const settings = await resolveSemgrepLaunchSettings({ harness: 'claude-code' }, { loadSemgrepConfig: async () => EDIT_HOOK_CFG });
      expect(settings.claudeHooks).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.PAN_DOCKER;
      else process.env.PAN_DOCKER = previous;
    }
  });

  it('returns { hideSkill: true, claudeHooks: null } with one warning when config loading throws', async () => {
    const warnings: string[] = [];
    const settings = await resolveSemgrepLaunchSettings(
      { harness: 'claude-code' },
      { loadSemgrepConfig: async () => { throw new Error('boom'); }, warn: (line) => warnings.push(line) },
    );
    expect(settings).toEqual({ hideSkill: true, claudeHooks: null });
    expect(warnings).toHaveLength(1);
  });
});

describe('mergeClaudeHookMaps (PAN-4591 WI-5)', () => {
  it('returns a unchanged when b is null', () => {
    const a = { PostToolUse: [{ id: 1 }] };
    expect(mergeClaudeHookMaps(a, null)).toBe(a);
  });

  it('returns b when a is undefined', () => {
    const b = { PostToolUse: [{ id: 2 }] };
    expect(mergeClaudeHookMaps(undefined, b)).toBe(b);
  });

  it('concatenates event arrays with a first', () => {
    const a = { PostToolUse: [{ id: 'sageox' }] };
    const b = { PostToolUse: [{ id: 'semgrep' }] };
    expect(mergeClaudeHookMaps(a, b)).toEqual({ PostToolUse: [{ id: 'sageox' }, { id: 'semgrep' }] });
  });
});

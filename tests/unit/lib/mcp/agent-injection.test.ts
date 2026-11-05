/**
 * PAN-4932 W-4: the overdeck MCP injection helper — the enable switches, the
 * stdio server entry, the 0600 config file that names only the token file, and
 * the never-throw degrade path. Uses the real token registry under a temp OVERDECK_HOME.
 */
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mcpAgents = vi.hoisted(() => ({ value: true }));
const mintFailure = vi.hoisted(() => ({ error: null as Error | null }));
type ProjectMcpResult = Awaited<ReturnType<typeof import('../../../../src/lib/projects/project-mcp.js').resolveProjectMcpServers>>;
const projectMcp = vi.hoisted(() => ({
  result: { projectKey: null, servers: {}, strict: false } as ProjectMcpResult,
  calls: [] as Array<{ issueId?: string; cwd?: string; reservedNames: readonly string[] }>,
}));

vi.mock('../../../../src/lib/projects/project-mcp.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/projects/project-mcp.js')>();
  return {
    ...actual,
    resolveProjectMcpServers: vi.fn(async (input: { issueId?: string; cwd?: string; reservedNames: readonly string[] }) => {
      projectMcp.calls.push({ issueId: input.issueId, cwd: input.cwd, reservedNames: input.reservedNames });
      return projectMcp.result;
    }),
  };
});

vi.mock('../../../../src/lib/config-yaml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/config-yaml.js')>();
  return {
    ...actual,
    loadConfigNoMigration: vi.fn(async () => ({ config: { mcp: { agents: mcpAgents.value, public: { enabled: false } } } })),
  };
});

vi.mock('../../../../src/lib/mcp/agent-token.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/mcp/agent-token.js')>();
  return {
    ...actual,
    ensureAgentMcpToken: vi.fn(async (owner: Parameters<typeof actual.ensureAgentMcpToken>[0]) => {
      if (mintFailure.error) throw mintFailure.error;
      return actual.ensureAgentMcpToken(owner);
    }),
  };
});

import { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, listAccessTokens } from '../../../../src/lib/access-tokens.js';
import {
  conversationTokenRole,
  harnessGetsOverdeckMcp,
  overdeckMcpEnabledFor,
  overdeckStdioServer,
  prepareClaudeOverdeckMcp,
  prepareCodexOverdeckMcp,
} from '../../../../src/lib/mcp/agent-injection.js';

let home: string;
const originalHome = process.env.OVERDECK_HOME;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4932-agent-injection-'));
  process.env.OVERDECK_HOME = home;
  _resetAccessTokensForTests();
  mcpAgents.value = true;
  mintFailure.error = null;
  projectMcp.result = { projectKey: null, servers: {}, strict: false };
  projectMcp.calls = [];
});

afterEach(async () => {
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  vi.restoreAllMocks();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('overdeck MCP injection (PAN-4932 W-4)', () => {
  it('reads the overdeckMcp capability', () => {
    expect(harnessGetsOverdeckMcp('claude-code')).toBe(true);
    expect(harnessGetsOverdeckMcp('codex')).toBe(true);
    expect(harnessGetsOverdeckMcp('kimi-code')).toBe(false);
    expect(harnessGetsOverdeckMcp('acp')).toBe(true);
    expect(harnessGetsOverdeckMcp('opencode')).toBe(true);
  });

  it('is enabled for claude-code unless Docker or the config switch says no', async () => {
    expect(await overdeckMcpEnabledFor('claude-code', {})).toBe(true);
    expect(await overdeckMcpEnabledFor('claude-code', { OVERDECK_DOCKER_WORKSPACE: '1' })).toBe(false);
    expect(await overdeckMcpEnabledFor('claude-code', { PAN_DOCKER: '1' })).toBe(false);
    expect(await overdeckMcpEnabledFor('codex', {})).toBe(true);
    mcpAgents.value = false;
    expect(await overdeckMcpEnabledFor('claude-code', {})).toBe(false);
  });

  it('builds a pan mcp serve entry with only paths and the loopback URL in env', () => {
    const server = overdeckStdioServer('/t/mcp-token');
    expect(server.type).toBe('stdio');
    expect(server.command).toBe(process.execPath);
    expect(server.args.slice(-2)).toEqual(['mcp', 'serve']);
    expect(Object.keys(server.env).sort()).toEqual(['OVERDECK_DASHBOARD_URL', 'OVERDECK_HOME', 'OVERDECK_MCP_TOKEN_FILE']);
    expect(server.env.OVERDECK_MCP_TOKEN_FILE).toBe('/t/mcp-token');
    expect(server.env.OVERDECK_HOME).toBe(home);
  });

  it('writes a 0600 config that names the 0600 token file and holds no token', async () => {
    const result = await prepareClaudeOverdeckMcp({ agentId: 'agent-pan-1', agentKind: 'agent', role: 'work', harness: 'claude-code' });
    const dir = join(home, 'agents', 'agent-pan-1');
    const configPath = join(dir, 'overdeck-mcp.json');
    const tokenFile = join(dir, 'mcp-token');

    expect(result).toEqual({ overdeckMcpConfig: configPath });
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    expect((await stat(tokenFile)).mode & 0o777).toBe(0o600);

    const text = await readFile(configPath, 'utf8');
    expect(text).not.toContain('odk_');
    const parsed = JSON.parse(text) as { mcpServers: Record<string, { env: Record<string, string> }> };
    expect(Object.keys(parsed.mcpServers)).toEqual(['overdeck']);
    expect(parsed.mcpServers.overdeck!.env.OVERDECK_MCP_TOKEN_FILE).toBe(tokenFile);
    expect(await readFile(tokenFile, 'utf8')).toContain('odk_');
  });

  it('writes the config for acp and opencode launches (PAN-4934)', async () => {
    expect(await prepareClaudeOverdeckMcp({ agentId: 'agent-pan-2', agentKind: 'agent', role: 'work', harness: 'opencode' }))
      .toEqual({ overdeckMcpConfig: join(home, 'agents', 'agent-pan-2', 'overdeck-mcp.json') });
    expect(await prepareClaudeOverdeckMcp({ agentId: 'agent-pan-3', agentKind: 'agent', role: 'work', harness: 'acp' }))
      .toEqual({ overdeckMcpConfig: join(home, 'agents', 'agent-pan-3', 'overdeck-mcp.json') });
    expect((await stat(join(home, 'agents', 'agent-pan-2', 'mcp-token'))).mode & 0o777).toBe(0o600);
    expect((await stat(join(home, 'agents', 'agent-pan-3', 'mcp-token'))).mode & 0o777).toBe(0o600);
  });

  it('returns {} for kimi-code, mcp.agents false, Docker env, and a conversation without a dir', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await prepareClaudeOverdeckMcp({ agentId: 'agent-pan-1', agentKind: 'agent', role: 'work', harness: 'kimi-code' })).toEqual({});
    expect(await prepareClaudeOverdeckMcp({ agentId: 'my-conv', agentKind: 'conversation', role: 'conversation', harness: 'claude-code' })).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
    mcpAgents.value = false;
    expect(await prepareClaudeOverdeckMcp({ agentId: 'agent-pan-1', agentKind: 'agent', role: 'work', harness: 'claude-code' })).toEqual({});

    mcpAgents.value = true;
    const previous = process.env.OVERDECK_DOCKER_WORKSPACE;
    process.env.OVERDECK_DOCKER_WORKSPACE = '1';
    try {
      expect(await prepareClaudeOverdeckMcp({ agentId: 'agent-pan-1', agentKind: 'agent', role: 'work', harness: 'claude-code' })).toEqual({});
    } finally {
      if (previous === undefined) delete process.env.OVERDECK_DOCKER_WORKSPACE;
      else process.env.OVERDECK_DOCKER_WORKSPACE = previous;
    }
    const previousPan = process.env.PAN_DOCKER;
    process.env.PAN_DOCKER = '1';
    try {
      expect(await prepareClaudeOverdeckMcp({ agentId: 'agent-pan-1', agentKind: 'agent', role: 'work', harness: 'claude-code' })).toEqual({});
    } finally {
      if (previousPan === undefined) delete process.env.PAN_DOCKER;
      else process.env.PAN_DOCKER = previousPan;
    }
    expect(await listAccessTokens()).toEqual([]);
  });

  it('degrades to {} with one warning that names the agent when the mint fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mintFailure.error = new Error('registry is corrupt');

    expect(await prepareClaudeOverdeckMcp({ agentId: 'agent-pan-2', agentKind: 'agent', role: 'work', harness: 'claude-code' })).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]![0]);
    expect(message).toContain('agent-pan-2');
    expect(message).toContain('registry is corrupt');
    expect(message).not.toContain('odk_');
  });

  it('maps a conversation launch to its token role', () => {
    expect(conversationTokenRole({ laneRole: 'builder' }, 'conversation', 'conv-lane-1')).toBe('worker');
    expect(conversationTokenRole({ laneRole: null }, 'conversation', 'conv-flywheel')).toBe('flywheel');
    expect(conversationTokenRole({ laneRole: null }, 'uat', 'conv-x')).toBe('test');
    expect(conversationTokenRole({ laneRole: null }, 'conversation', 'conv-x')).toBe('conversation');
    expect(conversationTokenRole({ laneRole: null }, 'review', 'conv-x')).toBe('review');
  });
});

describe('overdeck MCP injection for Codex (PAN-4933 W-INJ2)', () => {
  it('returns { overdeck } with defaultToolsApprovalMode approve and a 0600 token file for an enabled codex agent', async () => {
    const result = await prepareCodexOverdeckMcp({ agentId: 'agent-pan-9', agentKind: 'agent', role: 'work', harness: 'codex' });
    const tokenFile = join(home, 'agents', 'agent-pan-9', 'mcp-token');

    expect(Object.keys(result)).toEqual(['overdeck']);
    expect(result.overdeck!.env.OVERDECK_MCP_TOKEN_FILE).toBe(tokenFile);
    expect(result.overdeck!.defaultToolsApprovalMode).toBe('approve');
    expect((await stat(tokenFile)).mode & 0o777).toBe(0o600);

    const tokens = await listAccessTokens();
    expect(tokens.filter((t) => t.role === 'work' && !t.revokedAt)).toHaveLength(1);
  });

  it('returns {} for claude-code/kimi-code owners, mcp.agents false, and Docker env, minting no new token', async () => {
    expect(await prepareCodexOverdeckMcp({ agentId: 'agent-pan-1', agentKind: 'agent', role: 'work', harness: 'claude-code' })).toEqual({});
    expect(await prepareCodexOverdeckMcp({ agentId: 'agent-pan-1', agentKind: 'agent', role: 'work', harness: 'kimi-code' })).toEqual({});

    mcpAgents.value = false;
    expect(await prepareCodexOverdeckMcp({ agentId: 'agent-pan-codex-1', agentKind: 'agent', role: 'work', harness: 'codex' })).toEqual({});
    mcpAgents.value = true;

    const previous = process.env.OVERDECK_DOCKER_WORKSPACE;
    process.env.OVERDECK_DOCKER_WORKSPACE = '1';
    try {
      expect(await prepareCodexOverdeckMcp({ agentId: 'agent-pan-codex-2', agentKind: 'agent', role: 'work', harness: 'codex' })).toEqual({});
    } finally {
      if (previous === undefined) delete process.env.OVERDECK_DOCKER_WORKSPACE;
      else process.env.OVERDECK_DOCKER_WORKSPACE = previous;
    }
    expect(await listAccessTokens()).toEqual([]);
  });

  it('degrades to {} with one warning naming the owner on a mint failure or a dir-less conversation', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mintFailure.error = new Error('registry is corrupt');

    expect(await prepareCodexOverdeckMcp({ agentId: 'agent-pan-codex-3', agentKind: 'agent', role: 'work', harness: 'codex' })).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]![0]);
    expect(message).toContain('agent-pan-codex-3');
    expect(message).not.toContain('odk_');

    mintFailure.error = null;
    warn.mockClear();
    expect(await prepareCodexOverdeckMcp({ agentId: 'conv-codex-1', agentKind: 'conversation', role: 'conversation', harness: 'codex' })).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('conv-codex-1');
  });
});

const LINEAR_SERVER = { type: 'stdio' as const, command: 'npx', args: ['-y', 'linear-mcp'], env: { LINEAR_API_KEY: 'lin-acme' } };
const SENTRY_SERVER = { type: 'http' as const, url: 'https://mcp.sentry.dev/mcp', headers: {} };

async function readServers(path: string): Promise<Record<string, unknown>> {
  return (JSON.parse(await readFile(path, 'utf8')) as { mcpServers: Record<string, unknown> }).mcpServers;
}

describe('project MCP servers in the launch MCP file (PAN-5061 WI-5)', () => {
  it('writes overdeck first, then the project servers, and passes the owner cwd and issue', async () => {
    projectMcp.result = { projectKey: 'acme', servers: { linear: LINEAR_SERVER, sentry: SENTRY_SERVER }, strict: false };
    const result = await prepareClaudeOverdeckMcp({
      agentId: 'agent-acme-1', agentKind: 'agent', role: 'work', harness: 'claude-code', cwd: '/w/acme', issueId: 'ACME-1',
    });
    const configPath = join(home, 'agents', 'agent-acme-1', 'overdeck-mcp.json');

    expect(result).toEqual({ overdeckMcpConfig: configPath, overdeckMcpServerNames: ['overdeck', 'linear', 'sentry'] });
    const servers = await readServers(configPath);
    expect(Object.keys(servers)).toEqual(['overdeck', 'linear', 'sentry']);
    expect(servers.linear).toEqual(LINEAR_SERVER);
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    expect(projectMcp.calls).toEqual([{ issueId: 'ACME-1', cwd: '/w/acme', reservedNames: ['overdeck'] }]);
  });

  it('reserves the launching role\'s own server names', async () => {
    await prepareClaudeOverdeckMcp({ agentId: 'agent-acme-t', agentKind: 'agent', role: 'test', harness: 'claude-code', cwd: '/w/acme' });
    expect(projectMcp.calls[0]!.reservedNames).toEqual(['overdeck', 'playwright']);
  });

  it('writes the project servers alone when mcp.agents is false', async () => {
    mcpAgents.value = false;
    projectMcp.result = { projectKey: 'acme', servers: { linear: LINEAR_SERVER }, strict: false };
    const result = await prepareClaudeOverdeckMcp({ agentId: 'agent-acme-2', agentKind: 'agent', role: 'work', harness: 'claude-code', cwd: '/w/acme' });
    const configPath = join(home, 'agents', 'agent-acme-2', 'overdeck-mcp.json');

    expect(result).toEqual({ overdeckMcpConfig: configPath, overdeckMcpServerNames: ['linear'] });
    expect(Object.keys(await readServers(configPath))).toEqual(['linear']);
    expect(await listAccessTokens()).toEqual([]);
  });

  it('writes the project servers alone when the mint fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mintFailure.error = new Error('registry is corrupt');
    projectMcp.result = { projectKey: 'acme', servers: { linear: LINEAR_SERVER }, strict: false };
    const result = await prepareClaudeOverdeckMcp({ agentId: 'agent-acme-3', agentKind: 'agent', role: 'work', harness: 'claude-code', cwd: '/w/acme' });

    expect(result.overdeckMcpServerNames).toEqual(['linear']);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('returns {} and writes no file when nothing resolves', async () => {
    mcpAgents.value = false;
    expect(await prepareClaudeOverdeckMcp({ agentId: 'agent-acme-4', agentKind: 'agent', role: 'work', harness: 'claude-code', cwd: '/w/x' })).toEqual({});
    await expect(stat(join(home, 'agents', 'agent-acme-4', 'overdeck-mcp.json'))).rejects.toThrow();
  });

  it('passes mcp_strict through', async () => {
    projectMcp.result = { projectKey: 'acme', servers: { linear: LINEAR_SERVER }, strict: true };
    const result = await prepareClaudeOverdeckMcp({ agentId: 'agent-acme-5', agentKind: 'agent', role: 'work', harness: 'claude-code', cwd: '/w/acme' });
    expect(result.mcpStrict).toBe(true);
  });

  it('writes the same file for an ACP launch', async () => {
    projectMcp.result = { projectKey: 'acme', servers: { linear: LINEAR_SERVER }, strict: false };
    const result = await prepareClaudeOverdeckMcp({ agentId: 'agent-acme-6', agentKind: 'agent', role: 'work', harness: 'opencode', cwd: '/w/acme' });
    const configPath = join(home, 'agents', 'agent-acme-6', 'overdeck-mcp.json');

    expect(result.overdeckMcpConfig).toBe(configPath);
    expect(Object.keys(await readServers(configPath))).toEqual(['overdeck', 'linear']);
  });

  it('warns once for a harness that provisions no MCP and returns {}', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    projectMcp.result = { projectKey: 'acme', servers: { linear: LINEAR_SERVER, sentry: SENTRY_SERVER }, strict: false };

    expect(await prepareClaudeOverdeckMcp({ agentId: 'agent-acme-7', agentKind: 'agent', role: 'work', harness: 'ohmypi', cwd: '/w/acme' })).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toBe('[project-mcp] acme: harness ohmypi does not provision MCP; servers unavailable: linear, sentry');
    expect(String(warn.mock.calls[0]![0])).not.toContain('lin-acme');
  });

  it('does not warn for a codex launch, which provisions through its server map', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    projectMcp.result = { projectKey: 'acme', servers: { linear: LINEAR_SERVER }, strict: false };
    expect(await prepareClaudeOverdeckMcp({ agentId: 'agent-acme-8', agentKind: 'agent', role: 'work', harness: 'codex', cwd: '/w/acme' })).toEqual({});
    expect(warn).not.toHaveBeenCalled();
  });
});

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

import { _resetAccessTokensForTests, _settleAccessTokenWritesForTests } from '../../../../src/lib/access-tokens.js';
import {
  conversationTokenRole,
  harnessGetsOverdeckMcp,
  overdeckMcpEnabledFor,
  overdeckStdioServer,
  prepareClaudeOverdeckMcp,
} from '../../../../src/lib/mcp/agent-injection.js';

let home: string;
const originalHome = process.env.OVERDECK_HOME;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4932-agent-injection-'));
  process.env.OVERDECK_HOME = home;
  _resetAccessTokensForTests();
  mcpAgents.value = true;
  mintFailure.error = null;
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
    expect(harnessGetsOverdeckMcp('codex')).toBe(false);
    expect(harnessGetsOverdeckMcp('kimi-code')).toBe(false);
  });

  it('is enabled for claude-code unless Docker or the config switch says no', async () => {
    expect(await overdeckMcpEnabledFor('claude-code', {})).toBe(true);
    expect(await overdeckMcpEnabledFor('claude-code', { OVERDECK_DOCKER_WORKSPACE: '1' })).toBe(false);
    expect(await overdeckMcpEnabledFor('claude-code', { PAN_DOCKER: '1' })).toBe(false);
    expect(await overdeckMcpEnabledFor('codex', {})).toBe(false);
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

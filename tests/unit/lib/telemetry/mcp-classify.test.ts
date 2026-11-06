/**
 * PAN-5083 W-2: the pure MCP session classifier.
 */
import { describe, expect, it } from 'vitest';

import {
  MCP_META_CLIENT_KEY,
  MCP_META_PROTOCOL_KEY,
  bucketMcpClient,
  bucketMcpProtocol,
  mcpAuthForToken,
  mcpRequestClient,
  mcpSessionFacts,
} from '../../../../src/lib/telemetry/mcp-classify.js';

describe('bucketMcpClient', () => {
  it.each([
    ['claude-code', 'claude_code'],
    ['Claude Code', 'claude_code'],
    ['codex-mcp-client', 'codex'],
    ['cursor-vscode', 'cursor'],
    ['Visual Studio Code', 'vscode'],
    ['vscode-copilot', 'vscode'],
    ['VS Code', 'vscode'],
    ['ChatGPT', 'chatgpt'],
    ['openai-mcp', 'chatgpt'],
    ['grok-connector', 'grok'],
    ['hermes-agent', 'hermes'],
    ['openclaw', 'openclaw'],
    ['gemini-cli-mcp-client', 'gemini'],
    ['opencode', 'opencode'],
    ['kimi-cli', 'kimi'],
    ['overdeck-connector', 'overdeck_connector'],
    ['some-other-client', 'other'],
  ])('%s → %s', (name, bucket) => {
    expect(bucketMcpClient(name)).toBe(bucket);
  });

  it('returns other for a name over 200 characters, a non-string or nothing', () => {
    expect(bucketMcpClient(`claude-code${'x'.repeat(190)}`)).toBe('other');
    expect(bucketMcpClient(42)).toBe('other');
    expect(bucketMcpClient(undefined)).toBe('other');
  });
});

describe('bucketMcpProtocol', () => {
  it.each(['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'])('keeps %s', (revision) => {
    expect(bucketMcpProtocol(revision)).toBe(revision);
  });

  it('returns other for an unknown revision or a non-string', () => {
    expect(bucketMcpProtocol('2027-01-01')).toBe('other');
    expect(bucketMcpProtocol(20251125)).toBe('other');
    expect(bucketMcpProtocol(undefined)).toBe('other');
  });
});

describe('mcpSessionFacts', () => {
  const initialize = (name: string, protocolVersion: string) => ({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion, capabilities: {}, clientInfo: { name, version: '1.0.0' } },
  });

  it('reads the requested protocol and client from initialize', () => {
    expect(mcpSessionFacts(initialize('claude-code', '2025-11-25'))).toEqual([{ protocol: '2025-11-25', client: 'claude_code' }]);
  });

  it('reads other for an initialize without clientInfo', () => {
    expect(mcpSessionFacts({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }))
      .toEqual([{ protocol: '2025-06-18', client: 'other' }]);
  });

  it('reads 2026-07-28 _meta with clientInfo', () => {
    const message = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: { _meta: { [MCP_META_PROTOCOL_KEY]: '2026-07-28', [MCP_META_CLIENT_KEY]: { name: 'codex-mcp-client', version: '1' } } },
    };
    expect(mcpSessionFacts(message)).toEqual([{ protocol: '2026-07-28', client: 'codex' }]);
  });

  it('reads 2026-07-28 _meta with only the protocol key as an unknown client', () => {
    const message = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: { [MCP_META_PROTOCOL_KEY]: '2026-07-28' } } };
    expect(mcpSessionFacts(message)).toEqual([{ protocol: '2026-07-28', client: undefined }]);
  });

  it('falls back to the header when _meta has only clientInfo', () => {
    const message = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: { [MCP_META_CLIENT_KEY]: { name: 'cursor' } } } };
    expect(mcpSessionFacts(message, '2025-06-18')).toEqual([{ protocol: '2025-06-18', client: 'cursor' }]);
    expect(mcpSessionFacts(message)).toEqual([{ protocol: 'other', client: 'cursor' }]);
  });

  it('returns [] for a v1 tools/call that carries only the header', () => {
    const message = { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_conversations', arguments: {} } };
    expect(mcpSessionFacts(message, '2025-11-25')).toEqual([]);
  });

  it('returns [] for a notification without _meta', () => {
    expect(mcpSessionFacts({ jsonrpc: '2.0', method: 'notifications/initialized' })).toEqual([]);
  });

  it('returns one fact per initialize in a batch', () => {
    expect(mcpSessionFacts([initialize('claude-code', '2025-11-25'), initialize('codex-mcp-client', '2025-06-18')])).toEqual([
      { protocol: '2025-11-25', client: 'claude_code' },
      { protocol: '2025-06-18', client: 'codex' },
    ]);
  });

  it('returns [] for non-object input', () => {
    for (const input of [null, undefined, 'initialize', 42, true]) expect(mcpSessionFacts(input)).toEqual([]);
    expect(mcpSessionFacts({ jsonrpc: '2.0', id: 1, result: {} })).toEqual([]);
  });
});

describe('mcpRequestClient', () => {
  it('buckets the _meta clientInfo name and returns undefined without one', () => {
    expect(mcpRequestClient({ name: 'done', _meta: { [MCP_META_CLIENT_KEY]: { name: 'claude-code' } } })).toBe('claude_code');
    expect(mcpRequestClient({ name: 'done' })).toBeUndefined();
    expect(mcpRequestClient(undefined)).toBeUndefined();
  });
});

describe('mcpAuthForToken', () => {
  it('maps oauth, agent and plain token records', () => {
    expect(mcpAuthForToken({ tokenId: 't1', oauthClientId: 'client-1' })).toBe('oauth');
    expect(mcpAuthForToken({ tokenId: 't2', agentId: 'agent-pan-1' })).toBe('agent_token');
    expect(mcpAuthForToken({ tokenId: 't3' })).toBe('access_token');
    expect(mcpAuthForToken({ tokenId: 't4', oauthClientId: '', agentId: '' })).toBe('access_token');
  });
});

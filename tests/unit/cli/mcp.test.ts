/**
 * PAN-4649 W-9: `pan mcp serve`. Token refusals use the real registry in a
 * temporary OVERDECK_HOME; a valid token serves tools/list over PassThrough
 * stdio, and stdout carries only JSON-RPC lines.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/config.js', () => ({ getDashboardApiUrl: () => 'http://localhost:3011' }));

const { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken, revokeAccessToken } = await import('../../../src/lib/access-tokens.js');
const { runMcpServe } = await import('../../../src/cli/commands/mcp.js');

const originalHome = process.env.OVERDECK_HOME;
let home: string;
let stderr: string[];

function io(env: NodeJS.ProcessEnv) {
  return { env, stdin: new PassThrough(), stdout: new PassThrough(), stderr: (line: string) => { stderr.push(line); } };
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4649-mcp-cli-'));
  process.env.OVERDECK_HOME = home;
  _resetAccessTokensForTests();
  stderr = [];
});

afterEach(async () => {
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('pan mcp serve (PAN-4649 W-9)', () => {
  it('exits 1 and names pan token create mcp when OVERDECK_MCP_TOKEN is unset', async () => {
    const deps = io({});
    await expect(runMcpServe(deps)).resolves.toBe(1);
    expect(stderr.join('\n')).toContain('pan token create mcp --scopes read:state,read:conversations,operate');
  });

  it('refuses an admin token', async () => {
    const { token } = await createAccessToken({ name: 'too-strong', scopes: ['admin'], kind: 'token' });
    await expect(runMcpServe(io({ OVERDECK_MCP_TOKEN: token }))).resolves.toBe(1);
    expect(stderr.join('\n')).toContain('cannot carry admin');
  });

  it('refuses a revoked token', async () => {
    const { token, record } = await createAccessToken({ name: 'old', scopes: ['read:conversations'], kind: 'token' });
    await revokeAccessToken(record.id);
    await expect(runMcpServe(io({ OVERDECK_MCP_TOKEN: token }))).resolves.toBe(1);
    expect(stderr.join('\n')).toContain('unknown or revoked');
  });

  it('refuses a paired-device credential', async () => {
    const { token } = await createAccessToken({ name: 'phone', scopes: ['read:conversations'], kind: 'device' });
    await expect(runMcpServe(io({ OVERDECK_MCP_TOKEN: token }))).resolves.toBe(1);
    expect(stderr.join('\n')).toContain('paired device');
  });

  it('serves tools/list on stdout with only JSON-RPC lines, and exits 0 when stdin closes', async () => {
    const { token } = await createAccessToken({ name: 'mcp', scopes: ['read:conversations'], kind: 'token' });
    const deps = io({ OVERDECK_MCP_TOKEN: token });
    const lines: string[] = [];
    let buffered = '';
    deps.stdout.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      const parts = buffered.split('\n');
      buffered = parts.pop() ?? '';
      lines.push(...parts.filter((line) => line !== ''));
    });

    const serving = runMcpServe(deps);
    deps.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0.0.0' } },
    })}\n`);
    await vi.waitFor(() => expect(lines.length).toBe(1));
    deps.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    deps.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
    await vi.waitFor(() => expect(lines.length).toBe(2));

    const messages = lines.map((line) => JSON.parse(line) as { jsonrpc: string; id: number; result: { tools?: Array<{ name: string }> } });
    for (const message of messages) expect(message.jsonrpc).toBe('2.0');
    expect(messages[1]?.id).toBe(2);
    expect(messages[1]?.result.tools?.map((tool) => tool.name)).toEqual(['list_conversations', 'search_conversations', 'read_conversation', 'list_pending_input']);

    deps.stdin.end();
    await expect(serving).resolves.toBe(0);
    expect(stderr).toEqual([]);
  });
});

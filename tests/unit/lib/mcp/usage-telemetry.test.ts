/**
 * PAN-5083 W-4: a labelled Overdeck MCP server records `mcp_tool_called`
 * once per day per surface, client and tool; an unlabelled one records nothing.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createOverdeckMcpServer, MCP_DEFAULT_SCOPES } from '../../../../src/lib/mcp/server.js';
import { McpUsageTelemetry, type McpUsageLabel } from '../../../../src/lib/telemetry/mcp.js';
import { callTool, fakeApi, resultText } from './harness.js';

const label: McpUsageLabel = { surface: 'dashboard_http', auth: 'access_token', callerKey: 'tok-1' };

describe('MCP tool-call telemetry (PAN-5083)', () => {
  let dir: string;
  let capture: ReturnType<typeof vi.fn>;
  let telemetry: McpUsageTelemetry;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pan-mcp-usage-'));
    capture = vi.fn();
    telemetry = new McpUsageTelemetry({ analytics: () => ({ capture }), enabled: () => true, ledgerFile: () => join(dir, 'seen.json') });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function connect(usage?: Parameters<typeof createOverdeckMcpServer>[2]): Promise<Client> {
    const server = createOverdeckMcpServer({ api: fakeApi({}), scopes: MCP_DEFAULT_SCOPES, isAgent: false }, undefined, usage);
    const client = new Client({ name: 'codex-mcp-client', version: '0.159.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return client;
  }

  it('records one mcp_tool_called for two calls of one tool', async () => {
    const client = await connect({ label, telemetry });
    await callTool(client, 'list_conversations');
    await callTool(client, 'list_conversations');
    await telemetry.settled();

    expect(capture.mock.calls).toEqual([
      ['mcp_tool_called', { mcp_surface: 'dashboard_http', mcp_client: 'other', mcp_tool: 'list_conversations' }],
    ]);
  });

  it('records nothing for a server created without a label', async () => {
    const client = await connect();
    await callTool(client, 'list_conversations');
    await telemetry.settled();
    expect(capture).not.toHaveBeenCalled();
  });

  it('answers an unknown tool as before and records nothing', async () => {
    const client = await connect({ label, telemetry });
    const result = await callTool(client, 'not_a_tool');
    await telemetry.settled();

    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe('Unknown tool not_a_tool');
    expect(capture).not.toHaveBeenCalled();
  });
});

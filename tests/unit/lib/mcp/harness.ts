/**
 * Test harness for the Overdeck MCP tool module (PAN-4649): an SDK `Client`
 * linked in memory to `createOverdeckMcpServer`, over a fake `DashboardApi`
 * that records every call and answers by `METHOD path`.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { DashboardApi, DashboardApiMethod, DashboardApiResponse } from '../../../../src/lib/mcp/dashboard-api.js';
import { createOverdeckMcpServer, type OverdeckTool } from '../../../../src/lib/mcp/server.js';

export interface RecordedCall {
  method: DashboardApiMethod;
  path: string;
  body?: unknown;
}

export interface FakeApi extends DashboardApi {
  calls: RecordedCall[];
}

/** Answers `METHOD path` from `routes`; an unlisted call answers 404. */
export function fakeApi(routes: Record<string, DashboardApiResponse>): FakeApi {
  const calls: RecordedCall[] = [];
  return {
    calls,
    async request(method, path, body) {
      calls.push(body === undefined ? { method, path } : { method, path, body });
      return routes[`${method} ${path}`] ?? { status: 404, json: { error: 'not found' } };
    },
  };
}

export async function connectClient(
  api: DashboardApi,
  scopes: readonly string[],
  isAgent = false,
  tools?: readonly OverdeckTool[],
): Promise<Client> {
  const server = createOverdeckMcpServer({ api, scopes, isAgent }, tools);
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

export async function callTool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

/** The text of a single-text-block tool result. */
export function resultText(result: CallToolResult): string {
  const block = result.content[0];
  return block && block.type === 'text' ? block.text : '';
}

/** The parsed JSON of a successful tool result. */
export function resultJson(result: CallToolResult): unknown {
  return JSON.parse(resultText(result));
}

export const ENVIRONMENT = {
  status: 200,
  json: { descriptorVersion: 1, environmentId: 'env-desk-1', label: 'desk', platform: { os: 'linux', arch: 'x64' }, serverVersion: '1.2.3' },
};

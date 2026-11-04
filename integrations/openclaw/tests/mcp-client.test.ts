import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMcpClient, OverdeckMcpError, TOOL_TIMEOUT_MS } from '../src/mcp-client.js';

// Built at runtime so no committed file carries a token-shaped literal (NFR-1).
const TOKEN = ['odl', 'a'.repeat(64)].join('_');
const URL_IN = new URL('http://127.0.0.1:7466/mcp');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function clientWith(fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(fetchImpl);
  return { fetchMock, client: createMcpClient({ url: URL_IN, token: TOKEN, fetch: fetchMock as unknown as typeof fetch }) };
}

async function errorOf(promise: Promise<unknown>): Promise<OverdeckMcpError> {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(OverdeckMcpError);
  const message = (error as Error).message;
  expect(message).not.toContain(TOKEN);
  return error as OverdeckMcpError;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createMcpClient', () => {
  it('sends one JSON-RPC tools/call POST with the three headers', async () => {
    const { client, fetchMock } = clientWith(async () => jsonResponse({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'ok' }] } }));
    await client.callTool('list_pending_input', { a: 1 });
    await client.callTool('list_pending_input', {});

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:7466/mcp');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${TOKEN}`,
    });
    expect(JSON.parse(init?.body as string)).toEqual({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_pending_input', arguments: { a: 1 } } });
    expect(JSON.parse(fetchMock.mock.calls[1]![1]?.body as string).id).toBe(2);
  });

  it('joins text blocks and ignores other blocks', async () => {
    const { client } = clientWith(async () => jsonResponse({ result: { content: [{ type: 'text', text: 'one' }, { type: 'image', data: 'x' }, { type: 'text', text: 'two' }] } }));
    expect(await client.callTool('t', {})).toEqual({ isError: false, text: 'one\ntwo' });
  });

  it('passes isError through', async () => {
    const { client } = clientWith(async () => jsonResponse({ result: { isError: true, content: [{ type: 'text', text: 'Unknown tool t' }] } }));
    expect(await client.callTool('t', {})).toEqual({ isError: true, text: 'Unknown tool t' });
  });

  it('reports an unreachable endpoint by origin only', async () => {
    const { client } = clientWith(async () => { throw new TypeError(`fetch failed ${TOKEN}`); });
    expect((await errorOf(client.callTool('t', {}))).message).toBe('Cannot reach Overdeck at http://127.0.0.1:7466');
  });

  it('reports HTTP 401 as a token problem', async () => {
    const { client } = clientWith(async () => new Response('no', { status: 401 }));
    expect((await errorOf(client.callTool('t', {}))).message).toBe('Overdeck refused the token (HTTP 401). Check localToken.');
  });

  it.each([406, 500])('reports HTTP %i by status', async (status) => {
    const { client } = clientWith(async () => new Response(TOKEN, { status }));
    expect((await errorOf(client.callTool('t', {}))).message).toBe(`Overdeck MCP request failed (HTTP ${status})`);
  });

  it('reports a body that is not JSON', async () => {
    const { client } = clientWith(async () => new Response(`<html>${TOKEN}</html>`, { status: 200 }));
    expect((await errorOf(client.callTool('t', {}))).message).toBe('Overdeck answered with something that is not JSON');
  });

  it('reports a JSON-RPC error, cut to 300 characters', async () => {
    const { client } = clientWith(async () => jsonResponse({ error: { code: -32000, message: 'x'.repeat(400) } }));
    expect((await errorOf(client.callTool('t', {}))).message).toBe(`Overdeck MCP error: ${'x'.repeat(300)}`);
  });

  it('reports an answer without a result', async () => {
    const { client } = clientWith(async () => jsonResponse({ jsonrpc: '2.0', id: 1 }));
    expect((await errorOf(client.callTool('t', {}))).message).toBe('Overdeck answered without a result');
  });

  it('times out after TOOL_TIMEOUT_MS', async () => {
    vi.useFakeTimers();
    const { client } = clientWith((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const pending = errorOf(client.callTool('t', {}));
    await vi.advanceTimersByTimeAsync(TOOL_TIMEOUT_MS);
    expect((await pending).message).toBe('Overdeck did not answer within 10 s');
  });

  it('honors a shorter per-call timeout', async () => {
    vi.useFakeTimers();
    const { client } = clientWith((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const pending = errorOf(client.callTool('t', {}, { timeoutMs: 5_000 }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await pending).message).toBe('Overdeck did not answer within 5 s');
  });
});

/** PAN-5598 WI-3: the order-book read tools call their routes, honor the project argument, and validate before calling the route. */
import { describe, expect, it } from 'vitest';

import { requiredScopeFor } from '../../../../src/dashboard/server/route-scopes.js';
import { ORDER_TOOLS } from '../../../../src/lib/mcp/tools-orders.js';
import { callTool, connectClient, fakeApi, resultJson } from './harness.js';

const SCOPES = ['read:state', 'operate'];
const READ_ROUTES: Record<string, { method: string; path: string }> = {
  list_order_books: { method: 'GET', path: '/api/orders' },
  get_order_book: { method: 'GET', path: '/api/orders/b' },
  list_order_book_candidates: { method: 'GET', path: '/api/orders/backlog-candidates' },
  preview_order_book_brief: { method: 'GET', path: '/api/orders/b/preview-brief' },
};

describe('MCP order-book read tools (PAN-5598 WI-3)', () => {
  it('each order read tool calls its route', async () => {
    const api = fakeApi({
      'GET /api/orders': { status: 200, json: [{ id: 'b' }] },
      'GET /api/orders/b': { status: 200, json: { id: 'b' } },
      'GET /api/orders/backlog-candidates?limit=10': { status: 200, json: [] },
      'GET /api/orders/b/preview-brief': { status: 200, json: '# Special orders: b' },
    });
    const client = await connectClient(api, SCOPES, true);
    expect(resultJson(await callTool(client, 'list_order_books'))).toEqual([{ id: 'b' }]);
    expect(resultJson(await callTool(client, 'get_order_book', { book: 'b' }))).toEqual({ id: 'b' });
    expect(resultJson(await callTool(client, 'list_order_book_candidates'))).toEqual([]);
    expect(resultJson(await callTool(client, 'preview_order_book_brief', { book: 'b' }))).toEqual('# Special orders: b');
  });

  it('each order read tool\'s scope equals its route\'s', () => {
    for (const [name, route] of Object.entries(READ_ROUTES)) {
      expect(ORDER_TOOLS.find((tool) => tool.name === name)!.scope, name).toBe(requiredScopeFor(route.method, route.path));
    }
  });

  it('a project argument is sent as ?project=', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, SCOPES, true);
    await callTool(client, 'list_order_books', { project: 'my proj' });
    await callTool(client, 'list_order_book_candidates', { limit: 5, project: 'p' });
    expect(api.calls).toEqual([
      { method: 'GET', path: '/api/orders?project=my%20proj' },
      { method: 'GET', path: '/api/orders/backlog-candidates?limit=5&project=p' },
    ]);
  });

  it('list_order_book_candidates refuses limit 101 without calling the route', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, SCOPES, true);
    const result = await callTool(client, 'list_order_book_candidates', { limit: 101 });
    expect(result.isError).toBe(true);
    expect(api.calls).toEqual([]);
  });

  it('get_order_book refuses a missing book without calling the route', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, SCOPES, true);
    const result = await callTool(client, 'get_order_book', {});
    expect(result.isError).toBe(true);
    expect(api.calls).toEqual([]);
  });
});

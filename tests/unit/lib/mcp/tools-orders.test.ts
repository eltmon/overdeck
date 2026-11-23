/** PAN-5598 WI-3/WI-4: the order-book tools call their routes, honor the project argument, validate before calling the route, and cover every /api/orders route (NFR-2). */
import { describe, expect, it } from 'vitest';

import { ROUTE_SCOPES, requiredScopeFor } from '../../../../src/dashboard/server/route-scopes.js';
import { visibleTools } from '../../../../src/lib/mcp/server.js';
import { ORDER_TOOLS } from '../../../../src/lib/mcp/tools-orders.js';
import { callTool, connectClient, fakeApi, resultJson, resultText } from './harness.js';

const SCOPES = ['read:state', 'operate'];

/** `METHOD path` for every one of the ten tools, with the `ROUTE_SCOPES` placeholder syntax (`:id`, `:issue`). */
const ROUTE_PATTERNS: Record<string, { method: string; path: string }> = {
  list_order_books: { method: 'GET', path: '/api/orders' },
  get_order_book: { method: 'GET', path: '/api/orders/:id' },
  list_order_book_candidates: { method: 'GET', path: '/api/orders/backlog-candidates' },
  preview_order_book_brief: { method: 'GET', path: '/api/orders/:id/preview-brief' },
  create_order_book: { method: 'POST', path: '/api/orders' },
  update_order_book: { method: 'PATCH', path: '/api/orders/:id' },
  add_order_book_issues: { method: 'POST', path: '/api/orders/:id/items' },
  update_order_book_issue: { method: 'PATCH', path: '/api/orders/:id/items/:issue' },
  remove_order_book_issue: { method: 'DELETE', path: '/api/orders/:id/items/:issue' },
  start_order_book: { method: 'POST', path: '/api/orders/:id/start' },
};

describe('MCP order-book tools (PAN-5598 WI-3, WI-4)', () => {
  it('every order tool\'s scope equals its route\'s', () => {
    for (const [name, route] of Object.entries(ROUTE_PATTERNS)) {
      expect(ORDER_TOOLS.find((tool) => tool.name === name)!.scope, name).toBe(requiredScopeFor(route.method, route.path));
    }
  });

  it('the tool set covers every /api/orders route (NFR-2)', () => {
    const toolRoutes = new Set(Object.values(ROUTE_PATTERNS).map((route) => `${route.method} ${route.path}`));
    const scopedOrderRoutes = new Set(
      ROUTE_SCOPES.filter((entry) => entry.path.startsWith('/api/orders')).map((entry) => `${entry.method} ${entry.path}`),
    );
    expect(toolRoutes).toEqual(scopedOrderRoutes);
  });

  it('read tools are visible to a read:state token and write tools are not', () => {
    const names = visibleTools({ scopes: ['read:state'], isAgent: false }, ORDER_TOOLS).map((tool) => tool.name);
    expect(names).toEqual(['list_order_books', 'get_order_book', 'list_order_book_candidates', 'preview_order_book_brief']);
  });

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

  it('create_order_book posts name to POST /api/orders', async () => {
    const api = fakeApi({ 'POST /api/orders': { status: 201, json: { id: 'b' } } });
    const client = await connectClient(api, SCOPES, true);
    expect(resultJson(await callTool(client, 'create_order_book', { name: 'Sprint' }))).toEqual({ id: 'b' });
    expect(api.calls).toEqual([{ method: 'POST', path: '/api/orders', body: { name: 'Sprint' } }]);
  });

  it('update_order_book maps pickup paused to posture drain with the reason', async () => {
    const api = fakeApi({ 'PATCH /api/orders/b': { status: 200, json: { id: 'b' } } });
    const client = await connectClient(api, SCOPES, true);
    await callTool(client, 'update_order_book', { book: 'b', pickup: 'paused', pickupReason: 'x' });
    expect(api.calls).toEqual([{ method: 'PATCH', path: '/api/orders/b', body: { settings: { posture: 'drain', postureReason: 'x' } } }]);
  });

  it('update_order_book maps parallelLimit and briefFile into settings', async () => {
    const api = fakeApi({ 'PATCH /api/orders/b': { status: 200, json: { id: 'b' } } });
    const client = await connectClient(api, SCOPES, true);
    await callTool(client, 'update_order_book', { book: 'b', parallelLimit: 4, briefFile: 'docs/overlay.md' });
    expect(api.calls).toEqual([{ method: 'PATCH', path: '/api/orders/b', body: { settings: { laneAConcurrency: 4, briefOverlay: 'docs/overlay.md' } } }]);
  });

  it('update_order_book refuses a call with nothing to change', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, SCOPES, true);
    const result = await callTool(client, 'update_order_book', { book: 'b' });
    expect(result.isError).toBe(true);
    expect(api.calls).toEqual([]);
  });

  it('update_order_book refuses parallelLimit 9', async () => {
    const api = fakeApi({});
    const client = await connectClient(api, SCOPES, true);
    const result = await callTool(client, 'update_order_book', { book: 'b', parallelLimit: 9 });
    expect(result.isError).toBe(true);
    expect(api.calls).toEqual([]);
  });

  it('add_order_book_issues sends one item per issue with the lane', async () => {
    const api = fakeApi({ 'POST /api/orders/b/items': { status: 200, json: { id: 'b' } } });
    const client = await connectClient(api, SCOPES, true);
    await callTool(client, 'add_order_book_issues', { book: 'b', issues: ['PAN-1', 'PAN-2'], lane: 'B' });
    expect(api.calls).toEqual([{
      method: 'POST',
      path: '/api/orders/b/items',
      body: { items: [{ issue: 'PAN-1', lane: 'B' }, { issue: 'PAN-2', lane: 'B' }] },
    }]);
  });

  it('update_order_book_issue sends only the given fields', async () => {
    const api = fakeApi({ 'PATCH /api/orders/b/items/PAN-1': { status: 200, json: { id: 'b' } } });
    const client = await connectClient(api, SCOPES, true);
    await callTool(client, 'update_order_book_issue', { book: 'b', issue: 'PAN-1', order: 2 });
    expect(api.calls).toEqual([{ method: 'PATCH', path: '/api/orders/b/items/PAN-1', body: { order: 2 } }]);
    const result = await callTool(client, 'update_order_book_issue', { book: 'b', issue: 'PAN-1' });
    expect(result.isError).toBe(true);
  });

  it('remove_order_book_issue sends DELETE with body {}', async () => {
    const api = fakeApi({ 'DELETE /api/orders/b/items/PAN-1': { status: 200, json: { id: 'b' } } });
    const client = await connectClient(api, SCOPES, true);
    await callTool(client, 'remove_order_book_issue', { book: 'b', issue: 'PAN-1' });
    expect(api.calls).toEqual([{ method: 'DELETE', path: '/api/orders/b/items/PAN-1', body: {} }]);
  });

  it('start_order_book reports blocking findings on 422', async () => {
    const api = fakeApi({
      'POST /api/orders/b/start': {
        status: 422,
        json: { error: 'Order book b cannot start', findings: [{ issue: 'PAN-1', message: 'is not open' }], warnings: [] },
      },
    });
    const client = await connectClient(api, SCOPES, true);
    const result = await callTool(client, 'start_order_book', { book: 'b' });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe('HTTP 422: Order book b cannot start\nBLOCK PAN-1 is not open');
  });
});

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } from '../../../../lib/internal-token.js';
import type { OrderIssueLookup, OrderIssueState } from '../../../../lib/orders/types.js';
import { makeOrdersRouteLayer } from '../orders.js';

interface RouteResult {
  status: number;
  body: Record<string, unknown>;
}

const roots: string[] = [];
const at = '2026-07-18T12:00:00.000Z';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function gitFixture(): string {
  const root = join(process.cwd(), `.test-orders-routes-${process.pid}-${roots.length}`);
  const origin = `${root}-origin.git`;
  roots.push(root, origin);
  mkdirSync(root, { recursive: true });
  git(['init'], root);
  git(['config', 'user.name', 'Orders Route Test'], root);
  git(['config', 'user.email', 'orders-routes@example.com'], root);
  writeFileSync(join(root, 'migration-complete.json'), JSON.stringify({ seededAt: at }), 'utf8');
  git(['add', 'migration-complete.json'], root);
  git(['commit', '-m', 'seed'], root);
  git(['branch', '-M', 'overdeck-state'], root);
  execFileSync('git', ['init', '--bare', origin], { encoding: 'utf8' });
  git(['remote', 'add', 'origin', origin], root);
  git(['push', '-u', 'origin', 'overdeck-state'], root);
  return root;
}

function issueLookup(states: ReadonlyMap<string, OrderIssueState>): OrderIssueLookup {
  return (issueIds) => new Map(
    issueIds
      .map((issue) => issue.toUpperCase())
      .filter((issue) => states.has(issue))
      .map((issue) => [issue, states.get(issue)!]),
  );
}

async function requestOrdersRoute(
  layer: ReturnType<typeof makeOrdersRouteLayer>,
  path: string,
  init: RequestInit = {},
): Promise<RouteResult> {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, init));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(layer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
      ),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
}

function mutation(method: string, body: unknown = {}): RequestInit {
  return {
    method,
    headers: {
      'Content-Type': 'application/json',
      [INTERNAL_TOKEN_HEADER]: 'orders-route-test-token',
    },
    body: JSON.stringify(body),
  };
}

function writeSequence(root: string): void {
  mkdirSync(join(root, 'backlog'), { recursive: true });
  const nodes = ['PAN-1', 'PAN-2', 'PAN-3', 'PAN-4'].map((issue, index) => ({
    issue,
    rank: index + 1,
    size: 'S',
    importance: 'medium',
    score: 50,
    condition: 'ok',
    dependsOn: [],
    why: issue,
    gate: 'auto',
    planning: 'auto',
  }));
  writeFileSync(
    join(root, 'backlog', 'sequence.md'),
    `# Backlog\n\n\`\`\`json\n${JSON.stringify({
      version: 1,
      project: 'overdeck',
      generatedAt: at,
      model: 'test',
      pass: 'creation',
      openCount: nodes.length,
      nodes,
      edges: [],
    })}\n\`\`\`\n`,
    'utf8',
  );
}

beforeEach(() => {
  process.env['OVERDECK_INTERNAL_TOKEN'] = 'orders-route-test-token';
  _resetInternalTokenCacheForTests();
});

afterEach(() => {
  delete process.env['OVERDECK_INTERNAL_TOKEN'];
  _resetInternalTokenCacheForTests();
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('/api/orders routes', () => {
  it('creates, edits, lists, previews, and removes order-book items with progress', async () => {
    const root = gitFixture();
    const states = new Map<string, OrderIssueState>([
      ['PAN-1', { issue: 'PAN-1', open: false, parked: false }],
      ['PAN-2', { issue: 'PAN-2', open: true, parked: true }],
    ]);
    const layer = makeOrdersRouteLayer({
      stateRoot: () => root,
      issueLookup: issueLookup(states),
      now: () => new Date(at),
    });
    const bookId = '2026-07-18-campaign';

    await expect(requestOrdersRoute(layer, '/api/orders', mutation('POST', {
      id: bookId,
      name: 'Campaign',
    }))).resolves.toMatchObject({ status: 200, body: { id: bookId, status: 'draft' } });

    await expect(requestOrdersRoute(layer, `/api/orders/${bookId}/items`, mutation('POST', {
      items: [
        { issue: 'PAN-1', lane: 'A' },
        { issue: 'PAN-2', lane: 'A', prereqs: ['PAN-1'] },
      ],
    }))).resolves.toMatchObject({ status: 200 });

    await expect(requestOrdersRoute(layer, `/api/orders/${bookId}/items/PAN-2`, mutation('PATCH', {
      lane: 'B',
      order: 1,
      reVerify: true,
    }))).resolves.toMatchObject({
      status: 200,
      body: { items: [{ issue: 'PAN-1', lane: 'A' }, { issue: 'PAN-2', lane: 'B', reVerify: true }] },
    });

    const detail = await requestOrdersRoute(layer, `/api/orders/${bookId}`);
    expect(detail).toMatchObject({
      status: 200,
      body: {
        id: bookId,
        progress: {
          total: 2,
          landed: 1,
          drained: true,
          items: [
            { issue: 'PAN-1', closed: true, terminal: true },
            { issue: 'PAN-2', parked: true, terminal: true },
          ],
        },
      },
    });

    await expect(requestOrdersRoute(layer, `/api/orders/${bookId}`, mutation('PATCH', {
      name: 'Renamed campaign',
      settings: { laneAConcurrency: 3, posture: 'drain', postureReason: 'Operator hold' },
      status: 'ready',
    }))).resolves.toMatchObject({
      status: 200,
      body: { name: 'Renamed campaign', status: 'ready', settings: { laneAConcurrency: 3, posture: 'drain' } },
    });

    await expect(requestOrdersRoute(layer, '/api/orders')).resolves.toMatchObject({
      status: 200,
      body: { books: [{ id: bookId, name: 'Renamed campaign' }] },
    });

    const preview = await requestOrdersRoute(layer, `/api/orders/${bookId}/preview-brief`);
    expect(preview.status).toBe(200);
    expect(preview.body['brief']).toContain('B1 PAN-2 — after PAN-1; re-verify PRD');

    await expect(requestOrdersRoute(layer, `/api/orders/${bookId}/items/PAN-1`, mutation('DELETE')))
      .resolves.toMatchObject({ status: 200, body: { items: [{ issue: 'PAN-2', order: 1 }] } });
  });

  it('returns sequenced backlog candidates excluding every active-book member', async () => {
    const root = gitFixture();
    const layer = makeOrdersRouteLayer({ stateRoot: () => root });
    const bookId = '2026-07-18-filter';
    await requestOrdersRoute(layer, '/api/orders', mutation('POST', { id: bookId, name: 'Filter' }));
    await requestOrdersRoute(layer, `/api/orders/${bookId}/items`, mutation('POST', {
      items: [{ issue: 'PAN-2', lane: 'A' }],
    }));
    writeSequence(root);

    await expect(requestOrdersRoute(layer, '/api/orders/backlog-candidates?limit=2')).resolves.toEqual({
      status: 200,
      body: {
        candidates: [
          expect.objectContaining({ issue: 'PAN-1', rank: 1 }),
          expect.objectContaining({ issue: 'PAN-3', rank: 3 }),
        ],
      },
    });
  });

  it('returns validation findings without starting, then delegates a clean book to the shared start path', async () => {
    const root = gitFixture();
    const states = new Map<string, OrderIssueState>([
      ['PAN-9', { issue: 'PAN-9', open: false, parked: false }],
      ['PAN-10', { issue: 'PAN-10', open: true, parked: false }],
    ]);
    const startOrderBook = vi.fn(async () => ({ runId: 'RUN-88' }));
    const layer = makeOrdersRouteLayer({
      stateRoot: () => root,
      issueLookup: issueLookup(states),
      startOrderBook,
    });

    await requestOrdersRoute(layer, '/api/orders', mutation('POST', {
      id: '2026-07-18-blocked',
      name: 'Blocked',
    }));
    await requestOrdersRoute(layer, '/api/orders/2026-07-18-blocked/items', mutation('POST', {
      items: [{ issue: 'PAN-9', lane: 'A' }],
    }));

    await expect(requestOrdersRoute(layer, '/api/orders/2026-07-18-blocked/start', mutation('POST')))
      .resolves.toMatchObject({
        status: 422,
        body: {
          error: 'Order book 2026-07-18-blocked cannot start',
          findings: [{ code: 'issue-not-open', issue: 'PAN-9' }],
        },
      });
    expect(startOrderBook).not.toHaveBeenCalled();

    await requestOrdersRoute(layer, '/api/orders', mutation('POST', {
      id: '2026-07-18-clean',
      name: 'Clean',
    }));
    await requestOrdersRoute(layer, '/api/orders/2026-07-18-clean/items', mutation('POST', {
      items: [{ issue: 'PAN-10', lane: 'A' }],
    }));

    await expect(requestOrdersRoute(layer, '/api/orders/2026-07-18-clean/start', mutation('POST')))
      .resolves.toEqual({ status: 200, body: { ok: true, runId: 'RUN-88', warnings: [] } });
    expect(startOrderBook).toHaveBeenCalledOnce();
    expect(startOrderBook).toHaveBeenCalledWith(expect.objectContaining({ id: '2026-07-18-clean' }));
  });
});

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } from '../../../../lib/internal-token.js';
import type { OrderIssueLookup, OrderIssueState } from '../../../../lib/orders/types.js';
import type { ProjectConfig } from '../../../../lib/projects.js';
import { makeOrdersRouteLayer } from '../orders.js';

const {
  mockGetProjectSync,
  mockFindProjectByPathSync,
  mockListProjectsSync,
  mockResolveStateReadHomeSync,
  mockResolveStateReadHomeAsync,
  mockStartFlywheelRun,
} = vi.hoisted(() => ({
  mockGetProjectSync: vi.fn(),
  mockFindProjectByPathSync: vi.fn(),
  mockListProjectsSync: vi.fn(),
  mockResolveStateReadHomeSync: vi.fn(),
  mockResolveStateReadHomeAsync: vi.fn(),
  mockStartFlywheelRun: vi.fn(),
}));

vi.mock('../../../../lib/projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/projects.js')>();
  return {
    ...actual,
    getProjectSync: mockGetProjectSync,
    findProjectByPathSync: mockFindProjectByPathSync,
    listProjectsSync: mockListProjectsSync,
  };
});

vi.mock('../../../../cli/commands/flywheel.js', () => ({
  startFlywheelRun: mockStartFlywheelRun,
}));

vi.mock('../../../../lib/state-read-home.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/state-read-home.js')>();
  return {
    ...actual,
    resolveStateReadHomeSync: mockResolveStateReadHomeSync,
    resolveStateReadHomeAsync: mockResolveStateReadHomeAsync,
  };
});

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
  mockGetProjectSync.mockReset().mockReturnValue(null);
  mockFindProjectByPathSync.mockReset().mockReturnValue(null);
  mockListProjectsSync.mockReset().mockReturnValue([]);
  mockResolveStateReadHomeSync.mockReset();
  // Delegates to whatever the sync mock is configured to return, so tests only
  // need to configure one mock regardless of which resolution path they exercise.
  mockResolveStateReadHomeAsync.mockReset().mockImplementation(
    async (project: ProjectConfig, key?: string) => mockResolveStateReadHomeSync(project, key),
  );
  mockStartFlywheelRun.mockReset();
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
      ['PAN-3', { issue: 'PAN-3', open: true, parked: false }],
    ]);
    const layer = makeOrdersRouteLayer({
      stateRoot: () => root,
      issueLookup: issueLookup(states),
      now: () => new Date(at),
      actor: () => 'authenticated-operator',
    });
    const bookId = '2026-07-18-campaign';

    await expect(requestOrdersRoute(layer, '/api/orders', mutation('POST', {
      id: bookId,
      name: 'Campaign',
    }))).resolves.toMatchObject({ status: 200, body: { id: bookId, status: 'draft' } });

    await expect(requestOrdersRoute(layer, `/api/orders/${bookId}/items`, mutation('POST', {
      actor: 'spoofed-operator',
      items: [
        { issue: 'PAN-1', lane: 'A' },
        { issue: 'PAN-2', lane: 'A', prereqs: ['PAN-1'] },
      ],
    }))).resolves.toMatchObject({ status: 200 });

    await expect(requestOrdersRoute(layer, `/api/orders/${bookId}/items/PAN-2`, mutation('PATCH', {
      lane: 'B',
      order: 1,
      prereqs: ['PAN-1', 'pan-3'],
      reVerify: true,
      planAtPickup: true,
    }))).resolves.toMatchObject({
      status: 200,
      body: { items: [
        { issue: 'PAN-1', lane: 'A', addedBy: 'authenticated-operator' },
        { issue: 'PAN-2', lane: 'B', prereqs: ['PAN-1', 'PAN-3'], reVerify: true, planAtPickup: true, addedBy: 'authenticated-operator' },
      ] },
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
        validation: {
          blocks: [{ code: 'issue-not-open', issue: 'PAN-1' }],
          warns: [{ code: 'missing-prd', issue: 'PAN-2' }],
        },
        itemReadiness: { 'PAN-1': { hasPrd: false }, 'PAN-2': { hasPrd: false } },
        prerequisiteTerminal: { 'PAN-1': true, 'PAN-3': false },
      },
    });

    await expect(requestOrdersRoute(layer, `/api/orders/${bookId}`, mutation('PATCH', {
      settings: { posture: 'drain', postureSetAt: 'spoofed', postureSetBy: 'spoofed' },
    }))).resolves.toMatchObject({ status: 400, body: { error: expect.stringContaining('server-controlled') } });

    await expect(requestOrdersRoute(layer, `/api/orders/${bookId}`, mutation('PATCH', {
      name: 'Renamed campaign',
      settings: { laneAConcurrency: 3, posture: 'drain', postureReason: 'Operator hold' },
      status: 'ready',
    }))).resolves.toMatchObject({
      status: 200,
      body: {
        name: 'Renamed campaign',
        status: 'ready',
        settings: {
          laneAConcurrency: 3,
          posture: 'drain',
          postureSetAt: at,
          postureSetBy: 'authenticated-operator',
        },
      },
    });

    await expect(requestOrdersRoute(layer, `/api/orders/${bookId}`, mutation('PATCH', {
      status: 'running',
      runId: 'RUN-SPOOFED',
    }))).resolves.toMatchObject({ status: 400, body: { error: expect.stringContaining('may only transition') } });

    await expect(requestOrdersRoute(layer, '/api/orders')).resolves.toMatchObject({
      status: 200,
      body: { books: [{ id: bookId, name: 'Renamed campaign' }] },
    });

    const preview = await requestOrdersRoute(layer, `/api/orders/${bookId}/preview-brief`);
    expect(preview.status).toBe(200);
    expect(preview.body['brief']).toContain('B1 PAN-2 — after PAN-1, PAN-3; re-verify PRD; plan at pickup');

    await expect(requestOrdersRoute(layer, `/api/orders/${bookId}/items/PAN-1`, mutation('DELETE')))
      .resolves.toMatchObject({ status: 200, body: { items: [{ issue: 'PAN-2', order: 1 }] } });
  });

  it('enriches the book list from one issue-state snapshot', async () => {
    const root = gitFixture();
    const lookup = vi.fn(() => new Map([
      ['PAN-1', { issue: 'PAN-1', open: true, parked: false }],
      ['PAN-2', { issue: 'PAN-2', open: true, parked: false }],
    ]));
    const layer = makeOrdersRouteLayer({ stateRoot: () => root, issueLookup: lookup, hasPrd: () => true });
    for (const [id, issue] of [['2026-07-18-one', 'PAN-1'], ['2026-07-18-two', 'PAN-2']] as const) {
      await requestOrdersRoute(layer, '/api/orders', mutation('POST', { id, name: id }));
      await requestOrdersRoute(layer, `/api/orders/${id}/items`, mutation('POST', { items: [{ issue, lane: 'A' }] }));
    }
    lookup.mockClear();

    await expect(requestOrdersRoute(layer, '/api/orders')).resolves.toMatchObject({
      status: 200,
      body: { books: [{ id: '2026-07-18-one' }, { id: '2026-07-18-two' }] },
    });
    expect(lookup).toHaveBeenCalledOnce();
    expect(lookup).toHaveBeenCalledWith(['PAN-1', 'PAN-2']);
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

  it('resolves ?project=<key> through the projects registry and stamps the envelope', async () => {
    const rootA = gitFixture();
    const rootB = gitFixture();
    const projectA = { path: '/fake/project-a' } as ProjectConfig;
    const projectB = { path: '/fake/project-b' } as ProjectConfig;
    mockGetProjectSync.mockImplementation((key: string) => {
      if (key === 'project-a') return projectA;
      if (key === 'project-b') return projectB;
      return null;
    });
    mockResolveStateReadHomeSync.mockImplementation((project: ProjectConfig) => ({
      root: project === projectA ? rootA : rootB,
      migrated: true,
    }));

    const layer = makeOrdersRouteLayer({ issueLookup: () => new Map() });
    await expect(requestOrdersRoute(layer, '/api/orders?project=project-a', mutation('POST', {
      id: '2026-07-18-book-a',
      name: 'Book A',
    }))).resolves.toMatchObject({ status: 200, body: { id: '2026-07-18-book-a' } });
    await expect(requestOrdersRoute(layer, '/api/orders?project=project-b', mutation('POST', {
      id: '2026-07-18-book-b',
      name: 'Book B',
    }))).resolves.toMatchObject({ status: 200, body: { id: '2026-07-18-book-b' } });

    await expect(requestOrdersRoute(layer, '/api/orders?project=project-a')).resolves.toMatchObject({
      status: 200,
      body: { project: 'project-a', books: [{ id: '2026-07-18-book-a' }] },
    });
    await expect(requestOrdersRoute(layer, '/api/orders?project=project-b')).resolves.toMatchObject({
      status: 200,
      body: { project: 'project-b', books: [{ id: '2026-07-18-book-b' }] },
    });
  });

  it('rejects an unknown ?project= key with 400 across GET and mutation routes', async () => {
    mockGetProjectSync.mockReturnValue(null);
    const layer = makeOrdersRouteLayer({ issueLookup: () => new Map() });

    await expect(requestOrdersRoute(layer, '/api/orders?project=ghost-project')).resolves.toMatchObject({
      status: 400,
      body: { error: expect.stringContaining('Unknown project: ghost-project') },
    });
    await expect(requestOrdersRoute(layer, '/api/orders?project=ghost-project', mutation('POST', {
      name: 'Should not be created',
    }))).resolves.toMatchObject({
      status: 400,
      body: { error: expect.stringContaining('Unknown project: ghost-project') },
    });
  });

  it('scans other registered projects when the book is missing from the default state root', async () => {
    const defaultRoot = gitFixture();
    const otherRoot = gitFixture();
    const defaultProject = { path: '/fake/default-project' } as ProjectConfig;
    const otherProject = { path: '/fake/other-project' } as ProjectConfig;

    mockFindProjectByPathSync.mockReturnValue(defaultProject);
    mockGetProjectSync.mockImplementation((key: string) => (key === 'other-project' ? otherProject : null));
    mockListProjectsSync.mockReturnValue([
      { key: 'default-project', config: defaultProject },
      { key: 'other-project', config: otherProject },
    ]);
    mockResolveStateReadHomeSync.mockImplementation((project: ProjectConfig) => ({
      root: project === defaultProject ? defaultRoot : otherRoot,
      migrated: true,
    }));

    const layer = makeOrdersRouteLayer({ issueLookup: () => new Map() });
    await requestOrdersRoute(layer, '/api/orders?project=other-project', mutation('POST', {
      id: '2026-07-18-scanned',
      name: 'Scanned book',
    }));

    await expect(requestOrdersRoute(layer, '/api/orders/2026-07-18-scanned')).resolves.toMatchObject({
      status: 200,
      body: { id: '2026-07-18-scanned', project: 'other-project' },
    });
  });

  it('returns the same 404 when the book exists in no registered project', async () => {
    const defaultRoot = gitFixture();
    const otherRoot = gitFixture();
    const defaultProject = { path: '/fake/default-project' } as ProjectConfig;
    const otherProject = { path: '/fake/other-project' } as ProjectConfig;

    mockFindProjectByPathSync.mockReturnValue(defaultProject);
    mockListProjectsSync.mockReturnValue([
      { key: 'default-project', config: defaultProject },
      { key: 'other-project', config: otherProject },
    ]);
    mockResolveStateReadHomeSync.mockImplementation((project: ProjectConfig) => ({
      root: project === defaultProject ? defaultRoot : otherRoot,
      migrated: true,
    }));

    const layer = makeOrdersRouteLayer({ issueLookup: () => new Map() });
    await expect(requestOrdersRoute(layer, '/api/orders/2026-07-18-nowhere')).resolves.toMatchObject({
      status: 404,
      body: { error: 'Order book not found: 2026-07-18-nowhere' },
    });
  });

  it('does not scan when ?project= is explicit — a missing book in that project 404s', async () => {
    const otherRoot = gitFixture();
    const otherProject = { path: '/fake/other-project' } as ProjectConfig;
    mockGetProjectSync.mockImplementation((key: string) => (key === 'other-project' ? otherProject : null));
    mockResolveStateReadHomeSync.mockReturnValue({ root: otherRoot, migrated: true });
    mockListProjectsSync.mockReturnValue([{ key: 'other-project', config: otherProject }]);

    const layer = makeOrdersRouteLayer({ issueLookup: () => new Map() });
    await expect(requestOrdersRoute(layer, '/api/orders/2026-07-18-nowhere?project=other-project'))
      .resolves.toMatchObject({ status: 404, body: { error: 'Order book not found: 2026-07-18-nowhere' } });
    expect(mockListProjectsSync).not.toHaveBeenCalled();
  });

  it('starts the Flywheel with cwd set to the non-default project\'s resolved path', async () => {
    const otherRoot = gitFixture();
    const otherProject = { path: '/fake/other-project' } as ProjectConfig;
    mockGetProjectSync.mockImplementation((key: string) => (key === 'other-project' ? otherProject : null));
    mockResolveStateReadHomeSync.mockReturnValue({ root: otherRoot, migrated: true });
    mockStartFlywheelRun.mockResolvedValue({ runId: 'RUN-OTHER' });

    const states = new Map<string, OrderIssueState>([['PAN-20', { issue: 'PAN-20', open: true, parked: false }]]);
    const layer = makeOrdersRouteLayer({ issueLookup: issueLookup(states) });
    await requestOrdersRoute(layer, '/api/orders?project=other-project', mutation('POST', {
      id: '2026-07-18-cross-start',
      name: 'Cross start',
    }));
    await requestOrdersRoute(layer, '/api/orders/2026-07-18-cross-start/items?project=other-project', mutation('POST', {
      items: [{ issue: 'PAN-20', lane: 'A' }],
    }));

    await expect(requestOrdersRoute(layer, '/api/orders/2026-07-18-cross-start/start?project=other-project', mutation('POST')))
      .resolves.toEqual({ status: 200, body: { ok: true, runId: 'RUN-OTHER', warnings: [] } });
    expect(mockStartFlywheelRun).toHaveBeenCalledWith({ cwd: '/fake/other-project', orders: '2026-07-18-cross-start' });
  });

  it('keeps starting from the server cwd when the book is in the default project', async () => {
    const defaultRoot = gitFixture();
    const defaultProject = { path: process.cwd() } as ProjectConfig;
    mockFindProjectByPathSync.mockReturnValue(defaultProject);
    mockListProjectsSync.mockReturnValue([{ key: 'default-project', config: defaultProject }]);
    mockResolveStateReadHomeSync.mockReturnValue({ root: defaultRoot, migrated: true });
    mockStartFlywheelRun.mockResolvedValue({ runId: 'RUN-DEFAULT' });

    const states = new Map<string, OrderIssueState>([['PAN-21', { issue: 'PAN-21', open: true, parked: false }]]);
    const layer = makeOrdersRouteLayer({ issueLookup: issueLookup(states) });
    await requestOrdersRoute(layer, '/api/orders', mutation('POST', {
      id: '2026-07-18-default-start',
      name: 'Default start',
    }));
    await requestOrdersRoute(layer, '/api/orders/2026-07-18-default-start/items', mutation('POST', {
      items: [{ issue: 'PAN-21', lane: 'A' }],
    }));

    await expect(requestOrdersRoute(layer, '/api/orders/2026-07-18-default-start/start', mutation('POST')))
      .resolves.toEqual({ status: 200, body: { ok: true, runId: 'RUN-DEFAULT', warnings: [] } });
    expect(mockStartFlywheelRun).toHaveBeenCalledWith({ cwd: process.cwd(), orders: '2026-07-18-default-start' });
  });
});

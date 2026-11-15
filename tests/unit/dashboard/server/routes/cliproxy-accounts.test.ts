/**
 * PAN-5278: GET /api/cliproxy/accounts serves the in-memory pool snapshot,
 * reads a fresh one on ?refresh=1 or when the cached one is missing or older
 * than 5 minutes, and never changes a priority.
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolSnapshot } from '../../../../../src/lib/cliproxy-pool.js';

const routing = vi.hoisted(() => ({
  getPoolSnapshot: vi.fn<() => PoolSnapshot | null>(),
  readPoolSnapshot: vi.fn<() => Promise<PoolSnapshot>>(),
  refreshPool: vi.fn<() => Promise<PoolSnapshot>>(),
  startCliproxyRoutingController: vi.fn(),
}));
const pool = vi.hoisted(() => ({
  setAccountPriority: vi.fn<(name: string, priority: number) => Promise<void>>(),
}));

vi.mock('../../../../../src/lib/cliproxy-routing.js', () => routing);
vi.mock('../../../../../src/lib/cliproxy-pool.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../src/lib/cliproxy-pool.js')>()),
  setAccountPriority: pool.setAccountPriority,
}));

const { cliproxyRouteLayer } = await import('../../../../../src/dashboard/server/routes/cliproxy.js');

const NOW = Date.parse('2026-11-14T12:00:00.000Z');

function snapshot(ageMs: number, label: string): PoolSnapshot {
  return {
    checkedAt: new Date(NOW - ageMs).toISOString(),
    managementAvailable: true,
    accounts: [{
      name: `${label}.json`,
      authIndex: label,
      provider: 'codex',
      email: null,
      plan: 'pro',
      disabled: false,
      priority: 10,
      windows: [],
      weeklyResetsAt: null,
      exhausted: false,
      error: null,
      usageRead: true,
    }],
  };
}

async function getAccounts(query = ''): Promise<{ status: number; body: PoolSnapshot }> {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost/api/cliproxy/accounts${query}`));
  const response = await Effect.runPromise(Effect.scoped(
    Effect.flatMap(HttpRouter.toHttpEffect(cliproxyRouteLayer), (app) =>
      Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
    ),
  ));
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) as PoolSnapshot };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  for (const mock of [...Object.values(routing), ...Object.values(pool)]) mock.mockReset();
  routing.readPoolSnapshot.mockResolvedValue(snapshot(0, 'fresh'));
});

afterEach(() => {
  // Every case: the route never writes a priority.
  expect(routing.refreshPool).not.toHaveBeenCalled();
  expect(pool.setAccountPriority).not.toHaveBeenCalled();
  vi.useRealTimers();
});

describe('GET /api/cliproxy/accounts', () => {
  it('serves the cached snapshot', async () => {
    const cached = snapshot(60_000, 'cached');
    routing.getPoolSnapshot.mockReturnValue(cached);

    const result = await getAccounts();

    expect(result).toEqual({ status: 200, body: cached });
    expect(routing.readPoolSnapshot).not.toHaveBeenCalled();
  });

  it('refresh=1 forces a read', async () => {
    routing.getPoolSnapshot.mockReturnValue(snapshot(60_000, 'cached'));

    const result = await getAccounts('?refresh=1');

    expect(routing.readPoolSnapshot).toHaveBeenCalledOnce();
    expect(result.body.accounts[0].name).toBe('fresh.json');
  });

  it('no snapshot yet triggers a read', async () => {
    routing.getPoolSnapshot.mockReturnValue(null);

    const result = await getAccounts();

    expect(routing.readPoolSnapshot).toHaveBeenCalledOnce();
    expect(result.body.accounts[0].name).toBe('fresh.json');
  });

  it('a snapshot older than 5 minutes triggers a read', async () => {
    routing.getPoolSnapshot.mockReturnValue(snapshot(5 * 60_000 + 1, 'stale'));

    const result = await getAccounts();

    expect(routing.readPoolSnapshot).toHaveBeenCalledOnce();
    expect(result.body.accounts[0].name).toBe('fresh.json');
  });

  it('the route never calls refreshPool or setAccountPriority', async () => {
    routing.getPoolSnapshot.mockReturnValue(null);

    await getAccounts('?refresh=1');
    await getAccounts();

    expect(routing.refreshPool).not.toHaveBeenCalled();
    expect(pool.setAccountPriority).not.toHaveBeenCalled();
  });
});

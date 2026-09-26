/**
 * PAN-4223 WI-5: the lanes routes are thin — origin check, body parse, the
 * lane core, the view reader. The core and views are mocked; the live
 * dashboard is never called.
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const launchMock = vi.fn();
const listMock = vi.fn();
const invalidateMock = vi.fn();
const getByNameMock = vi.fn();

vi.mock('../../../../lib/lanes/launch.js', () => ({ launchLane: (...args: unknown[]) => launchMock(...args) }));
vi.mock('../../../../lib/lanes/views.js', () => ({
  listLaneViews: (...args: unknown[]) => listMock(...args),
  invalidateLaneViews: () => invalidateMock(),
}));
vi.mock('../../../../lib/overdeck/conversations.js', () => ({
  LANE_ROLES: ['builder', 'critic', 'verifier', 'play', 'orchestrator'],
  getConversationByName: (...args: unknown[]) => getByNameMock(...args),
}));

const { lanesRouteLayer } = await import('../lanes.js');
const { LaneLaunchError } = await import('../../../../lib/lanes/types.js');

async function call(method: string, path: string, init: { body?: unknown; origin?: string | null } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.origin !== null) headers.Origin = init.origin ?? 'http://localhost:3011';
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }));
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(lanesRouteLayer),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
  )));
  const payload = (response as { body: { body?: Uint8Array } }).body;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '';
  return { status: (response as { status?: number }).status ?? 200, json: text ? JSON.parse(text) : null };
}

const BODY = { parent: 'root-1', run: 'hotel', key: '663', role: 'builder', brief: '# brief' };

beforeEach(() => {
  launchMock.mockReset();
  listMock.mockReset();
  invalidateMock.mockReset();
  getByNameMock.mockReset();
});

describe('lanes routes (PAN-4223 WI-5)', () => {
  it('answers 403 on a bad Origin for every route', async () => {
    const evil = 'https://evil.example';
    expect((await call('POST', '/api/lanes', { body: BODY, origin: evil })).status).toBe(403);
    expect((await call('GET', '/api/lanes', { origin: evil })).status).toBe(403);
    expect((await call('GET', '/api/lanes/lane-1', { origin: evil })).status).toBe(403);
    expect(launchMock).not.toHaveBeenCalled();
  });

  it('passes a LaneLaunchError status and message through', async () => {
    launchMock.mockRejectedValue(new LaneLaunchError(409, 'lane hotel/663 builder is live as conversation #7'));
    const res = await call('POST', '/api/lanes', { body: BODY });
    expect(res).toEqual({ status: 409, json: { error: 'lane hotel/663 builder is live as conversation #7' } });
  });

  it('returns 201 with the launch result and drops the view memo', async () => {
    const result = { conversation: { id: 9, name: 'lane-1' }, cwd: '/home/u/lanes/hotel-663', branch: 'hotel/663', iteration: 1, warnings: [] };
    launchMock.mockResolvedValue(result);
    const res = await call('POST', '/api/lanes', { body: { ...BODY, replace: true } });
    expect(res).toEqual({ status: 201, json: result });
    expect(launchMock).toHaveBeenCalledWith({ ...BODY, replace: true });
    expect(invalidateMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a body missing required fields or with wrong types', async () => {
    expect((await call('POST', '/api/lanes', { body: { ...BODY, brief: undefined } })).status).toBe(400);
    expect((await call('POST', '/api/lanes', { body: { ...BODY, reuse: 'yes' } })).status).toBe(400);
    expect(launchMock).not.toHaveBeenCalled();
  });

  it('lists lanes with the query filter as { generatedAt, lanes }', async () => {
    listMock.mockResolvedValue([{ name: 'lane-1' }]);
    const res = await call('GET', '/api/lanes?run=hotel&parent=conv-root-1&key=663');
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ generatedAt: expect.any(String), lanes: [{ name: 'lane-1' }] });
    expect(listMock).toHaveBeenCalledWith({ run: 'hotel', parentName: 'root-1', key: '663' });
  });

  it('returns one lane by name, and 404 for a name that is not a lane', async () => {
    getByNameMock.mockImplementation((name: string) => (name === 'lane-1'
      ? { name, gauntletRun: 'hotel', laneKey: '663', laneRole: 'builder' }
      : { name, gauntletRun: null, laneKey: null, laneRole: null }));
    listMock.mockResolvedValue([{ name: 'lane-1', activity: 'idle' }]);
    expect(await call('GET', '/api/lanes/conv-lane-1')).toEqual({ status: 200, json: { name: 'lane-1', activity: 'idle' } });
    expect(listMock).toHaveBeenCalledWith({ run: 'hotel', key: '663', role: 'builder' });
    expect((await call('GET', '/api/lanes/root-1')).status).toBe(404);
  });
});

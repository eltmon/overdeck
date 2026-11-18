/**
 * PAN-5540: the known-pack routes. The known-pack core is mocked; the routes stay admin-only for
 * remote credentials because they have no ROUTE_SCOPES row.
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listAvailablePacks: vi.fn(),
}));

vi.mock('../../../../lib/skill-packs/known.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../../lib/skill-packs/known.js')>()),
  listAvailablePacks: mocks.listAvailablePacks,
}));

import { requiredScopeFor } from '../../route-scopes.js';

const LISTING = {
  packs: [{
    id: 'remotion', url: 'https://github.com/eltmon/remotion-skills', ref: 'a'.repeat(40), adapter: 'plain',
    disclosure: null, added: false, dashboardAddable: true, reason: null,
    addCommand: 'pan skills pack add remotion', groups: ['video'],
  }],
  groups: [{
    name: 'video', packs: ['remotion', 'hyperframes', 'openmontage', 'video-use'], source: 'built-in',
    missing: ['remotion', 'hyperframes', 'openmontage', 'video-use'], unknown: [], dashboardAddable: true,
    addCommand: 'pan skills pack add --group video',
  }],
};

async function request(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const { skillPacksRouteLayer } = await import('../misc/skill-packs.js');
  const req = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, init));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(skillPacksRouteLayer), app =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, req),
      ),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listAvailablePacks.mockResolvedValue(LISTING);
});

describe('GET /api/skills/packs/available', () => {
  it('returns the known-pack listing', async () => {
    const res = await request('/api/skills/packs/available');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(LISTING);
    expect(mocks.listAvailablePacks).toHaveBeenCalledTimes(1);
  });

  it('answers 500 with the error message when the listing fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.listAvailablePacks.mockRejectedValue(new Error('config unreadable'));
    const res = await request('/api/skills/packs/available');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'config unreadable' });
  });

  it('requires admin scope for remote credentials', () => {
    expect(requiredScopeFor('GET', '/api/skills/packs/available')).toBe('admin');
  });
});

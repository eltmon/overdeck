/**
 * PAN-4400 WI-4: the model preset routes map the preset lib onto HTTP and
 * guard both POSTs with the dashboard mutation check (session + CSRF).
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _resetInternalTokenCacheForTests } from '../../../../../src/lib/internal-token.js';
import {
  DASHBOARD_CSRF_HEADER,
  DASHBOARD_SESSION_COOKIE,
  _resetDashboardSessionTokenForTests,
} from '../../../../../src/dashboard/server/routes/dashboard-auth.js';

const mocks = vi.hoisted(() => ({
  listPresetStatus: vi.fn(),
  planPresetApply: vi.fn(),
  applyPreset: vi.fn(),
  undoLastPresetApply: vi.fn(),
  refreshTtsRuntimeConfig: vi.fn(async () => undefined),
  syncTtsPlaybackWithConfig: vi.fn(async () => undefined),
}));

vi.mock('../../../../../src/lib/model-presets/apply.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../src/lib/model-presets/apply.js')>()),
  listPresetStatus: mocks.listPresetStatus,
  applyPreset: mocks.applyPreset,
  undoLastPresetApply: mocks.undoLastPresetApply,
}));

vi.mock('../../../../../src/lib/model-presets/plan.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../src/lib/model-presets/plan.js')>()),
  planPresetApply: mocks.planPresetApply,
}));

vi.mock('../../../../../src/dashboard/server/services/tts-runtime-config.js', () => ({
  refreshTtsRuntimeConfig: mocks.refreshTtsRuntimeConfig,
}));

vi.mock('../../../../../src/dashboard/server/services/tts-playback.js', () => ({
  syncTtsPlaybackWithConfig: mocks.syncTtsPlaybackWithConfig,
}));

const { modelPresetsRouteLayer } = await import('../../../../../src/dashboard/server/routes/model-presets.js');
const { PresetPlanStaleError, NoPresetUndoError } = await import('../../../../../src/lib/model-presets/apply.js');
const { UnknownPresetError } = await import('../../../../../src/lib/model-presets/plan.js');

const SESSION = 'test-session-token';
const CSRF = 'test-csrf-token';

async function call(
  method: 'GET' | 'POST',
  path: string,
  options: { body?: unknown; csrf?: boolean } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { cookie: `${DASHBOARD_SESSION_COOKIE}=${SESSION}` };
  if (method === 'POST') {
    headers['content-type'] = 'application/json';
    if (options.csrf !== false) headers[DASHBOARD_CSRF_HEADER] = CSRF;
  }
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, {
    method,
    headers,
    ...(method === 'POST' ? { body: JSON.stringify(options.body ?? {}) } : {}),
  }));
  const response = await Effect.runPromise(Effect.scoped(
    Effect.flatMap(HttpRouter.toHttpEffect(modelPresetsRouteLayer), (app) =>
      Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
    ),
  ));
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
}

beforeEach(() => {
  process.env.OVERDECK_INTERNAL_TOKEN = 'test-internal-token';
  process.env.OVERDECK_DASHBOARD_SESSION_TOKEN = SESSION;
  process.env.OVERDECK_DASHBOARD_CSRF_TOKEN = CSRF;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  for (const mock of Object.values(mocks)) mock.mockReset();
});

afterEach(() => {
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  delete process.env.OVERDECK_DASHBOARD_SESSION_TOKEN;
  delete process.env.OVERDECK_DASHBOARD_CSRF_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
});

describe('model preset routes', () => {
  it('GET /api/model-presets returns the preset status list', async () => {
    mocks.listPresetStatus.mockResolvedValue({ presets: [{ id: 'anthropic' }], undoAvailable: false });
    const result = await call('GET', '/api/model-presets');
    expect(result).toEqual({ status: 200, body: { presets: [{ id: 'anthropic' }], undoAvailable: false } });
  });

  it('GET /api/model-presets/:id/plan returns the plan JSON', async () => {
    const plan = { presetId: 'anthropic', rows: [], notes: [], digest: 'abc' };
    mocks.planPresetApply.mockResolvedValue(plan);
    const result = await call('GET', '/api/model-presets/anthropic/plan');
    expect(result).toEqual({ status: 200, body: plan });
    expect(mocks.planPresetApply).toHaveBeenCalledWith('anthropic');
  });

  it('GET /api/model-presets/:id/plan returns 404 for an unknown preset', async () => {
    mocks.planPresetApply.mockRejectedValue(new UnknownPresetError('nope'));
    const result = await call('GET', '/api/model-presets/nope/plan');
    expect(result.status).toBe(404);
    expect(result.body.code).toBe('unknown-preset');
  });

  it('POST apply without the CSRF header returns 403 and never applies', async () => {
    const result = await call('POST', '/api/model-presets/anthropic/apply', { body: { expectedDigest: 'abc' }, csrf: false });
    expect(result.status).toBe(403);
    expect(mocks.applyPreset).not.toHaveBeenCalled();
  });

  it('POST undo without the CSRF header returns 403', async () => {
    const result = await call('POST', '/api/model-presets/undo', { csrf: false });
    expect(result.status).toBe(403);
    expect(mocks.undoLastPresetApply).not.toHaveBeenCalled();
  });

  it('POST apply requires expectedDigest', async () => {
    const result = await call('POST', '/api/model-presets/anthropic/apply', { body: {} });
    expect(result.status).toBe(400);
    expect(mocks.applyPreset).not.toHaveBeenCalled();
  });

  it('POST apply applies with the digest and refreshes the TTS runtime', async () => {
    mocks.applyPreset.mockResolvedValue({ applied: [], skipped: [] });
    const result = await call('POST', '/api/model-presets/anthropic/apply', { body: { expectedDigest: 'abc' } });
    expect(result).toEqual({ status: 200, body: { applied: [], skipped: [] } });
    expect(mocks.applyPreset).toHaveBeenCalledWith('anthropic', { expectedDigest: 'abc' });
    expect(mocks.refreshTtsRuntimeConfig).toHaveBeenCalled();
    expect(mocks.syncTtsPlaybackWithConfig).toHaveBeenCalled();
  });

  it('POST apply with a stale digest returns 409', async () => {
    mocks.applyPreset.mockRejectedValue(new PresetPlanStaleError());
    const result = await call('POST', '/api/model-presets/anthropic/apply', { body: { expectedDigest: 'old' } });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('preset-plan-stale');
  });

  it('POST undo returns the restore report, or 409 with nothing to undo', async () => {
    mocks.undoLastPresetApply.mockResolvedValueOnce({ restored: ['workhorses.mid'], leftAsIs: [] });
    expect(await call('POST', '/api/model-presets/undo')).toEqual({ status: 200, body: { restored: ['workhorses.mid'], leftAsIs: [] } });

    mocks.undoLastPresetApply.mockRejectedValueOnce(new NoPresetUndoError());
    const empty = await call('POST', '/api/model-presets/undo');
    expect(empty.status).toBe(409);
    expect(empty.body.code).toBe('no-preset-undo');
  });
});

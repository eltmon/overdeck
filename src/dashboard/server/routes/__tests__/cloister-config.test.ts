import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadCloisterConfigSync: vi.fn(() => ({ startup: { auto_start: true } })),
  saveCloisterConfigSync: vi.fn(),
  reloadDurableCloisterConfig: vi.fn(() => ({ accepted: true as const })),
}));

vi.mock('../../../../lib/cloister/config.js', () => ({
  loadCloisterConfigSync: mocks.loadCloisterConfigSync,
  saveCloisterConfigSync: mocks.saveCloisterConfigSync,
}));

vi.mock('../../services/cloister-control-surface.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/cloister-control-surface.js')>()),
  reloadDurableCloisterConfig: mocks.reloadDurableCloisterConfig,
}));

interface RouteResult {
  status: number;
  body: unknown;
}

async function requestCloisterRoute(path: string, init: RequestInit = {}): Promise<RouteResult> {
  const { cloisterRouteLayer } = await import('../cloister.js');
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, init));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(cloisterRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
      ),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) };
}

describe('cloister config route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reloadDurableCloisterConfig.mockReturnValue({ accepted: true });
  });

  it('reloads the live child Cloister after saving config updates', async () => {
    const updates = { monitoring: { check_interval: 17 } };

    const result = await requestCloisterRoute('/api/cloister/config', {
      method: 'PUT',
      body: JSON.stringify(updates),
    });

    expect(result).toEqual({
      status: 200,
      body: { success: true, config: updates, reloaded: true },
    });
    expect(mocks.saveCloisterConfigSync).toHaveBeenCalledWith(updates);
    expect(mocks.reloadDurableCloisterConfig).toHaveBeenCalled();
  });
});

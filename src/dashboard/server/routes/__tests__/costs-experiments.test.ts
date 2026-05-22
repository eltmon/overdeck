/**
 * Tests for GET /api/costs/experiments route handler logic (PAN-611)
 *
 * Tests the handler logic directly using the same Effect.try pattern as the route.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Effect } from 'effect';
import { HttpServerResponse as HttpServerResponseModule } from 'effect/unstable/http';
import { httpHandler } from '../http-handler.js';
import { jsonResponse } from '../../http-helpers.js';

type HttpServerResponse = HttpServerResponseModule.HttpServerResponse;

// Mock getCavemanExperimentData so tests don't require a real DB
vi.mock('../../../../lib/database/cost-events-db.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/database/cost-events-db.js')>();
  return { ...actual, getCavemanExperimentData: vi.fn() };
});

import { getCavemanExperimentData } from '../../../../lib/database/cost-events-db.js';

const mockGetExperimentData = vi.mocked(getCavemanExperimentData);

/** Run an Effect route handler and extract status + JSON body */
async function runRoute(
  effect: Effect.Effect<HttpServerResponse, unknown, never>
): Promise<{ status: number; body: unknown }> {
  const response = await Effect.runPromise(httpHandler(effect));
  const rawBody = response.body as { body: Uint8Array } | null;
  const text = rawBody?.body ? new TextDecoder().decode(rawBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) };
}

/** Replicate the exact handler logic from costs.ts for testability */
function makeExperimentsHandler() {
  return httpHandler(Effect.try({
    try: () => jsonResponse({ experiments: getCavemanExperimentData() }),
    catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
  }));
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/costs/experiments handler', () => {
  it('returns 200 with empty experiments array when no data', async () => {
    mockGetExperimentData.mockReturnValue([]);

    const { status, body } = await runRoute((await Effect.runPromise(makeExperimentsHandler())));
    expect(status).toBe(200);
    expect((body as { experiments: unknown[] }).experiments).toEqual([]);
  });

  it('returns experiment rows from getCavemanExperimentData', async () => {
    const rows = [
      { variant: 'enabled', eventCount: 5, avgOutputTokens: 400, totalOutputTokens: 2000, avgInputTokens: 800, avgCost: 0.01, totalCost: 0.05 },
      { variant: 'disabled', eventCount: 3, avgOutputTokens: 600, totalOutputTokens: 1800, avgInputTokens: 900, avgCost: 0.015, totalCost: 0.045 },
    ];
    mockGetExperimentData.mockReturnValue(rows);

    const { status, body } = await runRoute((await Effect.runPromise(makeExperimentsHandler())));
    expect(status).toBe(200);
    const result = body as { experiments: typeof rows };
    expect(result.experiments).toHaveLength(2);
    expect(result.experiments[0].variant).toBe('enabled');
    expect(result.experiments[1].variant).toBe('disabled');
  });

  it('returns 500 when getCavemanExperimentData throws', async () => {
    mockGetExperimentData.mockImplementation(() => { throw new Error('DB failure'); });

    const { status } = await runRoute((await Effect.runPromise(makeExperimentsHandler())));
    expect(status).toBe(500);
  });
});

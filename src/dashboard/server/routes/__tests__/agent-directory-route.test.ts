/** PAN-3920 W4 / PAN-4197 — `?windowHours=` and `?scope=` handling for GET /api/agent-directory. */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../services/agent-directory.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/agent-directory.js')>()),
  getAgentDirectory: vi.fn(async (windowHours: number) => ({ generatedAt: 'g', windowHours, scope: 'window', entries: [] })),
  getLiveAgentDirectory: vi.fn(async () => ({ generatedAt: 'g', windowHours: 0, scope: 'live', entries: [] })),
}));

import { getAgentDirectory, getLiveAgentDirectory } from '../../services/agent-directory.js';
import { agentDirectoryRouteLayer, parseDirectoryScope, parseWindowHours, SCOPE_ERROR } from '../agent-directory.js';

async function getDirectory(query: string) {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost/api/agent-directory${query}`));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(agentDirectoryRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)
      ),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
}

describe('parseWindowHours', () => {
  it('defaults to 24 hours', () => {
    expect(parseWindowHours(null)).toBe(24);
  });

  it('accepts integers from 1 to 168', () => {
    expect(parseWindowHours('1')).toBe(1);
    expect(parseWindowHours('168')).toBe(168);
  });

  it('rejects zero, out-of-range, fractional and non-numeric values', () => {
    expect(parseWindowHours('0')).toBeNull();
    expect(parseWindowHours('169')).toBeNull();
    expect(parseWindowHours('1.5')).toBeNull();
    expect(parseWindowHours('-1')).toBeNull();
    expect(parseWindowHours('abc')).toBeNull();
    expect(parseWindowHours('')).toBeNull();
  });
});

describe('parseDirectoryScope', () => {
  it('reads no scope as the window answer, live as live, and anything else as invalid', () => {
    expect(parseDirectoryScope(null)).toBe('window');
    expect(parseDirectoryScope('live')).toBe('live');
    expect(parseDirectoryScope('window')).toBeNull();
    expect(parseDirectoryScope('')).toBeNull();
  });
});

describe('GET /api/agent-directory', () => {
  it('answers ?scope=live from the live scope and ignores windowHours', async () => {
    const result = await getDirectory('?scope=live&windowHours=bogus');
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ scope: 'live', windowHours: 0 });
    expect(getLiveAgentDirectory).toHaveBeenCalled();
  });

  it('rejects any other scope with 400', async () => {
    const result = await getDirectory('?scope=bogus');
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: SCOPE_ERROR });
  });

  it('answers the window with no scope', async () => {
    const result = await getDirectory('?windowHours=168');
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ scope: 'window', windowHours: 168 });
    expect(getAgentDirectory).toHaveBeenCalledWith(168);
  });
});

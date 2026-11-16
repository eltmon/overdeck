import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

const { mockReadSemgrepSettings, mockSaveSemgrepSettings } = vi.hoisted(() => ({
  mockReadSemgrepSettings: vi.fn(),
  mockSaveSemgrepSettings: vi.fn(),
}));

vi.mock('../../../../lib/semgrep/settings.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/semgrep/settings.js')>()),
  readSemgrepSettings: mockReadSemgrepSettings,
  saveSemgrepSettings: mockSaveSemgrepSettings,
}));

import { semgrepRouteLayer } from '../semgrep.js';
import { SemgrepSettingsValidationError } from '../../../../lib/semgrep/settings.js';
import { INTERNAL_TOKEN_HEADER, _resetInternalTokenCacheForTests } from '../../../../lib/internal-token.js';
import { _resetDashboardSessionTokenForTests } from '../dashboard-auth.js';
import { _resetTrustedOriginsForTests } from '../origin-validation.js';
import { getOverdeckHome } from '../../../../lib/paths.js';

const AUTHED = { [INTERNAL_TOKEN_HEADER]: 'test-token' };

async function callRoute(method: string, body?: unknown, headers: Record<string, string> = AUTHED) {
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const request = HttpServerRequest.fromWeb(new Request('http://localhost/api/semgrep/settings', init));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(semgrepRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
}

function resetAuth() {
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetTrustedOriginsForTests();
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OVERDECK_INTERNAL_TOKEN = 'test-token';
  delete process.env.OVERDECK_TRUSTED_ORIGINS;
  rmSync(join(getOverdeckHome(), 'internal-token'), { force: true });
  resetAuth();
});

afterEach(() => {
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  delete process.env.OVERDECK_DASHBOARD_SESSION_TOKEN;
  delete process.env.OVERDECK_DASHBOARD_CSRF_TOKEN;
  delete process.env.OVERDECK_TRUSTED_ORIGINS;
  resetAuth();
});

const VIEW = {
  enabled: true,
  mcp: false,
  edit_hook: false,
  gate: 'advisory' as const,
  severity: 'ERROR' as const,
  configs: ['p/default'],
  timeout_seconds: 300,
  pinnedVersion: '1.180.0',
};

describe('GET /api/semgrep/settings', () => {
  it('returns the settings view', async () => {
    mockReadSemgrepSettings.mockResolvedValue(VIEW);
    const res = await callRoute('GET');
    expect(res).toEqual({ status: 200, body: VIEW });
  });

  it('answers 422 when the block is invalid', async () => {
    mockReadSemgrepSettings.mockRejectedValue(new SemgrepSettingsValidationError('x'));
    const res = await callRoute('GET');
    expect(res).toEqual({ status: 422, body: { error: 'x' } });
  });
});

describe('PUT /api/semgrep/settings', () => {
  it('is refused without credentials', async () => {
    const res = await callRoute('PUT', { enabled: true }, {});
    expect(res.status).toBe(401);
    expect(mockSaveSemgrepSettings).not.toHaveBeenCalled();
  });

  it('maps a validation error to 400', async () => {
    mockSaveSemgrepSettings.mockRejectedValue(new SemgrepSettingsValidationError('bad value'));
    const res = await callRoute('PUT', { gate: 'strict' });
    expect(res).toEqual({ status: 400, body: { error: 'bad value' } });
  });

  it('returns the saved view', async () => {
    mockSaveSemgrepSettings.mockResolvedValue(VIEW);
    const res = await callRoute('PUT', { enabled: true });
    expect(res).toEqual({ status: 200, body: VIEW });
    expect(mockSaveSemgrepSettings).toHaveBeenCalledWith({ enabled: true });
  });
});

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

const { mockInstallTool } = vi.hoisted(() => ({ mockInstallTool: vi.fn() }));

vi.mock('../../../../lib/prereqs/registry.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/prereqs/registry.js')>()),
  installTool: mockInstallTool,
}));

import { prereqsRouteLayer } from '../prereqs.js';
import { INTERNAL_TOKEN_HEADER, _resetInternalTokenCacheForTests } from '../../../../lib/internal-token.js';
import { _resetDashboardSessionTokenForTests } from '../dashboard-auth.js';
import { _resetTrustedOriginsForTests } from '../origin-validation.js';
import { getOverdeckHome } from '../../../../lib/paths.js';

const AUTHED = { [INTERNAL_TOKEN_HEADER]: 'test-token' };

async function callInstall(headers: Record<string, string>, body?: unknown, contentType = 'application/json') {
  const init: RequestInit = { method: 'POST', headers: { 'Content-Type': contentType, ...headers } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const request = HttpServerRequest.fromWeb(new Request('http://localhost/api/prereqs/install', init));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(prereqsRouteLayer), (app) =>
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

describe('POST /api/prereqs/install (PAN-4594 D13)', () => {
  it('refuses an unauthenticated install', async () => {
    const res = await callInstall({}, { tool: 'semgrep' });
    expect(res.status).toBe(401);
    expect(mockInstallTool).not.toHaveBeenCalled();
  });

  it('refuses a non-JSON body', async () => {
    const res = await callInstall(AUTHED, { tool: 'semgrep' }, 'text/plain');
    expect(res.status).toBe(400);
    expect(mockInstallTool).not.toHaveBeenCalled();
  });

  it('installs with credentials', async () => {
    mockInstallTool.mockResolvedValue({ tool: 'semgrep', success: true, message: 'installed' });
    const res = await callInstall(AUTHED, { tool: 'semgrep' });
    expect(res).toEqual({ status: 200, body: { tool: 'semgrep', success: true, message: 'installed' } });
    expect(mockInstallTool).toHaveBeenCalledWith('semgrep');
  });
});

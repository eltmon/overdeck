import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

const { mockBuildStatus, mockRunSetup, mockSaveSettings, mockRunRelease } = vi.hoisted(() => ({
  mockBuildStatus: vi.fn(),
  mockRunSetup: vi.fn(),
  mockSaveSettings: vi.fn(),
  mockRunRelease: vi.fn(),
}));

vi.mock('../../../../lib/computer-use/status.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/computer-use/status.js')>()),
  buildStatus: mockBuildStatus,
}));
vi.mock('../../../../lib/computer-use/setup.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/computer-use/setup.js')>()),
  runSetup: mockRunSetup,
}));
vi.mock('../../../../lib/computer-use/settings.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/computer-use/settings.js')>()),
  saveComputerUseSettings: mockSaveSettings,
}));
vi.mock('../../../../lib/computer-use/run.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/computer-use/run.js')>()),
  runRelease: mockRunRelease,
}));

import { computerUseRouteLayer } from '../computer-use.js';
import { requiredScopeFor } from '../../route-scopes.js';
import {
  ComputerUseConfigSyntaxError,
  ComputerUseSettingsValidationError,
} from '../../../../lib/computer-use/settings.js';
import { SetupInProgressError } from '../../../../lib/computer-use/setup.js';
import { INTERNAL_TOKEN_HEADER, _resetInternalTokenCacheForTests } from '../../../../lib/internal-token.js';
import { _resetDashboardSessionTokenForTests, DASHBOARD_SESSION_COOKIE } from '../dashboard-auth.js';
import { _resetTrustedOriginsForTests } from '../origin-validation.js';
import { getOverdeckHome } from '../../../../lib/paths.js';

const AUTHED = { [INTERNAL_TOKEN_HEADER]: 'test-token' };

async function callRoute(method: string, path: string, body?: unknown, headers: Record<string, string> = AUTHED) {
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, init));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(computerUseRouteLayer), (app) =>
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

const STATUS = {
  platform: 'linux',
  supported: true,
  enabled: false,
  hostname: 'desk',
  session: { ok: true, label: 'x11 · display :1' },
  checks: [],
  setupSteps: [{ id: 'enable-flag', label: 'Turn on Computer Use' }],
  lease: null,
  skill: { installed: true, locations: ['~/.claude/skills'] },
};

describe('GET /api/computer-use/status (PAN-5461)', () => {
  it('returns the status view, probing the helper only if the lock is free', async () => {
    mockBuildStatus.mockResolvedValue(STATUS);
    const res = await callRoute('GET', '/api/computer-use/status');
    expect(res).toEqual({ status: 200, body: STATUS });
    expect(mockBuildStatus).toHaveBeenCalledWith({ probeHelper: 'if-free' });
  });

  it('answers 422 on a config.yaml syntax error', async () => {
    mockBuildStatus.mockRejectedValue(new ComputerUseConfigSyntaxError('bad yaml'));
    const res = await callRoute('GET', '/api/computer-use/status');
    expect(res).toEqual({ status: 422, body: { error: 'bad yaml' } });
  });
});

describe('PUT /api/computer-use/settings (PAN-5461)', () => {
  it('saves the flag and returns the new status', async () => {
    mockSaveSettings.mockResolvedValue({ enabled: true });
    mockBuildStatus.mockResolvedValue({ ...STATUS, enabled: true, setupSteps: [] });
    const res = await callRoute('PUT', '/api/computer-use/settings', { enabled: true });
    expect(mockSaveSettings).toHaveBeenCalledWith({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
  });

  it('maps a validation error to 400', async () => {
    mockSaveSettings.mockImplementation(() => {
      throw new ComputerUseSettingsValidationError('enabled must be a boolean');
    });
    const res = await callRoute('PUT', '/api/computer-use/settings', { enabled: 'yes' });
    expect(res).toEqual({ status: 400, body: { error: 'enabled must be a boolean' } });
  });

  it('maps a YAML syntax error to 422', async () => {
    mockSaveSettings.mockRejectedValue(new ComputerUseConfigSyntaxError('syntax'));
    const res = await callRoute('PUT', '/api/computer-use/settings', { enabled: true });
    expect(res).toEqual({ status: 422, body: { error: 'syntax' } });
  });

  it('is refused without credentials', async () => {
    const res = await callRoute('PUT', '/api/computer-use/settings', { enabled: true }, {});
    expect(res.status).toBe(401);
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it('rejects a cross-site origin through the mutation guard', async () => {
    process.env.OVERDECK_DASHBOARD_SESSION_TOKEN = 'session-token';
    resetAuth();
    const res = await callRoute('PUT', '/api/computer-use/settings', { enabled: true }, {
      Cookie: `${DASHBOARD_SESSION_COOKIE}=session-token`,
      Origin: 'https://evil.example',
    });
    expect(res).toEqual({ status: 403, body: { error: 'Invalid origin' } });
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });
});

describe('POST /api/computer-use/setup (PAN-5461)', () => {
  it('returns the setup result', async () => {
    const result = { ok: true, steps: [], status: STATUS };
    mockRunSetup.mockResolvedValue(result);
    const res = await callRoute('POST', '/api/computer-use/setup');
    expect(res).toEqual({ status: 200, body: result });
  });

  it('answers 409 while a setup is already running', async () => {
    mockRunSetup.mockRejectedValue(new SetupInProgressError());
    const res = await callRoute('POST', '/api/computer-use/setup');
    expect(res).toEqual({ status: 409, body: { error: 'Setup is already running' } });
  });

  it('never passes request body content to setup', async () => {
    mockRunSetup.mockResolvedValue({ ok: true, steps: [], status: STATUS });
    await callRoute('POST', '/api/computer-use/setup', { packages: ['evil'], command: 'rm -rf /' });
    expect(mockRunSetup).toHaveBeenCalledWith();
  });

  it('is refused without credentials', async () => {
    const res = await callRoute('POST', '/api/computer-use/setup', undefined, {});
    expect(res.status).toBe(401);
    expect(mockRunSetup).not.toHaveBeenCalled();
  });
});

describe('POST /api/computer-use/release (PAN-5461)', () => {
  it('force-releases the lease and returns the status', async () => {
    mockRunRelease.mockResolvedValue(undefined);
    mockBuildStatus.mockResolvedValue(STATUS);
    const res = await callRoute('POST', '/api/computer-use/release');
    expect(mockRunRelease).toHaveBeenCalledWith({ force: true });
    expect(res).toEqual({ status: 200, body: STATUS });
  });
});

describe('computer-use route scopes (PAN-5461 D-8)', () => {
  it.each([
    ['GET', '/api/computer-use/status'],
    ['POST', '/api/computer-use/setup'],
    ['PUT', '/api/computer-use/settings'],
    ['POST', '/api/computer-use/release'],
  ])('%s %s is admin-only', (method, path) => {
    expect(requiredScopeFor(method, path)).toBe('admin');
  });
});

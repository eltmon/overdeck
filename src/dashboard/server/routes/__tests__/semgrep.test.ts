import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

const { mockReadSemgrepSettings, mockSaveSemgrepSettings, mockGetProject, mockSetProjectSastOverride, mockLoadConfigNoMigration } = vi.hoisted(() => ({
  mockReadSemgrepSettings: vi.fn(),
  mockSaveSemgrepSettings: vi.fn(),
  mockGetProject: vi.fn(),
  mockSetProjectSastOverride: vi.fn(),
  mockLoadConfigNoMigration: vi.fn(),
}));

vi.mock('../../../../lib/semgrep/settings.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/semgrep/settings.js')>()),
  readSemgrepSettings: mockReadSemgrepSettings,
  saveSemgrepSettings: mockSaveSemgrepSettings,
}));
vi.mock('../../../../lib/projects.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/projects.js')>()),
  getProject: mockGetProject,
}));
vi.mock('../../../../lib/semgrep/project-override.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/semgrep/project-override.js')>()),
  setProjectSastOverride: mockSetProjectSastOverride,
}));
vi.mock('../../../../lib/config-yaml/load.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/config-yaml/load.js')>()),
  loadConfigNoMigration: mockLoadConfigNoMigration,
}));

import { semgrepRouteLayer } from '../semgrep.js';
import { SemgrepSettingsValidationError } from '../../../../lib/semgrep/settings.js';
import { INTERNAL_TOKEN_HEADER, _resetInternalTokenCacheForTests } from '../../../../lib/internal-token.js';
import { _resetDashboardSessionTokenForTests } from '../dashboard-auth.js';
import { _resetTrustedOriginsForTests } from '../origin-validation.js';
import { getOverdeckHome } from '../../../../lib/paths.js';

const AUTHED = { [INTERNAL_TOKEN_HEADER]: 'test-token' };

async function callRoute(
  method: string,
  body?: unknown,
  headers: Record<string, string> = AUTHED,
  path = '/api/semgrep/settings',
) {
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, init));
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

const PROJECT = { name: 'overdeck', path: '/repo' };
const SEMGREP_CONFIG = { enabled: true, mcp: false, edit_hook: false, gate: 'advisory' as const, severity: 'ERROR' as const, configs: ['p/default'], timeout_seconds: 300 };

async function callProjectSast(method: string, body?: unknown, headers?: Record<string, string>) {
  return callRoute(method, body, headers, '/api/projects/overdeck/sast');
}

describe('GET /api/projects/:projectKey/sast', () => {
  it('404s an unknown project', async () => {
    mockGetProject.mockReturnValue(Effect.succeed(null));
    const res = await callProjectSast('GET');
    expect(res).toEqual({ status: 404, body: { error: 'Project not found' } });
  });

  it('returns value, effective and reason', async () => {
    mockGetProject.mockReturnValue(Effect.succeed({ ...PROJECT, verification: { sast: 'blocking' as const } }));
    mockLoadConfigNoMigration.mockResolvedValue({ config: { security: { semgrep: SEMGREP_CONFIG } } });
    const res = await callProjectSast('GET');
    expect(res).toEqual({
      status: 200,
      body: { value: 'blocking', effective: 'blocking', reason: 'verification.sast: blocking in projects.yaml', semgrepEnabled: true },
    });
  });

  it('answers 422 when the global security block is invalid', async () => {
    mockGetProject.mockReturnValue(Effect.succeed(PROJECT));
    mockLoadConfigNoMigration.mockRejectedValue(new Error('config.yaml: security.semgrep.gate must be one of off, advisory, blocking'));
    const res = await callProjectSast('GET');
    expect(res).toEqual({ status: 422, body: { error: 'config.yaml: security.semgrep.gate must be one of off, advisory, blocking' } });
  });
});

describe('POST /api/projects/:projectKey/sast', () => {
  beforeEach(() => {
    mockGetProject.mockReturnValue(Effect.succeed(PROJECT));
    mockLoadConfigNoMigration.mockResolvedValue({ config: { security: { semgrep: SEMGREP_CONFIG } } });
  });

  it('rejects an invalid value with 400', async () => {
    const res = await callProjectSast('POST', { value: 'strict' });
    expect(res).toEqual({ status: 400, body: { error: "value must be 'off', 'advisory', 'blocking', or null" } });
    expect(mockSetProjectSastOverride).not.toHaveBeenCalled();
  });

  it('calls the setter with null and returns the view', async () => {
    mockSetProjectSastOverride.mockResolvedValue(undefined);
    const res = await callProjectSast('POST', { value: null });
    expect(mockSetProjectSastOverride).toHaveBeenCalledWith('overdeck', null);
    expect(res).toEqual({
      status: 200,
      body: { value: null, effective: 'advisory', reason: 'security.semgrep.gate: advisory', semgrepEnabled: true },
    });
  });

  it('is refused without credentials', async () => {
    const res = await callProjectSast('POST', { value: 'blocking' }, {});
    expect(res.status).toBe(401);
    expect(mockSetProjectSastOverride).not.toHaveBeenCalled();
  });

  it('rejects a literal null body with 400, not 500', async () => {
    const res = await callProjectSast('POST', null);
    expect(res).toEqual({ status: 400, body: { error: "value must be 'off', 'advisory', 'blocking', or null" } });
    expect(mockSetProjectSastOverride).not.toHaveBeenCalled();
  });

  it('answers 422 when the global security block is invalid, without writing the override', async () => {
    mockSetProjectSastOverride.mockResolvedValue(undefined);
    mockLoadConfigNoMigration.mockRejectedValue(new Error('config.yaml: security.semgrep.gate must be one of off, advisory, blocking'));
    const res = await callProjectSast('POST', { value: 'blocking' });
    expect(res).toEqual({ status: 422, body: { error: 'config.yaml: security.semgrep.gate must be one of off, advisory, blocking' } });
    expect(mockSetProjectSastOverride).not.toHaveBeenCalled();
  });
});

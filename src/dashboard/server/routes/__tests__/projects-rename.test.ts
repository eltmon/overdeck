import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { TEST_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require('node:path') as typeof import('node:path');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tmpdir } = require('node:os') as typeof import('node:os');
  return { TEST_HOME: join(tmpdir(), `projects-rename-route-test-${process.pid}`) };
});

vi.mock('../../../../lib/paths.js', async () => {
  const real = await vi.importActual<typeof import('../../../../lib/paths.js')>('../../../../lib/paths.js');
  return {
    ...real,
    OVERDECK_HOME: TEST_HOME,
    CONFIG_DIR: TEST_HOME,
  };
});

import {
  getProjectSync,
  PROJECTS_CONFIG_FILE,
  registerProjectSync,
} from '../../../../lib/projects.js';
import {
  _resetInternalTokenCacheForTests,
  INTERNAL_TOKEN_HEADER,
} from '../../../../lib/internal-token.js';

interface RouteResult {
  status: number;
  body: unknown;
}

const INTERNAL_TOKEN = 'projects-rename-test-token';

async function requestProjectRename(
  projectKey: string,
  body: unknown,
  options: { authorized?: boolean } = {},
): Promise<RouteResult> {
  const { projectsRouteLayer } = await import('../projects.js');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.authorized !== false) headers[INTERNAL_TOKEN_HEADER] = INTERNAL_TOKEN;

  const request = HttpServerRequest.fromWeb(new Request(
    `http://localhost/api/projects/${encodeURIComponent(projectKey)}/rename`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    },
  ));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(projectsRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
      ),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) };
}

beforeEach(() => {
  process.env['OVERDECK_INTERNAL_TOKEN'] = INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  mkdirSync(TEST_HOME, { recursive: true });
  rmSync(PROJECTS_CONFIG_FILE, { force: true });
  registerProjectSync('alpha', { name: 'Alpha Project', path: '/projects/alpha' });
  registerProjectSync('beta', { name: 'Beta Project', path: '/projects/beta' });
});

afterEach(() => {
  delete process.env['OVERDECK_INTERNAL_TOKEN'];
  _resetInternalTokenCacheForTests();
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('POST /api/projects/:projectKey/rename', () => {
  it('renames a project resolved by registration key', async () => {
    const result = await requestProjectRename('alpha', { name: '  Renamed Alpha  ' });

    expect(result).toEqual({
      status: 200,
      body: { key: 'alpha', name: 'Renamed Alpha' },
    });
    expect(getProjectSync('alpha')?.name).toBe('Renamed Alpha');
  });

  it('renames a project resolved by its current display name', async () => {
    const result = await requestProjectRename('Alpha Project', { name: 'New Alpha' });

    expect(result).toEqual({
      status: 200,
      body: { key: 'alpha', name: 'New Alpha' },
    });
    expect(getProjectSync('alpha')?.name).toBe('New Alpha');
  });

  it('returns 404 for an unknown project', async () => {
    await expect(requestProjectRename('missing', { name: 'New Name' })).resolves.toEqual({
      status: 404,
      body: { error: 'Project not found' },
    });
  });

  it.each([
    [{ name: '   ' }, 'Project name must not be empty'],
    [{ name: 42 }, 'Project name must be a string'],
  ])('returns 400 for an invalid name', async (body, error) => {
    await expect(requestProjectRename('alpha', body)).resolves.toEqual({
      status: 400,
      body: { error },
    });
  });

  it.each([
    ['beta', "Project name 'beta' conflicts with existing project 'beta'"],
    ['beta project', "Project name 'beta project' conflicts with existing project 'beta'"],
  ])('returns 409 when the name conflicts with another project', async (name, error) => {
    await expect(requestProjectRename('alpha', { name })).resolves.toEqual({
      status: 409,
      body: { error },
    });
    expect(getProjectSync('alpha')?.name).toBe('Alpha Project');
  });

  it('rejects unsafe requests before mutating the registry', async () => {
    const before = readFileSync(PROJECTS_CONFIG_FILE, 'utf-8');

    await expect(requestProjectRename(
      'alpha',
      { name: 'Unauthorized Rename' },
      { authorized: false },
    )).resolves.toEqual({
      status: 401,
      body: { error: 'unauthorized' },
    });
    expect(readFileSync(PROJECTS_CONFIG_FILE, 'utf-8')).toBe(before);
  });
});

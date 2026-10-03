/** PAN-4486 WI-7: GET /api/effort/default. Config and project lookups are mocked. */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveProjectFromIssueSync: vi.fn(),
  loadProjectsConfigSync: vi.fn(),
}));

vi.mock('../../../../lib/projects.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../../lib/projects.js')>()),
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
  loadProjectsConfigSync: mocks.loadProjectsConfigSync,
}));

async function request(path: string): Promise<{ status: number; body: any }> {
  const { effortDefaultRouteLayer } = await import('../misc/effort-default.js');
  const req = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(effortDefaultRouteLayer), app =>
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
  mocks.resolveProjectFromIssueSync.mockReturnValue(null);
  mocks.loadProjectsConfigSync.mockReturnValue({ projects: {} });
});

describe('GET /api/effort/default', () => {
  it('returns the default effort with no params', async () => {
    const result = await request('/api/effort/default');
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ effort: 'high', source: 'default', requested: 'high', clamped: false });
  });

  it('reports the project source for an issue whose project sets an effort', async () => {
    mocks.resolveProjectFromIssueSync.mockReturnValue({ projectKey: 'tst' });
    mocks.loadProjectsConfigSync.mockReturnValue({ projects: { tst: { name: 'Test', path: '/t', effort: 'medium' } } });
    const result = await request('/api/effort/default?issue=TST-1');
    expect(mocks.resolveProjectFromIssueSync).toHaveBeenCalledWith('TST-1');
    expect(result.body).toMatchObject({ effort: 'medium', source: 'project' });
  });

  it('ignores an unknown harness and a malformed issue id', async () => {
    const result = await request('/api/effort/default?harness=bogus&issue=not-an-issue');
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ source: 'default' });
    expect(mocks.resolveProjectFromIssueSync).not.toHaveBeenCalled();
  });
});

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listProjectsSync: vi.fn(),
  loadYamlConfig: vi.fn(),
  loadPanConfig: vi.fn(),
}));

vi.mock('../../../../src/lib/projects.js', () => ({ listProjectsSync: mocks.listProjectsSync }));
vi.mock('../../../../src/lib/config-yaml.js', () => ({ loadConfigSync: mocks.loadYamlConfig }));
vi.mock('../../../../src/lib/config.js', () => ({ loadConfigSync: mocks.loadPanConfig }));
vi.mock('../../../../src/dashboard/server/services/tracker-config.js', () => ({
  getLinearApiKey: () => null,
  getGitHubConfig: () => null,
  getRallyConfig: () => null,
}));

import { trackersRouteLayer } from '../../../../src/dashboard/server/routes/misc/trackers.js';

// Built at runtime so push protection never sees a token-shaped literal (NFR-3).
const fakeToken = ['fake', 'jira', 'token'].join('-');

async function request(method: string, path: string): Promise<{ status: number; body: any }> {
  const req = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, { method }));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(trackersRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, req)),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadPanConfig.mockReturnValue({ trackers: { primary: 'linear' } });
  mocks.listProjectsSync.mockReturnValue([
    { key: 'proj', config: { name: 'Proj', path: '/p', tracker: 'jira', issue_prefix: 'PROJ', jira: { site: 'https://acme.atlassian.net' } } },
  ]);
});

describe('GET /api/tracker-status with a Jira project (PAN-5152)', () => {
  it('lists Jira with hasKey true when a token and a site are configured', async () => {
    mocks.loadYamlConfig.mockReturnValue({ config: { trackerKeys: { jira: fakeToken } } });

    const { status, body } = await request('GET', '/api/tracker-status');
    expect(status).toBe(200);
    expect(body.configured).toContainEqual(expect.objectContaining({ type: 'jira', name: 'Jira', hasKey: true, envVar: 'JIRA_API_TOKEN' }));
  });

  it('reports hasKey false without a token', async () => {
    mocks.loadYamlConfig.mockReturnValue({ config: { trackerKeys: {} } });

    const { body } = await request('GET', '/api/tracker-status');
    expect(body.configured).toContainEqual(expect.objectContaining({ type: 'jira', hasKey: false }));
  });

  it('omits Jira when no project uses it', async () => {
    mocks.listProjectsSync.mockReturnValue([{ key: 'lin', config: { name: 'Lin', path: '/l', issue_prefix: 'LIN' } }]);
    mocks.loadYamlConfig.mockReturnValue({ config: { trackerKeys: { jira: fakeToken } } });

    const { body } = await request('GET', '/api/tracker-status');
    expect(body.configured.some((entry: { type: string }) => entry.type === 'jira')).toBe(false);
  });
});

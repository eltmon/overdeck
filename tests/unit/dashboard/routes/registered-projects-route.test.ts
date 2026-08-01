import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { describe, expect, it, vi } from 'vitest';

const projectsMocks = vi.hoisted(() => ({
  listProjectsSync: vi.fn(() => [
    {
      key: 'queryable',
      config: {
        name: 'Queryable Project',
        path: '/queryable',
        issue_prefix: 'QUE',
        github_repo: 'owner/queryable',
        linear_project: 'linear-queryable',
      },
    },
    {
      key: 'unqueryable',
      config: {
        name: 'Unqueryable Project',
        path: '/unqueryable',
      },
    },
  ]),
  getIssuePrefix: vi.fn((config: { issue_prefix?: string }) => config.issue_prefix),
}));

vi.mock('../../../../src/lib/projects.js', () => projectsMocks);

import { metaRouteLayer } from '../../../../src/dashboard/server/routes/misc/meta.js';

async function requestRegisteredProjects(): Promise<{ status: number; body: unknown }> {
  const request = HttpServerRequest.fromWeb(new Request('http://localhost/api/registered-projects'));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(metaRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) };
}

describe('GET /api/registered-projects', () => {
  it('returns 500 when the project registry cannot be read', async () => {
    projectsMocks.listProjectsSync.mockImplementationOnce(() => {
      throw new Error('projects.yaml is temporarily unreadable');
    });

    await expect(requestRegisteredProjects()).resolves.toEqual({
      status: 500,
      body: { error: 'Failed to list projects: projects.yaml is temporarily unreadable' },
    });
  });

  it('adds membershipQueryable without removing existing project fields', async () => {
    await expect(requestRegisteredProjects()).resolves.toEqual({
      status: 200,
      body: [
        {
          key: 'queryable',
          name: 'Queryable Project',
          path: '/queryable',
          linearTeam: 'QUE',
          membershipQueryable: true,
          githubRepo: 'owner/queryable',
          linearProject: 'linear-queryable',
        },
        {
          key: 'unqueryable',
          name: 'Unqueryable Project',
          path: '/unqueryable',
          linearTeam: null,
          membershipQueryable: false,
          githubRepo: null,
          linearProject: null,
        },
      ],
    });
  });
});

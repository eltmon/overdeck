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
    {
      key: 'linear-with-repo',
      config: {
        name: 'Linear With Repo',
        path: '/lwr',
        issue_prefix: 'LWR',
        tracker: 'linear',
        github_repo: 'owner/lwr',
      },
    },
    {
      key: 'gitlab-owned',
      config: {
        name: 'GitLab Owned',
        path: '/glo',
        gitlab_repo: 'eltmon/glo',
        owner: 'mindyournow',
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

  it('adds membershipQueryable and tracker without removing existing project fields', async () => {
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
          gitlabRepo: null,
          owner: null,
          tracker: 'github',
          linearProject: 'linear-queryable',
        },
        {
          key: 'unqueryable',
          name: 'Unqueryable Project',
          path: '/unqueryable',
          linearTeam: null,
          membershipQueryable: false,
          githubRepo: null,
          gitlabRepo: null,
          owner: null,
          tracker: null,
          linearProject: null,
        },
        {
          key: 'linear-with-repo',
          name: 'Linear With Repo',
          path: '/lwr',
          linearTeam: 'LWR',
          membershipQueryable: true,
          githubRepo: 'owner/lwr',
          gitlabRepo: null,
          owner: null,
          tracker: 'linear',
          linearProject: null,
        },
        {
          key: 'gitlab-owned',
          name: 'GitLab Owned',
          path: '/glo',
          linearTeam: null,
          membershipQueryable: false,
          githubRepo: null,
          gitlabRepo: 'eltmon/glo',
          owner: 'mindyournow',
          tracker: 'gitlab',
          linearProject: null,
        },
      ],
    });
  });
});

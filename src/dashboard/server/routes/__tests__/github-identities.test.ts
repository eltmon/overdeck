/** PAN-5153 W7: GET /api/github/identities returns the identities snapshot. */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { describe, expect, it, vi } from 'vitest';

import type { GitHubIdentitiesSnapshot } from '../../../../lib/github-repo-identity.js';

const snapshot: GitHubIdentitiesSnapshot = {
  ghLogin: 'eltmon',
  appSlug: 'overdeck-agent',
  owners: [
    {
      owner: 'acme',
      projects: [
        { key: 'a', name: 'Acme A', repo: 'acme/a', mode: 'user', actor: 'eltmon', detail: 'GitHub App is not installed on this repository' },
        { key: 'b', name: 'Acme B', repo: 'acme/b', mode: 'none', actor: null, detail: 'gh is not signed in. Run: gh auth login' },
      ],
    },
    {
      owner: 'eltmon',
      projects: [
        { key: 'overdeck', name: 'Overdeck', repo: 'eltmon/overdeck', mode: 'app', actor: 'overdeck-agent[bot]', detail: 'GitHub App is installed on this repository' },
      ],
    },
  ],
};

vi.mock('../../../../lib/github-repo-identity.js', () => ({
  collectGitHubIdentities: vi.fn(async () => snapshot),
}));

import { githubIdentitiesRouteLayer } from '../github-identities.js';

describe('GET /api/github/identities (PAN-5153)', () => {
  it('returns the identities snapshot', async () => {
    const request = HttpServerRequest.fromWeb(new Request('http://localhost/api/github/identities'));
    const response = await Effect.runPromise(
      Effect.scoped(
        Effect.flatMap(HttpRouter.toHttpEffect(githubIdentitiesRouteLayer), (app) =>
          Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
        ),
      ),
    );
    const responseBody = response.body as { body?: Uint8Array } | null;
    const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';

    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual(snapshot);
  });
});

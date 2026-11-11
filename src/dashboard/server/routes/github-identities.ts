/**
 * PAN-5153: `GET /api/github/identities` — who acts on each registered
 * project's GitHub repository (the App's bot, the gh user, or nobody), grouped
 * by owner. Derived per request from projects.yaml, the App installation
 * lookup and the gh login; nothing is stored.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { collectGitHubIdentities } from '../../../lib/github-repo-identity.js';

const getGitHubIdentitiesRoute = HttpRouter.add(
  'GET',
  '/api/github/identities',
  httpHandler(
    Effect.gen(function* () {
      const snapshot = yield* Effect.promise(() => collectGitHubIdentities());
      return jsonResponse(snapshot);
    }),
  ),
);

export const githubIdentitiesRouteLayer = Layer.mergeAll(getGitHubIdentitiesRoute);

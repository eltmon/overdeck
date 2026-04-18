import { beforeAll, describe, expect, it } from 'vitest';
import { Effect, Layer } from 'effect';
import * as HttpRouter from 'effect/unstable/http/HttpRouter';
import { workspacesRouteLayer } from '../../../src/dashboard/server/routes/workspaces.js';

type RegisteredRoute = {
  method: string;
  path: string;
};

const removedAliasRoutes: RegisteredRoute[] = [
  { method: 'GET', path: '/api/workspaces/:id/review-status' },
  { method: 'GET', path: '/api/workspaces/:issueId/review-status' },
  { method: 'POST', path: '/api/workspaces/:id/review-status' },
  { method: 'POST', path: '/api/workspaces/:issueId/review-status' },
  { method: 'POST', path: '/api/workspaces/:id/review-trigger' },
  { method: 'POST', path: '/api/workspaces/:issueId/review-trigger' },
  { method: 'POST', path: '/api/workspaces/:id/review-reset' },
  { method: 'POST', path: '/api/workspaces/:issueId/review-reset' },
  { method: 'POST', path: '/api/workspaces/:id/review-request' },
  { method: 'POST', path: '/api/workspaces/:issueId/review-request' },
  { method: 'POST', path: '/api/workspaces/:id/review' },
  { method: 'POST', path: '/api/workspaces/:issueId/review' },
  { method: 'POST', path: '/api/workspaces/:id/request-review' },
  { method: 'POST', path: '/api/workspaces/:issueId/request-review' },
  { method: 'POST', path: '/api/workspaces/:id/approve' },
  { method: 'POST', path: '/api/workspaces/:issueId/approve' },
  { method: 'POST', path: '/api/workspaces/:id/merge' },
  { method: 'POST', path: '/api/workspaces/:issueId/merge' },
];

const canonicalRoutes: RegisteredRoute[] = [
  { method: 'GET', path: '/api/review/:issueId/status' },
  { method: 'POST', path: '/api/review/:issueId/status' },
  { method: 'POST', path: '/api/issues/:issueId/merge' },
];

async function collectWorkspaceRoutes(): Promise<Set<string>> {
  const registeredRoutes: RegisteredRoute[] = [];

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const baseRouter = yield* HttpRouter.make;
        const recordingRouter: HttpRouter.HttpRouter = {
          ...baseRouter,
          add(method, path, handler, options) {
            registeredRoutes.push({ method, path: String(path) });
            return baseRouter.add(method, path, handler, options);
          },
        };

        yield* Layer.build(
          Layer.provide(
            workspacesRouteLayer,
            Layer.succeed(HttpRouter.HttpRouter, recordingRouter),
          ),
        );
      }),
    ),
  );

  return new Set(registeredRoutes.map((route) => `${route.method} ${route.path}`));
}

describe('PAN-711 route regression guard', () => {
  let routeTable: Set<string>;

  beforeAll(async () => {
    routeTable = await collectWorkspaceRoutes();
  });

  it('does not register deleted workspace alias routes', () => {
    for (const route of removedAliasRoutes) {
      expect(routeTable.has(`${route.method} ${route.path}`)).toBe(false);
    }
  });

  it('keeps the canonical review and merge routes registered', () => {
    for (const route of canonicalRoutes) {
      expect(routeTable.has(`${route.method} ${route.path}`)).toBe(true);
    }
  });
});

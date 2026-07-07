import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

const mockListAgentStates = vi.hoisted(() => vi.fn(() => []));
const mockListSessions = vi.hoisted(() => vi.fn(() => []));

vi.mock('../../../../src/lib/agents.js', () => ({
  listAgentStates: mockListAgentStates,
}));

vi.mock('../../../../src/lib/tmux.js', () => ({
  listSessions: () => Effect.succeed(mockListSessions()),
  listPaneValues: () => Effect.succeed([]),
}));

import {
  getResourcesEffect,
  resourcesRouteLayer,
} from '../../../../src/dashboard/server/routes/resources.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = join(__dirname, '..', '..', '..', '..');

const RESOURCE_ROUTE_SURFACE_FILES = [
  join(WORKSPACE_ROOT, 'src', 'dashboard', 'server', 'routes', 'resources.ts'),
  join(WORKSPACE_ROOT, 'src', 'dashboard', 'server', 'routes', 'resources', 'index.ts'),
  join(WORKSPACE_ROOT, 'src', 'dashboard', 'server', 'routes', 'resources', 'snapshot.ts'),
  join(WORKSPACE_ROOT, 'src', 'dashboard', 'server', 'routes', 'resources', 'history.ts'),
  join(WORKSPACE_ROOT, 'src', 'dashboard', 'server', 'routes', 'resources', 'containers.ts'),
  join(WORKSPACE_ROOT, 'src', 'dashboard', 'server', 'routes', 'resources', 'prune.ts'),
  join(WORKSPACE_ROOT, 'src', 'dashboard', 'server', 'routes', 'resources', 'reclaim.ts'),
  join(WORKSPACE_ROOT, 'src', 'dashboard', 'server', 'routes', 'resources', 'stack-verbs.ts'),
  join(WORKSPACE_ROOT, 'src', 'dashboard', 'server', 'routes', 'resources', 'teardown.ts'),
] as const;

const EXPECTED_RESOURCE_ROUTES = [
  'GET /api/resources',
  'GET /api/resources/history/24h',
  'GET /api/resources/:containerId/history',
  'GET /api/resources/:containerId/details',
  'GET /api/resources/docker/container/:id/logs',
  'GET /api/resources/stacks/:issueId/teardown-estimate',
  'DELETE /api/resources/venvs/:issue',
  'POST /api/resources/docker/container/:id/pause',
  'POST /api/resources/docker/container/:id/restart',
  'POST /api/resources/docker/container/:id/start',
  'POST /api/resources/docker/container/:id/stop',
  'POST /api/resources/docker/container/:id/unpause',
  'POST /api/resources/stacks/:issueId/pause',
  'POST /api/resources/stacks/:issueId/start',
  'POST /api/resources/stacks/:issueId/stop',
  'POST /api/resources/stacks/:issueId/teardown',
  'POST /api/resources/docker/prune-containers',
  'POST /api/resources/docker/prune-volumes',
  'DELETE /api/resources/docker/container/:id',
  'DELETE /api/resources/docker/network/:name',
  'DELETE /api/resources/docker/volume/:name',
] as const;

function enumerateResourceRoutes(): Set<string> {
  const routes = new Set<string>();
  const routePattern = /HttpRouter\.add\(\s*\n?\s*['"`]([A-Z]+)['"`]\s*,\s*\n?\s*['"`]([^'"`\n]+)['"`]/gm;

  for (const file of RESOURCE_ROUTE_SURFACE_FILES) {
    if (!existsSync(file)) continue;
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(routePattern)) {
      routes.add(`${match[1]} ${match[2]}`);
    }
  }

  return routes;
}

async function readJsonBody(response: Awaited<ReturnType<typeof Effect.runPromise>>) {
  const raw = response.body as { body: Uint8Array } | null;
  const text = raw?.body ? new TextDecoder().decode(raw.body) : '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

describe('PAN-2464 resources route no-loss audit', () => {
  it('keeps the legacy resourcesRouteLayer export available', () => {
    expect(resourcesRouteLayer).toBeDefined();
  });

  it('keeps all 21 resources method/path registrations', () => {
    const liveRoutes = enumerateResourceRoutes();
    const expectedRoutes = new Set(EXPECTED_RESOURCE_ROUTES);

    const missing = EXPECTED_RESOURCE_ROUTES.filter((route) => !liveRoutes.has(route));
    const unexpected = [...liveRoutes]
      .filter((route) => route.includes('/api/resources'))
      .filter((route) => !expectedRoutes.has(route));

    expect(missing, [
      'PAN-2464 extends routes/resources without dropping endpoints.',
      'The following expected method/path registrations are missing:',
      ...missing.map((route) => `  missing: ${route}`),
    ].join('\n')).toEqual([]);

    expect(unexpected, [
      'PAN-2464 expected exactly the locked resources route surface.',
      'Add a no-loss entry before changing this endpoint set:',
      ...unexpected.map((route) => `  unexpected: ${route}`),
    ].join('\n')).toEqual([]);

    expect(liveRoutes).toHaveLength(21);
  });

  it('keeps the GET /api/resources payload field set stable', async () => {
    mockListAgentStates.mockReturnValue([]);
    mockListSessions.mockReturnValue([]);

    const response = await Effect.runPromise(getResourcesEffect());
    const body = await readJsonBody(response);

    expect(Object.keys(body).sort()).toEqual([
      'agents',
      'containers',
      'coreServices',
      'forecast',
      'hostProcesses',
      'hostVitals',
      'networks',
      'reclaimCandidates',
      'reclaimThresholdBytes',
      'reclaimTotals',
      'spawnGate',
      'stacks',
      'stoppedContainers',
      'updatedAt',
      'volumes',
    ]);
  });
});

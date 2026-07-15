import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = join(__dirname, '..', '..', '..', '..');
const ISSUES_ROUTE_FILE = join(WORKSPACE_ROOT, 'src', 'dashboard', 'server', 'routes', 'issues.ts');

const EXPECTED_ISSUES_ROUTES = [
  'GET /api/issues',
  'GET /api/issues/:id/analyze',
  'POST /api/issues/:issueId/close',
  'POST /api/issues/:id/start-planning',
  'POST /api/issues/:id/abort-planning',
  'POST /api/issues/:id/complete-planning',
  'POST /api/issues/:id/abort',
  'POST /api/issues/:id/reset',
  'POST /api/issues/:id/cancel',
  'POST /api/issues/:id/reopen',
  'POST /api/issues/:id/restart-from-plan',
  'POST /api/issues/:id/move-status',
  'POST /api/issues/:id/cleanup-workspace',
  'POST /api/issues/:id/deep-wipe',
  'POST /api/issues/:id/copy-settings',
  'POST /api/issues/:id/close-out',
  'POST /api/issues/bulk-close-out',
  'GET /api/issues/:id/tasks',
  'POST /api/issues/:id/tasks/:itemId/inspect',
  'GET /api/issues/:id/verification',
  'POST /api/issues/:id/reset-to-planned',
  'GET /api/issues/:id/planning-state',
  'GET /api/issues/:id/ship-log',
  'POST /api/issues/:id/generate-tasks',
  'GET /api/issues/:id/pr',
  'GET /api/issues/:id/pr/diff',
  'GET /api/issues/:id/pr/details',
  'GET /api/issues/:id/check-runs',
  'GET /api/issues/:id/discussions',
  'GET /api/issues/:id/costs',
  'GET /api/issues/:id/ship-log',
  'GET /api/issues/resource-allocated',
  'GET /api/issues/:id/resource-details',
] as const;

function enumerateIssuesRoutes(): Set<string> {
  const content = readFileSync(ISSUES_ROUTE_FILE, 'utf8');
  const routes = new Set<string>();
  const routePattern = /HttpRouter\.add\(\s*\n?\s*['"`]([A-Z]+)['"`]\s*,\s*\n?\s*['"`]([^'"`\n]+)['"`]/gm;

  for (const match of content.matchAll(routePattern)) {
    routes.add(`${match[1]} ${match[2]}`);
  }

  return routes;
}

describe('PAN-2148 issues route no-loss audit', () => {
  it('keeps all 32 issuesRouteLayer method/path registrations', () => {
    const liveRoutes = enumerateIssuesRoutes();
    const expectedRoutes = new Set(EXPECTED_ISSUES_ROUTES);

    const missing = EXPECTED_ISSUES_ROUTES.filter((route) => !liveRoutes.has(route));
    const unexpected = [...liveRoutes].filter((route) => !expectedRoutes.has(route));

    expect(missing, [
      'PAN-2148 decomposes routes/issues.ts without dropping endpoints.',
      'The following expected method/path registrations are missing:',
      ...missing.map((route) => `  missing: ${route}`),
    ].join('\n')).toEqual([]);

    expect(unexpected, [
      'PAN-2148 expected exactly the locked issues route surface.',
      'Add a new no-loss entry before changing this endpoint set:',
      ...unexpected.map((route) => `  unexpected: ${route}`),
    ].join('\n')).toEqual([]);

    expect(liveRoutes.size).toBe(32);
  });
});

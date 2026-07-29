import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = join(__dirname, '..', '..', '..', '..');
const ISSUES_ROUTE_FILE = join(WORKSPACE_ROOT, 'src', 'dashboard', 'server', 'routes', 'issues.ts');
// PAN-2972 relocated the pipeline-membership routes out of issues.ts.
const MEMBERSHIP_ROUTE_FILE = join(WORKSPACE_ROOT, 'src', 'dashboard', 'server', 'routes', 'pipeline-membership.ts');

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
  'GET /api/issues/:id/prd',
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

// PAN-2972: GET moved from issues.ts (no-loss relocation); POST is the new
// operator retry door.
const EXPECTED_MEMBERSHIP_ROUTES = [
  'GET /api/pipeline/membership',
  'POST /api/pipeline/membership/refresh',
] as const;

function enumerateRoutes(file: string): Set<string> {
  const content = readFileSync(file, 'utf8');
  const routes = new Set<string>();
  const routePattern = /HttpRouter\.add\(\s*\n?\s*['"`]([A-Z]+)['"`]\s*,\s*\n?\s*['"`]([^'"`\n]+)['"`]/gm;

  for (const match of content.matchAll(routePattern)) {
    routes.add(`${match[1]} ${match[2]}`);
  }

  return routes;
}

function enumerateIssuesRoutes(): Set<string> {
  return new Set([...enumerateRoutes(ISSUES_ROUTE_FILE), ...enumerateRoutes(MEMBERSHIP_ROUTE_FILE)]);
}

describe('PAN-2148 issues route no-loss audit', () => {
  it('keeps all 35 issues + pipeline-membership method/path registrations', () => {
    const liveRoutes = enumerateIssuesRoutes();
    const allExpected = [...EXPECTED_ISSUES_ROUTES, ...EXPECTED_MEMBERSHIP_ROUTES];
    const expectedRoutes = new Set<string>(allExpected);

    const missing = allExpected.filter((route) => !liveRoutes.has(route));
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

    expect(liveRoutes.size).toBe(35);
  });
});

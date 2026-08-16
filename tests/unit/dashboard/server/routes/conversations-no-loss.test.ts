import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const CONVERSATIONS_ROUTE_FILE = join(
  WORKSPACE_ROOT,
  'src',
  'dashboard',
  'server',
  'routes',
  'conversations.ts',
);

const CONVERSATION_ROUTE_SURFACE_FILES = [
  CONVERSATIONS_ROUTE_FILE,
  join(WORKSPACE_ROOT, 'src', 'lib', 'overdeck', 'conversation-archive.ts'),
  join(WORKSPACE_ROOT, 'src', 'lib', 'overdeck', 'conversation-delivery.ts'),
  join(WORKSPACE_ROOT, 'src', 'lib', 'overdeck', 'conversation-diffs.ts'),
  join(WORKSPACE_ROOT, 'src', 'lib', 'overdeck', 'conversation-forks.ts'),
  join(WORKSPACE_ROOT, 'src', 'lib', 'overdeck', 'conversation-message.ts'),
  join(WORKSPACE_ROOT, 'src', 'lib', 'overdeck', 'conversation-reads.ts'),
  join(WORKSPACE_ROOT, 'src', 'lib', 'overdeck', 'conversation-runtime.ts'),
] as const;

const EXPECTED_CONVERSATION_ROUTES = [
  'GET /api/conversations',
  'GET /api/conversations/pending-input',
  'GET /api/conversations/archived',
  'GET /api/conversations/:id',
  'GET /api/conversations/:name/handoff-doc',
  'POST /api/conversations',
  'POST /api/conversations/:name/stop',
  'POST /api/conversations/:name/clear-fork-state',
  'POST /api/conversations/:name/resume',
  'POST /api/conversations/:name/switch-model',
  'POST /api/conversations/:name/thinking-level',
  'POST /api/conversations/:name/compact',
  'POST /api/conversations/:name/abort',
  'GET /api/conversations/:name/messages',
  'GET /api/conversations/:name/message-locator',
  'POST /api/conversations/:name/upload-image',
  'POST /api/conversations/:name/delete-image',
  'POST /api/conversations/:name/message',
  'POST /api/conversations/:id/codex-approval',
  'POST /api/conversations/:id/pane-choice',
  'POST /api/conversations/:name/delivery-method',
  'POST /api/conversations/:name/control-ack',
  'PATCH /api/conversations/:name',
  'PATCH /api/conversations/:name/move',
  'DELETE /api/conversations/:name',
  'POST /api/conversations/:name/archive',
  'POST /api/conversations/:name/unarchive',
  'POST /api/conversations/restart-all',
  'POST /api/conversations/:name/favorite',
  'DELETE /api/conversations/:name/favorite',
  'POST /api/conversations/:name/summary-fork',
  'POST /api/conversations/:name/plan-action',
  'GET /api/conversations/:name/diffs',
  'GET /api/conversations/:name/diffs/full',
  'GET /api/conversations/:name/diffs/:turnId',
  'POST /api/conversations/:name/retitle',
  'GET /api/conversations/:name/about',
] as const;

function enumerateConversationRoutes(): Set<string> {
  const routes = new Set<string>();
  const routePattern = /HttpRouter\.add\(\s*\n?\s*['"`]([A-Z]+)['"`]\s*,\s*\n?\s*['"`]([^'"`\n]+)['"`]/gm;

  for (const file of CONVERSATION_ROUTE_SURFACE_FILES) {
    if (!existsSync(file)) continue;
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(routePattern)) {
      routes.add(`${match[1]} ${match[2]}`);
    }
  }

  return routes;
}

describe('PAN-2145 conversations route no-loss audit', () => {
  it('does not import the conversations route graph during the Vitest worker lifecycle', () => {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');

    expect(source).not.toMatch(/from\s+['"][^'"]*routes\/conversations(?:\.js)?['"]/);
  });

  it('keeps the legacy conversationsRouteLayer export available', () => {
    const source = readFileSync(CONVERSATIONS_ROUTE_FILE, 'utf8');

    expect(source).toMatch(/export\s+const\s+conversationsRouteLayer\s*=/);
  });

  it('keeps all 37 conversationsRouteLayer method/path registrations', () => {
    const liveRoutes = enumerateConversationRoutes();
    const expectedRoutes = new Set(EXPECTED_CONVERSATION_ROUTES);

    const missing = EXPECTED_CONVERSATION_ROUTES.filter((route) => !liveRoutes.has(route));
    const unexpected = [...liveRoutes].filter((route) => route.startsWith('GET /api/conversations')
      || route.startsWith('POST /api/conversations')
      || route.startsWith('PATCH /api/conversations')
      || route.startsWith('DELETE /api/conversations'))
      .filter((route) => !expectedRoutes.has(route));

    expect(missing, [
      'PAN-2145 decomposes routes/conversations.ts without dropping endpoints.',
      'The following expected method/path registrations are missing:',
      ...missing.map((route) => `  missing: ${route}`),
    ].join('\n')).toEqual([]);

    expect(unexpected, [
      'PAN-2145 expected exactly the locked conversations route surface.',
      'Add a no-loss entry before changing this endpoint set:',
      ...unexpected.map((route) => `  unexpected: ${route}`),
    ].join('\n')).toEqual([]);

    expect(liveRoutes.size).toBe(37);
  });
});

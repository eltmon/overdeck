/**
 * PAN-3964 FR-15 — the Flywheel no-loss table.
 *
 * PAN-3917 cut the Flywheel page and its verbs; the operator wanted them kept.
 * Each of the eleven v1 affordances named in the issue has a home here, and
 * this test reads the source tree to prove every home still exists: the
 * route is registered in routes/flywheel.ts, the view file exists, the verb is
 * a `.command('<verb>')` in the CLI, and the skill carries the heading.
 * Deleting any of them fails this test.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const FRONTEND = join(ROOT, 'src/dashboard/frontend/src');
const ROUTES_FILE = join(ROOT, 'src/dashboard/server/routes/flywheel.ts');
const CLI_FILE = join(ROOT, 'src/cli/commands/flywheel.ts');
const SKILL_FILE = join(ROOT, 'sync-sources/skills/pan-flywheel/SKILL.md');

interface Home {
  routes?: string[];
  views?: string[];
  verbs?: string[];
  skillHeadings?: string[];
  /** A literal that must appear in a frontend file (relative to src/dashboard/frontend/src). */
  contains?: Array<{ file: string; text: string }>;
}

const NO_LOSS: Record<string, Home> = {
  'status pane': {
    routes: ['GET /api/flywheel/status'],
    views: ['components/flywheel/FlywheelStatusPane.tsx'],
    verbs: ['status'],
  },
  'state pane': {
    routes: ['GET /api/flywheel/state'],
    views: ['components/flywheel/FlywheelStatePane.tsx'],
    skillHeadings: ['## State file'],
  },
  'stats panel': {
    routes: ['GET /api/flywheel/stats'],
    views: ['components/flywheel/FlywheelStatsPanel.tsx'],
    verbs: ['stats'],
  },
  'merge queue card': {
    views: ['components/flywheel/PendingAutoMergesCard.tsx'],
    contains: [{ file: 'components/flywheel/PendingAutoMergesCard.tsx', text: '/api/merge-train/auto-merge/pending' }],
  },
  'order book module': {
    views: ['components/flywheel/FlywheelOrderBookCard.tsx'],
    verbs: ['start'],
  },
  'policy toggles': {
    views: ['pages/FlywheelPage.tsx'],
    contains: [
      { file: 'pages/FlywheelPage.tsx', text: 'label="Auto-pickup"' },
      { file: 'pages/FlywheelPage.tsx', text: 'label="Require UAT"' },
    ],
  },
  'embedded conversation': {
    views: ['components/flywheel/FlywheelConversationPane.tsx'],
    contains: [{ file: 'components/flywheel/FlywheelConversationPane.tsx', text: '<ConversationPanel' }],
  },
  'pause/resume/abort/report/stats verbs': {
    routes: ['POST /api/flywheel/pause', 'POST /api/flywheel/resume', 'POST /api/flywheel/abort', 'POST /api/flywheel/report', 'POST /api/flywheel/stop', 'POST /api/flywheel/start', 'GET /api/flywheel/report'],
    verbs: ['pause', 'resume', 'abort', 'report', 'stats', 'stop'],
  },
  'pickup gate vocabulary': {
    skillHeadings: ['## Pickup gate'],
  },
  'metabolism mission': {
    skillHeadings: ['## Mission'],
  },
  popout: {
    views: ['App/StandaloneRoutes.tsx'],
    contains: [
      { file: 'App.tsx', text: "'/popout/flywheel-conversation'" },
      { file: 'App/StandaloneRoutes.tsx', text: 'StandaloneFlywheelPopoutRoute' },
    ],
  },
};

function registeredRoutes(): Set<string> {
  const source = readFileSync(ROUTES_FILE, 'utf8');
  const routes = new Set<string>();
  const pattern = /HttpRouter\.add\(\s*['"`]([A-Z]+)['"`]\s*,\s*['"`]([^'"`\n]+)['"`]/g;
  for (const match of source.matchAll(pattern)) routes.add(`${match[1]} ${match[2]}`);
  return routes;
}

describe('Flywheel no-loss table (PAN-3964 FR-15)', () => {
  const routes = registeredRoutes();
  const cli = readFileSync(CLI_FILE, 'utf8');
  const skill = readFileSync(SKILL_FILE, 'utf8');

  it('covers all eleven v1 rows from the issue', () => {
    expect(Object.keys(NO_LOSS)).toHaveLength(11);
  });

  it.each(Object.entries(NO_LOSS))('%s still has its home', (_row, home) => {
    for (const route of home.routes ?? []) expect(routes, route).toContain(route);
    for (const view of home.views ?? []) expect(existsSync(join(FRONTEND, view)), view).toBe(true);
    for (const verb of home.verbs ?? []) expect(cli, `pan flywheel ${verb}`).toContain(`.command('${verb}')`);
    for (const heading of home.skillHeadings ?? []) expect(skill.split('\n'), heading).toContain(heading);
    for (const { file, text } of home.contains ?? []) expect(readFileSync(join(FRONTEND, file), 'utf8'), `${file} ⊇ ${text}`).toContain(text);
  });

  it('the page is routed at /flywheel', () => {
    expect(readFileSync(join(FRONTEND, 'App/routes.ts'), 'utf8')).toContain("flywheel: '/flywheel'");
  });

  it('there is no status write route: the loop reports through its transcript', () => {
    expect(routes).not.toContain('POST /api/flywheel/status');
  });
});

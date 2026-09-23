// @vitest-environment jsdom
/**
 * PAN-3964 FR-15 — the Flywheel no-loss table.
 *
 * PAN-3917 cut the Flywheel page and its verbs; the operator wanted them kept.
 * Each of the eleven v1 affordances named in the issue has a home here, and
 * this test proves every home still exists at runtime: the route answers
 * through `flywheelRouteLayer`, the view module exports its component, the
 * verb is registered on `pan flywheel`, and the loop skill carries the
 * heading. Deleting any of them fails this test.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Command } from 'commander';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/flywheel/derive-status.js', () => ({
  deriveFlywheelStatus: vi.fn(async () => ({ run: 'idle' })),
  readFlywheelRun: vi.fn(async () => ({ run: 'idle' })),
  resolveFlywheelProjectRoot: vi.fn(async () => ({ projectRoot: '/repo', planHome: '/repo' })),
}));
vi.mock('../../../src/lib/flywheel/files.js', () => ({
  readFlywheelStateFile: vi.fn(async () => ({ exists: false })),
  readFlywheelReportFile: vi.fn(async () => ({ exists: false })),
}));
vi.mock('../../../src/lib/flywheel/substrate-stats.js', () => ({ computeSubstrateStats: vi.fn(async () => ({})) }));

const SKILL_FILE = join(__dirname, '..', '..', '..', 'sync-sources/skills/pan-flywheel/SKILL.md');
const FRONTEND = '../../../src/dashboard/frontend/src/';

interface Home {
  /** `METHOD /path` served by routes/flywheel.ts. */
  routes?: string[];
  /** Frontend module (relative to src/dashboard/frontend/src) and the export it must provide. */
  views?: Array<[module: string, exportName: string]>;
  /** `pan flywheel <verb>` subcommands, optionally with required flags. */
  verbs?: Array<string | [verb: string, ...flags: string[]]>;
  skillHeadings?: string[];
}

const NO_LOSS: Record<string, Home> = {
  'status pane': {
    routes: ['GET /api/flywheel/status'],
    views: [['components/flywheel/FlywheelStatusPane', 'FlywheelStatusPane']],
    verbs: [['status', '--json']],
  },
  'state pane': {
    routes: ['GET /api/flywheel/state'],
    views: [['components/flywheel/FlywheelStatePane', 'FlywheelStatePane']],
    skillHeadings: ['## State file'],
  },
  'stats panel': {
    routes: ['GET /api/flywheel/stats'],
    views: [['components/flywheel/FlywheelStatsPanel', 'FlywheelStatsPanel']],
    verbs: [['stats', '--json', '--window']],
  },
  'merge queue card': {
    views: [['components/flywheel/PendingAutoMergesCard', 'PendingAutoMergesCard']],
  },
  'order book module': {
    views: [['components/flywheel/FlywheelOrderBookCard', 'FlywheelOrderBookCard']],
    verbs: [['start', '--orders', '--fresh']],
  },
  'policy toggles': {
    views: [['pages/FlywheelPage', 'FlywheelPage'], ['components/flywheel/primitives', 'ToggleSwitch']],
  },
  'embedded conversation': {
    views: [['components/flywheel/FlywheelConversationPane', 'FlywheelConversationPane']],
  },
  'pause/resume/abort/report/stats verbs': {
    routes: ['POST /api/flywheel/pause', 'POST /api/flywheel/resume', 'POST /api/flywheel/abort', 'POST /api/flywheel/report', 'POST /api/flywheel/stop', 'POST /api/flywheel/start', 'GET /api/flywheel/report'],
    verbs: ['pause', 'resume', 'abort', 'report', 'stats', ['stop', '--timeout']],
  },
  'pickup gate vocabulary': {
    skillHeadings: ['## Pickup gate'],
  },
  'metabolism mission': {
    skillHeadings: ['## Mission'],
  },
  popout: {
    views: [['App/StandaloneRoutes', 'StandaloneFlywheelPopoutRoute']],
  },
};

let flywheelRouteLayer: typeof import('../../../src/dashboard/server/routes/flywheel.js')['flywheelRouteLayer'];
let flywheelCommand: Command;

beforeAll(async () => {
  ({ flywheelRouteLayer } = await import('../../../src/dashboard/server/routes/flywheel.js'));
  const { registerFlywheelCommands } = await import('../../../src/cli/commands/flywheel.js');
  const program = new Command();
  registerFlywheelCommands(program);
  flywheelCommand = program.commands.find((command) => command.name() === 'flywheel')!;
});

/** GETs run against the mocked derivers; POSTs from an untrusted origin must hit the origin gate, not 404. */
async function routeStatus(route: string): Promise<number> {
  const [method, path] = route.split(' ') as [string, string];
  const init: RequestInit = method === 'GET'
    ? {}
    : { method, headers: { 'content-type': 'application/json', origin: 'https://untrusted.example' }, body: '{}' };
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, init));
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(flywheelRouteLayer),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
  )));
  return response.status;
}

describe('Flywheel no-loss table (PAN-3964 FR-15)', () => {
  const skillLines = readFileSync(SKILL_FILE, 'utf8').split('\n');

  it('covers all eleven v1 rows from the issue', () => {
    expect(Object.keys(NO_LOSS)).toHaveLength(11);
  });

  it.each(Object.entries(NO_LOSS))('%s still has its home', async (_row, home) => {
    for (const route of home.routes ?? []) {
      expect(await routeStatus(route), route).toBe(route.startsWith('GET ') ? 200 : 403);
    }
    for (const [module, exportName] of home.views ?? []) {
      const mod = (await import(/* @vite-ignore */ `${FRONTEND}${module}`)) as Record<string, unknown>;
      expect(typeof mod[exportName], `${module}.${exportName}`).toBe('function');
    }
    for (const entry of home.verbs ?? []) {
      const [verb, ...flags] = typeof entry === 'string' ? [entry] : entry;
      const command = flywheelCommand.commands.find((c) => c.name() === verb);
      expect(command, `pan flywheel ${verb}`).toBeDefined();
      expect(command!.options.map((o) => o.long)).toEqual(expect.arrayContaining(flags));
    }
    for (const heading of home.skillHeadings ?? []) expect(skillLines, heading).toContain(heading);
  });

  it('the page is routed at /flywheel and the popout path is stable', async () => {
    const { TAB_PATHS } = await import('../../../src/dashboard/frontend/src/App/routes.js');
    expect(TAB_PATHS.flywheel).toBe('/flywheel');
    const pane = await import('../../../src/dashboard/frontend/src/components/flywheel/FlywheelConversationPane.js');
    expect(pane.FLYWHEEL_POPOUT_PATH).toBe('/popout/flywheel-conversation');
  });

  it('there is no status write route: the loop reports through its transcript', async () => {
    await expect(routeStatus('POST /api/flywheel/status')).rejects.toThrow(/RouteNotFound/);
  });
});

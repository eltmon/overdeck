/**
 * Review of #3992 (PAN-3960): the dashboard planning routes decide planner
 * liveness with the liveness oracle, close a finished planner's residue before
 * relaunching it, and report a failed Stop as a failure.
 *
 * M1 — a finished Herdr planner leaves its pane (and possibly an `exited` agent
 *      record) behind. "A pane exists" read that as a live planner: the user's
 *      message went to a dead shell and the planner was never relaunched.
 * L2 — `closeAgentPane` answered false both for "nothing was running" and for
 *      "the close failed", so a failed Stop reported `alreadyStopped`.
 *
 * Every terminal and liveness call is mocked; nothing touches tmux or Herdr.
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Layer, Stream } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  projectPath: '',
  isAlive: vi.fn(),
  closeAgentPane: vi.fn(),
  closeAgentPaneDetailed: vi.fn(),
  launchAgentPane: vi.fn(),
  deliverAgentMessage: vi.fn(),
  appended: [] as Record<string, unknown>[],
}));

vi.mock('../../../../../src/lib/agents/liveness.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/lib/agents/liveness.js')>();
  return { ...actual, isAlive: mocks.isAlive };
});

vi.mock('../../../../../src/lib/terminal-backends/launch.js', () => ({
  closeAgentPane: mocks.closeAgentPane,
  closeAgentPaneDetailed: mocks.closeAgentPaneDetailed,
  launchAgentPane: mocks.launchAgentPane,
}));

vi.mock('../../../../../src/lib/agents/delivery.js', () => ({
  deliverAgentMessage: mocks.deliverAgentMessage,
}));

vi.mock('../../../../../src/lib/remote/remote-agents.js', () => ({
  loadRemoteAgentState: () => null,
}));

vi.mock('../../../../../src/dashboard/server/routes/misc/shared.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/dashboard/server/routes/misc/shared.js')>();
  return {
    ...actual,
    getProjectPath: async () => mocks.projectPath,
    isGitHubIssue: () => ({ isGitHub: false }),
    getGitHubLocalPaths: () => ({}),
  };
});

vi.mock('../../../../../src/lib/projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/lib/projects.js')>();
  return {
    ...actual,
    extractTeamPrefix: () => 'PAN',
    findProjectByTeamSync: () => ({ path: mocks.projectPath }),
  };
});

vi.mock('../../../../../src/lib/harness-binary.js', () => ({
  prepareHarnessLaunch: async () => ({ binaryPath: '/opt/claude/bin/claude', pathExport: 'export PATH="$PATH"' }),
}));

vi.mock('../../../../../src/lib/briefing-freshness.js', () => ({
  ensureSessionContextBriefingFile: async () => '/tmp/briefing.md',
}));

vi.mock('../../../../../src/lib/claude-permissions.js', () => ({
  getClaudePermissionFlagsStringSync: () => '--permission-mode auto',
}));

vi.mock('../../../../../src/lib/settings.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/lib/settings.js')>();
  return { ...actual, getAgentCommandSync: () => ({ command: 'claude', args: [] }) };
});

vi.mock('../../../../../src/lib/config-yaml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/lib/config-yaml.js')>();
  return { ...actual, loadConfigSync: () => ({ config: {} }), resolveModel: () => 'claude-sonnet-5' };
});

vi.mock('../../../../../src/lib/launcher-generator.js', () => ({
  generateLauncherScriptSync: () => '#!/usr/bin/env bash\n',
}));

vi.mock('../../../../../src/lib/tmux.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/lib/tmux.js')>();
  return { ...actual, resizeWindow: () => Effect.succeed(undefined) };
});

import { planningRouteLayer } from '../../../../../src/dashboard/server/routes/misc/planning.js';
import { EventStoreService } from '../../../../../src/dashboard/server/services/domain-services.js';

const ISSUE = 'PAN-3960';
const PLANNER = 'planning-pan-3960';

const eventStoreLayer = Layer.succeed(EventStoreService, {
  append: (event: Record<string, unknown>) => Effect.sync(() => { mocks.appended.push(event); return 1; }),
  appendAsync: () => Effect.succeed(1),
  readFrom: () => Effect.succeed([]),
  queryByType: () => Effect.succeed([]),
  getLatestSequence: Effect.succeed(0),
  streamEvents: Stream.empty,
});

async function call(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, {
    method,
    ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  }));
  const response = await Effect.runPromise(Effect.scoped(
    Effect.flatMap(HttpRouter.toHttpEffect(planningRouteLayer), (app) =>
      Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
    ).pipe(Effect.provide(eventStoreLayer)),
  ));
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
}

let prevOverdeckHome: string | undefined;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.appended.length = 0;
  mocks.projectPath = await mkdtemp(join(tmpdir(), 'pan-3960-planning-routes-'));
  await mkdir(join(mocks.projectPath, 'workspaces', 'feature-pan-3960', '.pan'), { recursive: true });
  prevOverdeckHome = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = join(mocks.projectPath, 'home');
  mocks.closeAgentPane.mockResolvedValue(true);
  mocks.launchAgentPane.mockResolvedValue({
    backend: 'herdr', workspaceId: 'w1', paneId: 'w1:p2', terminalId: 'term-2', agentName: PLANNER,
  });
  mocks.deliverAgentMessage.mockResolvedValue({ ok: true, path: 'herdr' });
});

afterEach(async () => {
  if (prevOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = prevOverdeckHome;
  await rm(mocks.projectPath, { recursive: true, force: true });
});

describe('POST /api/planning/:issueId/message (M1)', () => {
  it('closes a dead planner on Herdr, then relaunches it — the message is not sent to the residue', async () => {
    mocks.isAlive.mockResolvedValue({ alive: false, reason: 'pane-dead' });

    const response = await call('POST', `/api/planning/${ISSUE}/message`, { message: 'use option B' });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Planning session restarted in interactive mode');
    expect(mocks.isAlive).toHaveBeenCalledWith(PLANNER);
    expect(mocks.deliverAgentMessage).not.toHaveBeenCalled();
    expect(mocks.closeAgentPane).toHaveBeenCalledWith(PLANNER);
    expect(mocks.launchAgentPane).toHaveBeenCalledWith(expect.objectContaining({
      agentId: PLANNER,
      tokens: expect.objectContaining({ issue: ISSUE, role: 'plan' }),
    }));
    expect(mocks.closeAgentPane.mock.invocationCallOrder[0]!)
      .toBeLessThan(mocks.launchAgentPane.mock.invocationCallOrder[0]!);
  });

  it('delivers to a live planner and neither closes nor relaunches it', async () => {
    mocks.isAlive.mockResolvedValue({ alive: true, paneAlive: true });

    const response = await call('POST', `/api/planning/${ISSUE}/message`, { message: 'use option B' });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Message sent to active session');
    expect(mocks.deliverAgentMessage).toHaveBeenCalledWith(PLANNER, 'use option B', 'planning user message');
    expect(mocks.closeAgentPane).not.toHaveBeenCalled();
    expect(mocks.launchAgentPane).not.toHaveBeenCalled();
  });

  it('treats an indeterminate probe as live — never relaunches over a possibly-live planner', async () => {
    mocks.isAlive.mockResolvedValue({ alive: false, reason: 'runtime-indeterminate' });

    await call('POST', `/api/planning/${ISSUE}/message`, { message: 'hello' });

    expect(mocks.deliverAgentMessage).toHaveBeenCalled();
    expect(mocks.closeAgentPane).not.toHaveBeenCalled();
    expect(mocks.launchAgentPane).not.toHaveBeenCalled();
  });
});

describe('GET /api/planning/:issueId/status (M1)', () => {
  it('reports a dead planner as not active', async () => {
    mocks.isAlive.mockResolvedValue({ alive: false, reason: 'pane-dead' });

    const response = await call('GET', `/api/planning/${ISSUE}/status`);

    expect(response.body).toMatchObject({ active: false, sessionName: PLANNER });
  });

  it('reports a live planner as active', async () => {
    mocks.isAlive.mockResolvedValue({ alive: true, paneAlive: true });

    const response = await call('GET', `/api/planning/${ISSUE}/status`);

    expect(response.body).toMatchObject({ active: true, sessionName: PLANNER });
  });
});

describe('DELETE /api/planning/:issueId (L2)', () => {
  it('reports success when the planner was closed', async () => {
    mocks.closeAgentPaneDetailed.mockResolvedValue({ outcome: 'closed' });

    const response = await call('DELETE', `/api/planning/${ISSUE}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
  });

  it('reports already stopped when nothing was running', async () => {
    mocks.closeAgentPaneDetailed.mockResolvedValue({ outcome: 'absent' });

    const response = await call('DELETE', `/api/planning/${ISSUE}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, alreadyStopped: true });
  });

  it('reports a failure when the close failed', async () => {
    mocks.closeAgentPaneDetailed.mockResolvedValue({ outcome: 'failed', reason: 'pane.close timed out' });

    const response = await call('DELETE', `/api/planning/${ISSUE}`);

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(String(response.body.error)).toContain('pane.close timed out');
  });
});

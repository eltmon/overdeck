/**
 * PAN-4638 WI-6: lane views include lanes on other machines from their
 * stand-ins. Real conversations DB and stand-in store in a temp OVERDECK_HOME;
 * the enriched list and git facts are injected.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

const TEST_HOME = join(tmpdir(), `lane-views-remote-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = TEST_HOME;
mkdirSync(TEST_HOME, { recursive: true });

vi.mock('../../overdeck/conversation-list.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../overdeck/conversation-list.js')>()),
  getEnrichedConversationList: vi.fn(async () => []),
}));

const { closeOverdeckDatabase } = await import('../../overdeck/infra.js');
const { createConversation } = await import('../../overdeck/conversations.js');
const { writeWorkerReport } = await import('../../agents/worker/report.js');
const { writeRemoteLaneFacts, writeRemoteLaneMirror } = await import('../remote-lanes.js');
const { invalidateLaneViews, listLaneViews } = await import('../views.js');
const { lanesRouteLayer } = await import('../../../dashboard/server/routes/lanes.js');

type Facts = import('../remote-lanes.js').RemoteLaneFacts;
type Mirror = import('../remote-lanes.js').RemoteLaneMirror;

const GIT = { branch: 'hotel/663', head: 'abc1234', ahead: 0, dirty: false };

function root(name: string): void {
  createConversation({ name, tmuxSession: `conv-${name}`, cwd: TEST_HOME, workspaceId: null });
}

function builder(name: string, parent: string, run: string): void {
  createConversation({ name, tmuxSession: `conv-${name}`, cwd: join(TEST_HOME, 'lanes', name), workspaceId: null, parentName: parent, lane: { run, key: '663', role: 'builder' } });
}

function facts(name: string, parentName: string, run: string, overrides: Partial<Facts> = {}): Facts {
  return {
    v: 1, name, environmentId: 'env-fly', label: 'fly-abc', run, key: '663', role: 'critic', iteration: 1,
    parentName, criticOfName: null, projectKey: 'lexerra', cwd: `/workspace/lanes/${run}-663-critic-i1`, branch: null, at: 'abc1234',
    model: 'claude-opus-5-5', harness: 'claude-code', effort: 'high', title: `${run} 663 · critic`,
    createdAt: new Date(Date.now() + 1_000).toISOString(),
    ...overrides,
  };
}

function mirror(overrides: Partial<Mirror> = {}): Mirror {
  return {
    v: 1, state: 'running', activity: 'idle', lastActivityAt: '2026-11-01T12:00:05.000Z',
    git: { branch: null, head: 'abc1234', ahead: null, dirty: false }, costUsd: 0.75, ownerArchived: false, lastSeq: 1,
    lastSeenAt: '2026-11-01T12:00:06.000Z', unreachableSince: null, lastAssistantMessage: null, spawnError: null,
    ...overrides,
  };
}

function deps() {
  return { enrichedList: vi.fn(async () => []), gitFacts: vi.fn(async () => GIT), now: () => Date.now() };
}

beforeEach(() => {
  invalidateLaneViews();
});

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

describe('listLaneViews with remote lanes (PAN-4638 WI-6)', () => {
  it('ac1 + ac3: a remote critic pairs with a local builder; its git comes from the mirror, never from git here', async () => {
    root('rv-root');
    builder('rv-builder', 'rv-root', 'rv');
    await writeRemoteLaneFacts(facts('rv-critic', 'rv-root', 'rv', { criticOfName: 'rv-builder' }));
    await writeRemoteLaneMirror('rv-critic', mirror());
    await writeWorkerReport('conv-rv-critic', { body: 'wowed', verdict: { value: 'WOWED', defects: 0, file: '/v/1.json' } });

    const d = deps();
    const views = await listLaneViews({ run: 'rv' }, d);
    const critic = views.find((view) => view.name === 'rv-critic')!;
    const local = views.find((view) => view.name === 'rv-builder')!;

    expect(critic).toMatchObject({
      id: null,
      role: 'critic',
      cwd: '/workspace/lanes/rv-663-critic-i1',
      activity: 'idle',
      git: { head: 'abc1234' },
      costUsd: 0.75,
      lastActivityAt: '2026-11-01T12:00:05.000Z',
      machine: { environmentId: 'env-fly', label: 'fly-abc', reachable: true, lastSeenAt: '2026-11-01T12:00:06.000Z' },
      verdict: { value: 'WOWED', defects: 0, file: '/v/1.json' },
      criticOf: { name: 'rv-builder', iteration: 1 },
    });
    expect(critic.parentName).toBe('rv-root');
    expect(local.machine).toBeNull();
    expect(local.latestVerdict).toMatchObject({ id: null, name: 'rv-critic', verdict: 'WOWED' });
    expect(d.gitFacts).toHaveBeenCalledTimes(1);
    expect(d.gitFacts).toHaveBeenCalledWith(join(TEST_HOME, 'lanes', 'rv-builder'));
    expect(d.gitFacts).not.toHaveBeenCalledWith('/workspace/lanes/rv-663-critic-i1');
  });

  it('ac2: an unreachable owner keeps the last mirrored activity and reports reachable false', async () => {
    root('ur-root');
    await writeRemoteLaneFacts(facts('ur-critic', 'ur-root', 'ur'));
    await writeRemoteLaneMirror('ur-critic', mirror({ activity: 'working', unreachableSince: '2026-11-01T12:01:00.000Z' }));

    const [view] = await listLaneViews({ run: 'ur' }, deps());
    expect(view).toMatchObject({ activity: 'working', machine: { reachable: false, lastSeenAt: '2026-11-01T12:00:06.000Z' } });
  });

  it('derives starting, failed-to-start, stopped and gone activity from the stand-in', async () => {
    root('act-root');
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    await writeRemoteLaneFacts(facts('act-new', 'act-root', 'act'));
    await writeRemoteLaneFacts(facts('act-old', 'act-root', 'act', { key: 'old', createdAt: old }));
    await writeRemoteLaneFacts(facts('act-gone', 'act-root', 'act', { key: 'gone' }));
    await writeRemoteLaneMirror('act-gone', mirror({ state: 'gone', activity: 'working' }));

    const views = await listLaneViews({ run: 'act' }, deps());
    const activity = Object.fromEntries(views.map((view) => [view.name, view.activity]));
    expect(activity).toEqual({ 'act-new': 'starting', 'act-old': 'failed-to-start', 'act-gone': 'stopped' });
  });

  it('ac4: GET /api/lanes/<stand-in name> answers 200 with that lane\'s view', async () => {
    root('get-root');
    await writeRemoteLaneFacts(facts('get-critic', 'get-root', 'get'));
    await writeRemoteLaneMirror('get-critic', mirror());

    const request = HttpServerRequest.fromWeb(new Request('http://localhost/api/lanes/get-critic', {
      method: 'GET',
      headers: { Origin: 'http://localhost:3011' },
    }));
    const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
      HttpRouter.toHttpEffect(lanesRouteLayer),
      (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
    )));
    const payload = (response as { body: { body?: Uint8Array } }).body;
    const json = JSON.parse(new TextDecoder().decode(payload.body)) as { name: string; id: unknown; machine: { label: string } };
    expect((response as { status?: number }).status ?? 200).toBe(200);
    expect(json).toMatchObject({ name: 'get-critic', id: null, machine: { label: 'fly-abc' } });
  });
});

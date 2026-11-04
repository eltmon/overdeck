/**
 * PAN-4938 (PAN-4927 W-DEL1, D-11, D-12): the self lane routes take the lane's
 * parent from the conversation token, never the body.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkerReport } from '../../../lib/agents/worker/report.js';
import type { LaneLaunchRequest } from '../../../lib/lanes/types.js';
import type { LaneView, LaneViewFilter } from '../../../lib/lanes/views.js';
import { laneCursor, waitForLaneSet } from '../../../lib/lanes/wait.js';
import { requiredScopeFor } from '../route-scopes.js';
import { jsonResponse } from '../http-helpers.js';
import type { SelfCallerDeps } from '../self-caller.js';
import type { DashboardCredential } from '../routes/dashboard-auth.js';
import type { FleetCaller } from '../routes/fleet-work.js';
import { handleSelfLaneStart, handleSelfLaneWait, NOT_A_CONVERSATION } from '../routes/self-lanes.js';

const AGENT_TOKEN: DashboardCredential = { kind: 'token', tokenId: 't', scopes: ['operate'], agentId: 'agent-pan-1', agentKind: 'agent', role: 'work' };
const CONVERSATION_TOKEN: DashboardCredential = { kind: 'token', tokenId: 't', scopes: ['operate'], agentId: 'abc', agentKind: 'conversation', role: 'conversation' };

const callerDeps: SelfCallerDeps = {
  getAgentState: (id) => (id === 'agent-pan-1' ? { workspace: '/w/feature-pan-1', issueId: 'PAN-1' } : null),
  getConversationByName: (name) => (name === 'abc' ? { cwd: '/p', tmuxSession: 'conv-abc', issueId: null } : null),
};

function launchStub() {
  return vi.fn(async (_request: LaneLaunchRequest, _context: { viaChannel: boolean; caller: FleetCaller }) =>
    jsonResponse({ conversation: { id: 7, name: 'abc-builder-1' } }, { status: 201 }));
}

describe('POST /api/self/lanes (PAN-4938 D-11)', () => {
  it('an agent-kind caller gets 409 not-a-conversation', async () => {
    const launch = launchStub();
    expect(await handleSelfLaneStart(AGENT_TOKEN, { role: 'builder', brief: 'b', key: 'k' }, false, { caller: callerDeps, launch }))
      .toEqual({ status: 409, body: NOT_A_CONVERSATION });
    expect(launch).not.toHaveBeenCalled();
  });

  it('a conversation launches with itself as parent; body parent and force never reach launch', async () => {
    const launch = launchStub();
    const result = await handleSelfLaneStart(CONVERSATION_TOKEN, { role: 'builder', brief: 'b', key: 'k', parent: 'other', force: true }, true, { caller: callerDeps, launch });
    expect(result).toEqual({ status: 201, body: { conversation: { id: 7, name: 'abc-builder-1' } } });
    const [request, context] = launch.mock.calls[0]!;
    expect(request).toEqual({ role: 'builder', brief: 'b', key: 'k', parent: 'abc' });
    expect(request).not.toHaveProperty('force');
    expect(context).toMatchObject({ viaChannel: true, caller: { actor: 'operator', viaToken: true } });
  });

  it('a missing role is 400 and a plain token is 403', async () => {
    const launch = launchStub();
    expect(await handleSelfLaneStart(CONVERSATION_TOKEN, { brief: 'b', key: 'k' }, false, { caller: callerDeps, launch })).toEqual({ status: 400, body: { error: 'role is required' } });
    expect((await handleSelfLaneStart({ kind: 'token', tokenId: 't', scopes: ['operate'] }, { role: 'builder', brief: 'b', key: 'k' }, false, { caller: callerDeps, launch })).status).toBe(403);
    expect(launch).not.toHaveBeenCalled();
  });

  it('GET /api/lanes and GET /api/lanes/:name need read:state', () => {
    expect(requiredScopeFor('GET', '/api/lanes')).toBe('read:state');
    expect(requiredScopeFor('GET', '/api/lanes/abc-builder-1')).toBe('read:state');
    expect(requiredScopeFor('POST', '/api/self/lanes')).toBe('operate');
  });
});

describe('POST /api/self/lanes/wait (PAN-4938 D-12)', () => {
  const NOW = Date.parse('2026-11-03T12:00:00.000Z');
  const BUILDER = { name: 'abc-builder-1', run: 'r', key: 'k', activity: 'working', lastActivityAt: null } as unknown as LaneView;
  const STOPPED = { name: 'abc-critic-1', run: 'r', key: 'c', activity: 'stopped', lastActivityAt: null } as unknown as LaneView;
  const REPORT: WorkerReport = { seq: 1, at: '2026-11-03T12:00:10.000Z', status: 'done', body: 'Built.' };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(lanes: LaneView[], reports: (name: string) => WorkerReport[]) {
    const listLanes = vi.fn(async (_filter: LaneViewFilter) => lanes);
    const waitSet: typeof waitForLaneSet = (filter, options, deps) =>
      waitForLaneSet(filter, options, { ...deps, listReports: async (id: string) => reports(id.slice('conv-'.length)) });
    return { listLanes, deps: { caller: callerDeps, listLanes, waitSet } };
  }

  it('a conversation waits on the lanes it launched; a report at 10 s answers done with the cursor as next.after', async () => {
    const { listLanes, deps } = setup([BUILDER], (name) => (name === BUILDER.name && Date.now() >= NOW + 10_000 ? [REPORT] : []));
    const pending = handleSelfLaneWait(CONVERSATION_TOKEN, {}, deps);
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;
    const cursor = laneCursor(BUILDER.name, REPORT);
    expect(listLanes).toHaveBeenCalledWith({ parentName: 'abc' });
    expect(result).toEqual({
      status: 200,
      body: { status: 'done', lane: { name: BUILDER.name, run: 'r', key: 'k' }, report: REPORT, cursor, warnings: [], next: { tool: 'lane_wait', arguments: { after: cursor } } },
    });
  });

  it('no report answers running after one 50 s chunk, and a stopped lane that never reported is one warning', async () => {
    const { deps } = setup([BUILDER, STOPPED], () => []);
    let settled = false;
    const pending = handleSelfLaneWait(CONVERSATION_TOKEN, { run: 'r', after: '1.x.1' }, deps).then((result) => { settled = true; return result; });
    await vi.advanceTimersByTimeAsync(49_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await pending).toEqual({
      status: 200,
      body: {
        status: 'running',
        cursor: '1.x.1',
        warnings: ['lane r/c (abc-critic-1) is stopped and never reported'],
        next: { tool: 'lane_wait', arguments: { run: 'r', after: '1.x.1' } },
      },
    });
  });

  it('an agent caller without run gets 409; with run it waits on that run', async () => {
    const { listLanes, deps } = setup([BUILDER], () => [REPORT]);
    expect(await handleSelfLaneWait(AGENT_TOKEN, {}, deps)).toMatchObject({ status: 409, body: { code: 'not-a-conversation' } });
    expect((await handleSelfLaneWait(AGENT_TOKEN, { run: 'r' }, deps)).body).toMatchObject({ status: 'done' });
    expect(listLanes).toHaveBeenCalledWith({ run: 'r' });
  });

  it('a malformed cursor is 400 bad-cursor and timeoutMs above 50000 is 400', async () => {
    const { deps } = setup([BUILDER], () => []);
    expect(await handleSelfLaneWait(CONVERSATION_TOKEN, { after: 'nonsense' }, deps)).toMatchObject({ status: 400, body: { code: 'bad-cursor' } });
    expect(await handleSelfLaneWait(CONVERSATION_TOKEN, { timeoutMs: 50_001 }, deps)).toMatchObject({ status: 400, body: { code: 'bad-timeout' } });
  });
});

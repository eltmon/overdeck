/**
 * PAN-4938 (PAN-4927 W-DEL1): the self worker routes take the worker's issue
 * and parent from the agent token, never the body.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkerFacts } from '../../../lib/agents/worker/facts.js';
import type { WorkerListing } from '../../../lib/agents/worker/list.js';
import type { RemoteStandIn } from '../../../lib/agents/worker/remote-standin.js';
import type { WorkerReport } from '../../../lib/agents/worker/report.js';
import { type WaitOptions, type WaitOutcome, waitForWorkerReport } from '../../../lib/agents/worker/wait.js';

import { jsonResponse } from '../http-helpers.js';
import type { SelfCallerDeps } from '../self-caller.js';
import type { DashboardCredential } from '../routes/dashboard-auth.js';
import type { FleetCaller } from '../routes/fleet-work.js';
import { handleSelfWorkerGet, handleSelfWorkerList, handleSelfWorkerStart, handleSelfWorkerWait, NO_ISSUE, ownedWorker, UNKNOWN_WORKER, workerParentOf } from '../routes/self-workers.js';

const AGENT_TOKEN: DashboardCredential = { kind: 'token', tokenId: 't', scopes: ['operate', 'read:state'], agentId: 'agent-pan-1', agentKind: 'agent', role: 'work' };
const CONVERSATION_TOKEN: DashboardCredential = { kind: 'token', tokenId: 't', scopes: ['operate'], agentId: 'abc', agentKind: 'conversation', role: 'conversation' };

function callerDeps(conversationIssue: string | null = 'PAN-2'): SelfCallerDeps {
  return {
    getAgentState: (id) => (id === 'agent-pan-1' ? { workspace: '/w/feature-pan-1', issueId: 'PAN-1' } : null),
    getConversationByName: (name) => (name === 'abc' ? { cwd: '/p', tmuxSession: 'conv-abc', issueId: conversationIssue } : null),
  };
}

function fleetStub(status = 200, body: unknown = { id: 'agent-pan-1-worker-3', machine: { environmentId: 'env-laptop', label: 'laptop', self: true }, reason: null, remote: false }) {
  return vi.fn(async (_body: Record<string, unknown>, _caller: FleetCaller) => jsonResponse(body, { status }));
}

describe('POST /api/self/workers (PAN-4938 D-1, D-2)', () => {
  it('a plain token gets 403 not-an-agent-token', async () => {
    const startFleetWorker = fleetStub();
    const result = await handleSelfWorkerStart({ kind: 'token', tokenId: 't', scopes: ['operate'] }, { task: 'x' }, { caller: callerDeps(), startFleetWorker });
    expect(result).toMatchObject({ status: 403, body: { code: 'not-an-agent-token' } });
    expect(startFleetWorker).not.toHaveBeenCalled();
  });

  it('an agent caller posts its own issue and id as parent, ignoring body issueId and parentId', async () => {
    const startFleetWorker = fleetStub();
    await handleSelfWorkerStart(AGENT_TOKEN, { task: 'x', issueId: 'PAN-9', parentId: 'evil', model: 'opus', machine: 'auto', needs: ['docker'] }, { caller: callerDeps(), startFleetWorker });
    expect(startFleetWorker).toHaveBeenCalledTimes(1);
    const [body, fleet] = startFleetWorker.mock.calls[0]!;
    expect(body).toEqual({ issueId: 'PAN-1', prompt: 'x', parentId: 'agent-pan-1', model: 'opus', machine: 'auto', needs: ['docker'] });
    expect(fleet).toMatchObject({ actor: { agentId: 'agent-pan-1' }, viaToken: true });
  });

  it('a conversation caller posts its tmux session as parent', async () => {
    const startFleetWorker = fleetStub();
    await handleSelfWorkerStart(CONVERSATION_TOKEN, { task: 'x' }, { caller: callerDeps(), startFleetWorker });
    expect(startFleetWorker.mock.calls[0]![0]).toEqual({ issueId: 'PAN-2', prompt: 'x', parentId: 'conv-abc' });
  });

  it('a conversation without an issue gets 409 no-issue', async () => {
    const startFleetWorker = fleetStub();
    const result = await handleSelfWorkerStart(CONVERSATION_TOKEN, { task: 'x' }, { caller: callerDeps(null), startFleetWorker });
    expect(result).toEqual({ status: 409, body: NO_ISSUE });
    expect(startFleetWorker).not.toHaveBeenCalled();
  });

  it('a missing task is 400 and a non-object body is 400', async () => {
    expect(await handleSelfWorkerStart(AGENT_TOKEN, { task: '  ' }, { caller: callerDeps(), startFleetWorker: fleetStub() })).toEqual({ status: 400, body: { error: 'task is required' } });
    expect(await handleSelfWorkerStart(AGENT_TOKEN, null, { caller: callerDeps(), startFleetWorker: fleetStub() })).toEqual({ status: 400, body: { error: 'body must be an object' } });
  });

  it('a 200 fleet answer becomes workerId plus the task_wait next call', async () => {
    const result = await handleSelfWorkerStart(AGENT_TOKEN, { task: 'x' }, { caller: callerDeps(), startFleetWorker: fleetStub() });
    expect(result).toEqual({
      status: 200,
      body: {
        workerId: 'agent-pan-1-worker-3',
        machine: { environmentId: 'env-laptop', label: 'laptop', self: true },
        remote: false,
        reason: null,
        next: { tool: 'task_wait', arguments: { workerId: 'agent-pan-1-worker-3' } },
      },
    });
  });

  it('a fleet refusal passes through unchanged', async () => {
    const result = await handleSelfWorkerStart(AGENT_TOKEN, { task: 'x' }, { caller: callerDeps(), startFleetWorker: fleetStub(404, { code: 'unknown-machine', error: 'No linked machine is called desk' }) });
    expect(result).toEqual({ status: 404, body: { code: 'unknown-machine', error: 'No linked machine is called desk' } });
  });

  it('workerParentOf: an agent is its id; a conversation its tmux session, or conv-<name> without one', () => {
    expect(workerParentOf({ agentId: 'agent-pan-1', agentKind: 'agent', role: 'work', cwd: '/w', issueId: 'PAN-1', tmuxSession: null })).toBe('agent-pan-1');
    expect(workerParentOf({ agentId: 'abc', agentKind: 'conversation', role: null, cwd: '/p', issueId: null, tmuxSession: 'conv-abc' })).toBe('conv-abc');
    expect(workerParentOf({ agentId: 'abc', agentKind: 'conversation', role: null, cwd: '/p', issueId: null, tmuxSession: null })).toBe('conv-abc');
  });
});

const NOW = Date.parse('2026-11-03T12:00:00.000Z');
const MINE = 'agent-pan-1-worker-1';
const THEIRS = 'agent-pan-1-worker-2';
const REMOTE = 'agent-pan-1-worker-3';

function facts(id: string, parentId: string, startedAt: string): WorkerFacts {
  return { id, issueId: 'PAN-1', parentId, readOnly: false, cwd: '/w', branch: null, name: null, startedAt };
}

function standIn(parentId: string, createdAt: string): RemoteStandIn {
  return {
    v: 1, environmentId: 'env-desk', label: 'desk', remoteId: 'agent-pan-1-worker-9', parentId, issueId: 'PAN-1', createdAt,
    state: 'running', lastSeq: 0, lastSeenAt: null, lastAssistantMessage: null, idleAgeMs: null, unreachableSince: null,
  };
}

function ownership(launchedAt = new Date(NOW - 5 * 60_000).toISOString()) {
  return {
    caller: callerDeps(),
    readFacts: async (id: string) => (id === MINE ? facts(MINE, 'AGENT-PAN-1', launchedAt) : id === THEIRS ? facts(THEIRS, 'agent-pan-7', launchedAt) : null),
    readStandIn: async (id: string) => (id === REMOTE ? standIn('agent-pan-1', launchedAt) : null),
    now: () => NOW,
  };
}

const REPORT: WorkerReport = { seq: 1, at: '2026-11-03T12:00:10.000Z', status: 'done', body: 'All green.' };

describe('GET /api/self/workers/:id/wait (PAN-4938 D-3, D-5)', () => {
  it('another parent\'s worker and an unknown id both answer 404 unknown-worker', async () => {
    const wait = vi.fn();
    for (const id of [THEIRS, 'agent-pan-1-worker-77', 'not-a-worker']) {
      expect(await handleSelfWorkerWait(AGENT_TOKEN, id, null, null, undefined, { ...ownership(), wait })).toEqual({ status: 404, body: UNKNOWN_WORKER });
    }
    expect(wait).not.toHaveBeenCalled();
  });

  it('a stand-in whose remote.json names the caller is owned; parent ids compare case-insensitively', async () => {
    const deps = ownership();
    const caller = { agentId: 'agent-pan-1', agentKind: 'agent' as const, role: 'work', cwd: '/w', issueId: 'PAN-1', tmuxSession: null };
    expect(await ownedWorker(REMOTE, caller, deps)).toMatchObject({ id: REMOTE, remote: { environmentId: 'env-desk' } });
    expect(await ownedWorker(MINE, caller, deps)).toMatchObject({ id: MINE, remote: null });
  });

  it('timeoutMs above 50000 and a malformed afterSeq are 400', async () => {
    expect(await handleSelfWorkerWait(AGENT_TOKEN, MINE, null, '50001', undefined, ownership())).toMatchObject({ status: 400, body: { code: 'bad-timeout' } });
    expect(await handleSelfWorkerWait(AGENT_TOKEN, MINE, '-1', null, undefined, ownership())).toMatchObject({ status: 400, body: { code: 'bad-after-seq' } });
  });

  it('passes a timeout of at most 50 s and a startup grace measured from the worker launch', async () => {
    const wait = vi.fn(async (_id: string, _options: WaitOptions): Promise<WaitOutcome> => ({ kind: 'timeout' }));
    await handleSelfWorkerWait(AGENT_TOKEN, MINE, null, null, undefined, { ...ownership(), wait });
    expect(wait.mock.calls[0]![1]).toMatchObject({ timeoutMs: 50_000, startupGraceMs: 0 });
    await handleSelfWorkerWait(AGENT_TOKEN, MINE, null, '2000', undefined, { ...ownership(new Date(NOW - 10_000).toISOString()), wait });
    expect(wait.mock.calls[1]![1]).toMatchObject({ timeoutMs: 2_000, startupGraceMs: 50_000 });
  });

  it('a timeout answers running with next, carrying afterSeq when one was given', async () => {
    const wait = async (): Promise<WaitOutcome> => ({ kind: 'timeout' });
    expect(await handleSelfWorkerWait(AGENT_TOKEN, MINE, '3', null, undefined, { ...ownership(), wait })).toEqual({
      status: 200,
      body: { status: 'running', workerId: MINE, next: { tool: 'task_wait', arguments: { workerId: MINE, afterSeq: 3 } } },
    });
    expect((await handleSelfWorkerWait(AGENT_TOKEN, MINE, null, null, undefined, { ...ownership(), wait })).body)
      .toMatchObject({ next: { arguments: { workerId: MINE } } });
  });

  describe('with the real waitForWorkerReport', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    function realWait(fakes: { reports: () => WorkerReport[]; alive: () => boolean }) {
      return (id: string, options: WaitOptions) => waitForWorkerReport(id, options, {
        listReports: async () => fakes.reports(),
        isAlive: async () => (fakes.alive() ? { alive: true, paneAlive: true } : { alive: false, reason: 'no-session' }),
        idleAgeMs: () => 0,
        fetchLastAssistantMessage: async () => 'I stopped.',
        resolveTranscriptPath: async () => null,
      });
    }

    it('a worker launched 5 minutes ago that is dead without a report answers ended at once', async () => {
      const deps = { ...ownership(), now: () => Date.now(), wait: realWait({ reports: () => [], alive: () => false }) };
      const result = await handleSelfWorkerWait(AGENT_TOKEN, MINE, null, null, undefined, deps);
      expect(result).toEqual({
        status: 200,
        body: { status: 'ended', workerId: MINE, kind: 'exited-without-report', lastAssistantMessage: 'I stopped.', transcriptPath: null },
      });
    });

    it('a live worker without a report answers running after one 50 s chunk', async () => {
      const deps = { ...ownership(), now: () => Date.now(), wait: realWait({ reports: () => [], alive: () => true }) };
      let settled = false;
      const pending = handleSelfWorkerWait(AGENT_TOKEN, MINE, null, null, undefined, deps).then((result) => { settled = true; return result; });
      await vi.advanceTimersByTimeAsync(49_000);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1_000);
      expect((await pending).body).toMatchObject({ status: 'running', workerId: MINE });
    });

    it('a report appearing at 10 s answers done', async () => {
      const deps = { ...ownership(), now: () => Date.now(), wait: realWait({ reports: () => (Date.now() >= NOW + 10_000 ? [REPORT] : []), alive: () => true }) };
      const pending = handleSelfWorkerWait(AGENT_TOKEN, MINE, null, null, undefined, deps);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await pending).toEqual({ status: 200, body: { status: 'done', workerId: MINE, report: REPORT } });
    });
  });
});

describe('GET /api/self/workers and /api/self/workers/:id (PAN-4938 D-6)', () => {
  const OTHER = 'agent-pan-7-worker-1';
  function readDeps() {
    const launched = new Date(NOW - 60_000).toISOString();
    return {
      ...ownership(launched),
      // listWorkers filters by parent itself; the stub honours the filter like the real one.
      listWorkers: async (filter: { parentId?: string } = {}): Promise<WorkerListing[]> => [
        { id: MINE, facts: facts(MINE, 'agent-pan-1', launched), latestReport: REPORT },
        { id: OTHER, facts: facts(OTHER, 'agent-pan-7', launched), latestReport: null },
      ].filter((listing) => listing.facts.parentId.toLowerCase() === filter.parentId?.toLowerCase()),
      listStandIns: async () => [
        { localId: REMOTE, standIn: { ...standIn('agent-pan-1', launched), idleAgeMs: 4_000 } },
        { localId: 'agent-pan-7-worker-2', standIn: standIn('agent-pan-7', launched) },
      ],
      isAlive: async (): Promise<{ alive: false; reason: 'no-session' }> => ({ alive: false, reason: 'no-session' }),
      idleAgeMs: () => null,
      latestReport: async (id: string) => (id === MINE ? REPORT : null),
    };
  }

  it('the list holds the caller\'s local worker and stand-in only, with an exited local state and no report body', async () => {
    const result = await handleSelfWorkerList(AGENT_TOKEN, readDeps());
    expect(result.status).toBe(200);
    const workers = (result.body as { workers: Array<Record<string, unknown>> }).workers;
    expect(workers.map((worker) => worker.id)).toEqual([MINE, REMOTE]);
    expect(workers[0]).toEqual({
      id: MINE, issueId: 'PAN-1', name: null, startedAt: new Date(NOW - 60_000).toISOString(), remote: null, state: 'exited', idleAgeMs: null,
      latestReport: { seq: 1, at: REPORT.at, status: 'done' },
    });
    expect(workers[0]!['latestReport']).not.toHaveProperty('body');
    expect(workers[1]).toMatchObject({ id: REMOTE, remote: { environmentId: 'env-desk', label: 'desk' }, state: 'running', idleAgeMs: 4_000, latestReport: null });
  });

  it('GET one worker answers its entry, and 404 for another parent\'s worker', async () => {
    expect((await handleSelfWorkerGet(AGENT_TOKEN, MINE, readDeps())).body).toMatchObject({ id: MINE, state: 'exited' });
    expect(await handleSelfWorkerGet(AGENT_TOKEN, THEIRS, readDeps())).toEqual({ status: 404, body: UNKNOWN_WORKER });
  });

  it('a plain token is refused 403', async () => {
    expect((await handleSelfWorkerList({ kind: 'token', tokenId: 't', scopes: ['read:state'] }, readDeps())).status).toBe(403);
  });
});

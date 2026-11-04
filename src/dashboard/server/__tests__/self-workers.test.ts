/**
 * PAN-4938 (PAN-4927 W-DEL1): the self worker routes take the worker's issue
 * and parent from the agent token, never the body.
 */
import { describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../http-helpers.js';
import type { SelfCallerDeps } from '../self-caller.js';
import type { DashboardCredential } from '../routes/dashboard-auth.js';
import type { FleetCaller } from '../routes/fleet-work.js';
import { handleSelfWorkerStart, NO_ISSUE, workerParentOf } from '../routes/self-workers.js';

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

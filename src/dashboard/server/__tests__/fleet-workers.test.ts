/** PAN-4651 WI-12 (D-4651-5, D-4651-12): starting a worker on any machine. */
import { describe, expect, it, vi } from 'vitest';

import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import { fleetCaller, type FleetWorkerDeps, handleFleetIssueStart, handleFleetWorker, handleFleetWorkerStop } from '../routes/fleet-work.js';
import { readJsonResponse } from '../routes/machines-work.js';
import type { FleetTarget } from '../services/fleet-target.js';

const DESK = { id: 'link-desk', environmentId: 'env-desk', label: 'desk', revokedAt: null } as MachineLink;
const REMOTE: FleetTarget = { ok: true, self: false, link: DESK, environmentId: 'env-desk', label: 'desk', reason: null };

function deps(target: FleetTarget, peer: { status: number; json: unknown } = { status: 200, json: { id: 'agent-pan-9-worker-4', cwd: '/w', branch: null } }) {
  const value: FleetWorkerDeps = {
    resolveTarget: vi.fn(async () => target),
    projectOrigin: () => null,
    thisLabel: async () => 'laptop',
    createLocal: vi.fn(),
    fetchPeer: vi.fn(async () => peer),
    refreshLinked: vi.fn(),
    issueOrigin: async (issueId) => (issueId.toUpperCase().startsWith('PAN-') ? { gitOrigin: 'github.com/eltmon/overdeck', projectKey: 'overdeck' } : null),
    startLocal: vi.fn(async () => ({ id: 'agent-pan-9-worker-1' })),
    allocate: vi.fn(async () => 'agent-pan-9-worker-2'),
    writeStandIn: vi.fn(async () => undefined),
    dropStandIn: vi.fn(async () => undefined),
    follow: vi.fn(),
    now: () => new Date('2026-11-01T12:00:00.000Z'),
  };
  return value;
}

const BODY = { machine: 'desk', issueId: 'PAN-9', prompt: 'Run the suite.', parentId: 'agent-pan-9', readOnly: true };

describe('POST /api/fleet/workers (D-4651-5)', () => {
  it('a remote target creates a stand-in, calls the worker door and starts following', async () => {
    const d = deps(REMOTE);
    const answer = readJsonResponse(await handleFleetWorker(BODY, { actor: { agentId: 'agent-pan-9' } }, d));
    expect(answer).toEqual({ status: 200, body: { id: 'agent-pan-9-worker-2', machine: { environmentId: 'env-desk', label: 'desk', self: false }, reason: null, remote: true } });
    expect(d.fetchPeer).toHaveBeenCalledWith('env-desk', '/api/machines/work/workers', expect.objectContaining({
      body: { issueId: 'PAN-9', prompt: 'Run the suite.', readOnly: true, gitOrigin: 'github.com/eltmon/overdeck', parentId: 'agent-pan-9' },
      actor: { agentId: 'agent-pan-9' },
    }));
    expect(d.writeStandIn).toHaveBeenCalledWith('agent-pan-9-worker-2', expect.objectContaining({
      environmentId: 'env-desk', remoteId: 'agent-pan-9-worker-4', parentId: 'agent-pan-9', state: 'running', lastSeq: 0,
    }));
    expect(d.follow).toHaveBeenCalledWith('agent-pan-9-worker-2');
  });

  it('a self target starts the worker locally with its parent', async () => {
    const d = deps({ ok: true, self: true, environmentId: 'env-laptop', label: 'laptop', reason: 'Auto → laptop (CPU pressure 1%, 8 GB free, 0 agents)' });
    const answer = readJsonResponse(await handleFleetWorker({ ...BODY, machine: 'auto' }, { actor: 'operator' }, d));
    expect(answer.body).toMatchObject({ id: 'agent-pan-9-worker-1', remote: false, reason: 'Auto → laptop (CPU pressure 1%, 8 GB free, 0 agents)' });
    expect(d.startLocal).toHaveBeenCalledWith(expect.objectContaining({ issueId: 'PAN-9', parentId: 'agent-pan-9', readOnly: true }));
    expect(d.allocate).not.toHaveBeenCalled();
  });

  it('a refused door drops the stand-in and passes the refusal through', async () => {
    const d = deps(REMOTE, { status: 404, json: { code: 'project-missing', gitOrigin: 'github.com/eltmon/overdeck', machine: 'desk' } });
    const answer = readJsonResponse(await handleFleetWorker(BODY, { actor: 'operator' }, d));
    expect(answer.status).toBe(404);
    expect(d.dropStandIn).toHaveBeenCalledWith('agent-pan-9-worker-2');
    expect(d.writeStandIn).not.toHaveBeenCalled();
    expect(d.follow).not.toHaveBeenCalled();
  });

  it('stops a stand-in through its owner and marks it stopped; a local id answers 404', async () => {
    const standIn = {
      v: 1 as const, environmentId: 'env-desk', label: 'desk', remoteId: 'agent-pan-9-worker-4', parentId: null, issueId: 'PAN-9', createdAt: 'x',
      state: 'running' as const, lastSeq: 1, lastSeenAt: null, lastAssistantMessage: null, idleAgeMs: null, unreachableSince: null,
    };
    const write = vi.fn(async () => undefined);
    const fetchPeer = vi.fn(async () => ({ status: 200, json: { stopped: true } }));
    const answer = readJsonResponse(await handleFleetWorkerStop('agent-pan-9-worker-2', { actor: 'operator' }, { read: async () => standIn, write, fetchPeer }));
    expect(answer).toEqual({ status: 200, body: { stopped: true } });
    expect(fetchPeer).toHaveBeenCalledWith('env-desk', '/api/workers/agent-pan-9-worker-4/stop', expect.objectContaining({ method: 'POST', actor: 'operator' }));
    expect(write).toHaveBeenCalledWith('agent-pan-9-worker-2', { ...standIn, state: 'stopped' });
    expect(readJsonResponse(await handleFleetWorkerStop('agent-pan-9-worker-1', { actor: 'operator' }, { read: async () => null, write, fetchPeer })).status).toBe(404);
  });

  it('starts an issue on a linked machine through its door; this machine answers use-local-start', async () => {
    const d = deps(REMOTE, { status: 200, json: { issueId: 'PAN-9', agentId: 'agent-pan-9' } });
    const answer = readJsonResponse(await handleFleetIssueStart('PAN-9', { machine: 'desk', model: 'claude-opus-5-5' }, { actor: 'operator' }, d));
    expect(answer).toEqual({ status: 200, body: { issueId: 'PAN-9', agentId: 'agent-pan-9', machine: { environmentId: 'env-desk', label: 'desk', self: false }, reason: null } });
    expect(d.fetchPeer).toHaveBeenCalledWith('env-desk', '/api/machines/work/issues/PAN-9/start', expect.objectContaining({ body: { model: 'claude-opus-5-5', gitOrigin: 'github.com/eltmon/overdeck' } }));
    const self = readJsonResponse(await handleFleetIssueStart('PAN-9', {}, { actor: 'operator' }, deps({ ok: true, self: true, environmentId: 'env-laptop', label: 'laptop', reason: null })));
    expect(self).toMatchObject({ status: 400, body: { code: 'use-local-start' } });
    const missing = readJsonResponse(await handleFleetIssueStart('PAN-9', { machine: 'desk' }, { actor: 'operator' }, deps(REMOTE, { status: 404, json: { code: 'project-missing', gitOrigin: 'github.com/eltmon/overdeck' } })));
    expect((missing.body as { error: string }).error).toBe('desk has no project for github.com/eltmon/overdeck. Add it with: pan machines add-project laptop overdeck --to desk');
  });

  it('ac4 (PAN-4743): resolveTarget receives no spawn argument for machine: fly', async () => {
    const dWorker = deps(REMOTE);
    await handleFleetWorker({ ...BODY, machine: 'fly' }, { actor: 'operator' }, dWorker);
    expect(dWorker.resolveTarget).toHaveBeenCalledWith('fly', 'github.com/eltmon/overdeck', []);

    const dIssueStart = deps(REMOTE, { status: 200, json: { issueId: 'PAN-9', agentId: 'agent-pan-9' } });
    await handleFleetIssueStart('PAN-9', { machine: 'fly' }, { actor: 'operator' }, dIssueStart);
    expect(dIssueStart.resolveTarget).toHaveBeenCalledWith('fly', 'github.com/eltmon/overdeck', []);
  });
});

describe('fleetCaller (PAN-4938 D-9, D-10)', () => {
  it('an agent-kind token acts as its agent; a plain token as the operator; both carry viaToken', () => {
    expect(fleetCaller({ kind: 'token', tokenId: 'k', scopes: ['operate'], agentId: 'agent-pan-1', agentKind: 'agent', role: 'work' }, undefined))
      .toMatchObject({ actor: { agentId: 'agent-pan-1' }, ceiling: ['operate'], viaToken: true });
    expect(fleetCaller({ kind: 'token', tokenId: 'k', scopes: ['operate'] }, undefined))
      .toMatchObject({ actor: 'operator', ceiling: ['operate'], viaToken: true });
  });

  it('no credential with an operator sender carries no viaToken', () => {
    const caller = fleetCaller(null, 'conv-operator-123');
    expect(caller).toEqual({ actor: 'operator', mayCreateFly: false });
    expect(caller).not.toHaveProperty('viaToken');
  });
});

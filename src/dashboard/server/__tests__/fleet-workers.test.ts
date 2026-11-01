/** PAN-4651 WI-12 (D-4651-5, D-4651-12): starting a worker on any machine. */
import { describe, expect, it, vi } from 'vitest';

import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import { type FleetWorkerDeps, handleFleetWorker, handleFleetWorkerStop } from '../routes/fleet-work.js';
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
    issueOrigin: async (issueId) => (issueId.toUpperCase().startsWith('PAN-') ? { gitOrigin: 'github.com/eltmon/overdeck' } : null),
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
});

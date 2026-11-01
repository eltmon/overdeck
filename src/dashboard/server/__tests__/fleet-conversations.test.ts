/** PAN-4651 WI-10 (D-4651-12): starting a conversation on any machine. */
import { describe, expect, it, vi } from 'vitest';

import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import { fleetCaller, type FleetSpawnDeps, handleFleetConversation } from '../routes/fleet-work.js';
import { readJsonResponse } from '../routes/machines-work.js';
import type { FleetTarget } from '../services/fleet-target.js';

const DESK = { id: 'link-desk', environmentId: 'env-desk', label: 'desk', revokedAt: null } as MachineLink;

function deps(target: FleetTarget, peer: { status: number; json: unknown } = { status: 201, json: { name: 'conv-9' } }) {
  const value: FleetSpawnDeps = {
    resolveTarget: vi.fn(async () => target),
    projectOrigin: (key) => (key === 'overdeck' ? { gitOrigin: 'github.com/eltmon/overdeck' } : key === 'scratch' ? { gitOrigin: null } : null),
    thisLabel: async () => 'laptop',
    createLocal: vi.fn(async () => ({ status: 201, body: { name: 'conv-local' } })),
    fetchPeer: vi.fn(async () => peer),
    refreshLinked: vi.fn(async () => undefined),
  };
  return value;
}

const SELF: FleetTarget = { ok: true, self: true, environmentId: 'env-laptop', label: 'laptop', reason: null };
const REMOTE: FleetTarget = { ok: true, self: false, link: DESK, environmentId: 'env-desk', label: 'desk', reason: null };

describe('POST /api/fleet/conversations (D-4651-12)', () => {
  it('a self target creates the conversation locally', async () => {
    const d = deps(SELF);
    const answer = readJsonResponse(await handleFleetConversation({ message: 'hi', projectKey: 'overdeck', model: 'claude-opus-5-5' }, { actor: 'operator' }, d));
    expect(answer).toEqual({ status: 201, body: { conversation: 'conv-local', machine: { environmentId: 'env-laptop', label: 'laptop', self: true }, reason: null } });
    expect(d.createLocal).toHaveBeenCalledWith({ message: 'hi', model: 'claude-opus-5-5', projectKey: 'overdeck' });
    expect(d.fetchPeer).not.toHaveBeenCalled();
  });

  it('ac10: a remote target posts the work door with the slug, answers @<env>/<name> and lists it at once', async () => {
    const d = deps(REMOTE);
    const answer = readJsonResponse(await handleFleetConversation({ machine: 'desk', message: 'hi', projectKey: 'overdeck', effort: 'high' }, { actor: { agentId: 'agent-pan-7' } }, d));
    expect(answer).toEqual({ status: 201, body: { conversation: '@env-desk/conv-9', machine: { environmentId: 'env-desk', label: 'desk', self: false }, reason: null } });
    expect(d.resolveTarget).toHaveBeenCalledWith('desk', 'github.com/eltmon/overdeck', []);
    expect(d.fetchPeer).toHaveBeenCalledWith('env-desk', '/api/machines/work/conversations', expect.objectContaining({
      method: 'POST', body: { effort: 'high', message: 'hi', gitOrigin: 'github.com/eltmon/overdeck' }, actor: { agentId: 'agent-pan-7' },
    }));
    expect(d.refreshLinked).toHaveBeenCalledTimes(1);
  });

  it('auto answers the placement reason', async () => {
    const d = deps({ ...REMOTE, reason: 'Auto → desk (CPU pressure 3%, 41 GB free, 2 agents)' });
    const answer = readJsonResponse(await handleFleetConversation({ machine: 'auto', needs: ['docker'], message: 'hi' }, { actor: 'operator' }, d));
    expect(answer.body).toMatchObject({ conversation: '@env-desk/conv-9', reason: 'Auto → desk (CPU pressure 3%, 41 GB free, 2 agents)' });
    expect(d.resolveTarget).toHaveBeenCalledWith('auto', null, ['docker']);
  });

  it('a project-missing from the owner passes through as 404 with the add-project hint', async () => {
    const d = deps(REMOTE, { status: 404, json: { code: 'project-missing', gitOrigin: 'github.com/eltmon/overdeck', machine: 'desk', error: 'desk has no project for github.com/eltmon/overdeck' } });
    const answer = readJsonResponse(await handleFleetConversation({ machine: 'desk', message: 'hi', projectKey: 'overdeck' }, { actor: 'operator' }, d));
    expect(answer.status).toBe(404);
    expect(answer.body).toMatchObject({
      code: 'project-missing',
      error: 'desk has no project for github.com/eltmon/overdeck. Add it with: pan machines add-project laptop overdeck --to desk',
    });
    expect(d.refreshLinked).not.toHaveBeenCalled();
  });

  it('an owner without work doors answers peer-too-old; a target refusal passes through', async () => {
    const old = readJsonResponse(await handleFleetConversation({ machine: 'desk', message: 'hi' }, { actor: 'operator' }, deps(REMOTE, { status: 404, json: { error: 'Not Found' } })));
    expect(old).toMatchObject({ status: 409, body: { code: 'peer-too-old' } });
    const refused = readJsonResponse(await handleFleetConversation({ machine: 'fly', message: 'hi' }, { actor: 'operator' },
      deps({ ok: false, status: 400, body: { code: 'fly-unavailable', error: 'Fly (new VM) needs PAN-4652' } })));
    expect(refused).toEqual({ status: 400, body: { code: 'fly-unavailable', error: 'Fly (new VM) needs PAN-4652' } });
  });

  it('refuses an unknown project and a remote start of a project without a repository slug', async () => {
    expect(readJsonResponse(await handleFleetConversation({ message: 'hi', projectKey: 'nope' }, { actor: 'operator' }, deps(REMOTE))).status).toBe(404);
    expect(readJsonResponse(await handleFleetConversation({ message: 'hi', projectKey: 'scratch' }, { actor: 'operator' }, deps(REMOTE))))
      .toMatchObject({ status: 409, body: { code: 'project-has-no-origin' } });
  });

  it('a token credential forwards as operator with a ceiling of its scopes; a sender maps to its agent', () => {
    expect(fleetCaller({ kind: 'token', tokenId: 'k', scopes: ['read:conversations', 'operate'] }, 'agent-pan-7'))
      .toEqual({ actor: 'operator', ceiling: ['read:conversations', 'operate'] });
    expect(fleetCaller({ kind: 'root-session' }, 'agent-pan-7')).toEqual({ actor: { agentId: 'agent-pan-7' } });
    expect(fleetCaller({ kind: 'root-session' }, undefined)).toEqual({ actor: 'operator' });
  });
});

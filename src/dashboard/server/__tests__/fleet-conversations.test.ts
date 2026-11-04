/** PAN-4651 WI-10 (D-4651-12): starting a conversation on any machine. */
import { describe, expect, it, vi } from 'vitest';

import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import { fleetCaller, type FleetSpawnDeps, handleFleetConversation } from '../routes/fleet-work.js';
import { readJsonResponse } from '../routes/machines-work.js';
import { FLY_CONVERSATIONS_ONLY, type FleetTarget } from '../services/fleet-target.js';

const DESK = { id: 'link-desk', environmentId: 'env-desk', label: 'desk', revokedAt: null } as MachineLink;
const FLY_LINK = { id: 'link-fly', environmentId: 'env-fly', label: 'fly-m1', revokedAt: null } as MachineLink;

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

/** A fresh Fly (new VM) target with its own `discard` spy (PAN-4743). */
function flyTarget() {
  const discard = vi.fn(async () => undefined);
  const target: FleetTarget = { ok: true, self: false, link: FLY_LINK, environmentId: 'env-fly', label: 'fly-m1', reason: 'Fly (new VM) → fly-m1 (iad)', discard };
  return { target, discard };
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
    expect(d.resolveTarget).toHaveBeenCalledWith('desk', 'github.com/eltmon/overdeck', [], { projectKey: 'overdeck', mayCreate: false });
    expect(d.fetchPeer).toHaveBeenCalledWith('env-desk', '/api/machines/work/conversations', expect.objectContaining({
      method: 'POST', body: { effort: 'high', message: 'hi', gitOrigin: 'github.com/eltmon/overdeck' }, actor: { agentId: 'agent-pan-7' },
    }));
    expect(d.refreshLinked).toHaveBeenCalledTimes(1);
  });

  it('auto answers the placement reason', async () => {
    const d = deps({ ...REMOTE, reason: 'Auto → desk (CPU pressure 3%, 41 GB free, 2 agents)' });
    const answer = readJsonResponse(await handleFleetConversation({ machine: 'auto', needs: ['docker'], message: 'hi' }, { actor: 'operator' }, d));
    expect(answer.body).toMatchObject({ conversation: '@env-desk/conv-9', reason: 'Auto → desk (CPU pressure 3%, 41 GB free, 2 agents)' });
    expect(d.resolveTarget).toHaveBeenCalledWith('auto', null, ['docker'], { projectKey: null, mayCreate: false });
  });

  it('ac1 (PAN-4743): an admin caller creates a Fly conversation with a spawn context and the Fly reason', async () => {
    const { target } = flyTarget();
    const d = deps(target);
    const answer = readJsonResponse(await handleFleetConversation({ machine: 'fly', message: 'hi', projectKey: 'overdeck' }, { actor: 'operator', mayCreateFly: true }, d));
    expect(answer).toEqual({ status: 201, body: { conversation: '@env-fly/conv-9', machine: { environmentId: 'env-fly', label: 'fly-m1', self: false }, reason: 'Fly (new VM) → fly-m1 (iad)' } });
    expect(d.resolveTarget).toHaveBeenCalledWith('fly', 'github.com/eltmon/overdeck', [], { projectKey: 'overdeck', mayCreate: true });
  });

  it('ac2 (PAN-4743): a work-door refusal discards the Fly machine once; a 503 machine-unreachable keeps it and names the label', async () => {
    const { target: refusedTarget, discard: refusedDiscard } = flyTarget();
    const dRefuse = deps(refusedTarget, { status: 404, json: { error: 'Not Found' } });
    const refusal = readJsonResponse(await handleFleetConversation({ machine: 'fly', message: 'hi', projectKey: 'overdeck' }, { actor: 'operator', mayCreateFly: true }, dRefuse));
    expect(refusal).toMatchObject({ status: 409, body: { code: 'peer-too-old' } });
    expect(refusedDiscard).toHaveBeenCalledTimes(1);

    const { target: unreachableTarget, discard: unreachableDiscard } = flyTarget();
    const dUnreachable = deps(unreachableTarget, { status: 503, json: { code: 'machine-unreachable', error: 'fly-m1: did not answer within 30 s' } });
    const unreachable = readJsonResponse(await handleFleetConversation({ machine: 'fly', message: 'hi', projectKey: 'overdeck' }, { actor: 'operator', mayCreateFly: true }, dUnreachable));
    expect(unreachable).toEqual({
      status: 503,
      body: { code: 'machine-unreachable', error: 'fly-m1 (new Fly machine) did not answer in time; it is still linked. Open it from the conversation list, or remove it with pan machines unlink fly-m1.' },
    });
    expect(unreachableDiscard).not.toHaveBeenCalled();
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
      deps({ ok: false, status: 400, body: { code: 'fly-unavailable', error: FLY_CONVERSATIONS_ONLY } })));
    expect(refused).toEqual({ status: 400, body: { code: 'fly-unavailable', error: FLY_CONVERSATIONS_ONLY } });
  });

  it('refuses an unknown project and a remote start of a project without a repository slug', async () => {
    expect(readJsonResponse(await handleFleetConversation({ message: 'hi', projectKey: 'nope' }, { actor: 'operator' }, deps(REMOTE))).status).toBe(404);
    expect(readJsonResponse(await handleFleetConversation({ message: 'hi', projectKey: 'scratch' }, { actor: 'operator' }, deps(REMOTE))))
      .toMatchObject({ status: 409, body: { code: 'project-has-no-origin' } });
  });

  it('a token credential forwards as operator with a ceiling of its scopes; a sender maps to its agent', () => {
    expect(fleetCaller({ kind: 'token', tokenId: 'k', scopes: ['read:conversations', 'operate'] }, 'agent-pan-7'))
      .toEqual({ actor: 'operator', ceiling: ['read:conversations', 'operate'], mayCreateFly: false, viaToken: true });
    expect(fleetCaller({ kind: 'root-session' }, 'agent-pan-7')).toEqual({ actor: { agentId: 'agent-pan-7' }, mayCreateFly: true });
    expect(fleetCaller({ kind: 'root-session' }, undefined)).toEqual({ actor: 'operator', mayCreateFly: true });
  });

  it('ac3 (PAN-4743): mayCreateFly is true for an internal-token credential, false for an odk_ token with only operate', () => {
    expect(fleetCaller({ kind: 'internal-token' }, undefined)).toEqual({ actor: 'operator', mayCreateFly: true });
    expect(fleetCaller({ kind: 'token', tokenId: 'k', scopes: ['operate'] }, undefined)).toEqual({ actor: 'operator', ceiling: ['operate'], mayCreateFly: false, viaToken: true });
  });
});

/**
 * PAN-4938 (PAN-4927 W-DEL1, D-11, D-12): the self lane routes take the lane's
 * parent from the conversation token, never the body.
 */
import { describe, expect, it, vi } from 'vitest';

import type { LaneLaunchRequest } from '../../../lib/lanes/types.js';
import { requiredScopeFor } from '../route-scopes.js';
import { jsonResponse } from '../http-helpers.js';
import type { SelfCallerDeps } from '../self-caller.js';
import type { DashboardCredential } from '../routes/dashboard-auth.js';
import type { FleetCaller } from '../routes/fleet-work.js';
import { handleSelfLaneStart, NOT_A_CONVERSATION } from '../routes/self-lanes.js';

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

/**
 * PAN-4650 WI-6: on the owner, an agent on a linked machine reads conversations
 * but never changes them (D-4650-7), and a machine credential arriving over a
 * channel cannot use the linked-conversation proxy prefix (no chained hops).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Option } from 'effect';
import { HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  _resetAccessTokensForTests,
  _settleAccessTokenWritesForTests,
  createAccessToken,
  MACHINE_TOKEN_SCOPES,
} from '../../../lib/access-tokens.js';
import { _resetInternalTokenCacheForTests } from '../../../lib/internal-token.js';
import { invalidateRemoteAccessConfig } from '../../../lib/remote-access/config.js';
import type { ChannelMarker } from '../channel-peer.js';
import { linkActorFence } from '../link-fence.js';
import { remoteGateRejection } from '../remote-request-gate.js';
import { _resetDashboardSessionTokenForTests, type DashboardCredential } from '../routes/dashboard-auth.js';

const KEY = 'd4'.repeat(32);
const LINK: ChannelMarker = { mode: 'link', remoteKeyHex: KEY, pairingId: null };
const originalHome = process.env.OVERDECK_HOME;

let home: string;
let token: string;

function request(method: string, path: string, actor: string) {
  return HttpServerRequest.fromWeb(new Request(`http://dashboard.test${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'x-overdeck-link-actor': actor },
  })).modify({ remoteAddress: Option.some(`link:${KEY.slice(0, 16)}`) });
}

function machine(actor: DashboardCredential extends infer C ? C extends { kind: 'machine'; actor: infer A } ? A : never : never): DashboardCredential {
  return { kind: 'machine', tokenId: 't', environmentId: 'env-laptop', scopes: MACHINE_TOKEN_SCOPES('operator'), actor, access: 'operator' };
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4650-link-fence-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = 'link-fence-internal-token';
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetAccessTokensForTests();
  invalidateRemoteAccessConfig();
  token = (await createAccessToken({
    name: 'machine:laptop', kind: 'machine', scopes: MACHINE_TOKEN_SCOPES('operator'),
    machineKey: KEY, environmentId: 'env-laptop', access: 'operator',
  })).token;
});

afterEach(async () => {
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('agent fence (PAN-4650 D-4650-7)', () => {
  it('ac5: an agent actor gets 403 agent-fenced on a message POST and passes on a messages GET', () => {
    expect(remoteGateRejection(request('POST', '/api/conversations/x/message', 'agent:agent-pan-1'), LINK)).toEqual({ status: 403, code: 'agent-fenced' });
    expect(remoteGateRejection(request('GET', '/api/conversations/x/messages', 'agent:agent-pan-1'), LINK)).toBeNull();
  });

  it('lets the operator actor change conversations', () => {
    expect(remoteGateRejection(request('POST', '/api/conversations/x/message', 'operator'), LINK)).toBeNull();
    expect(remoteGateRejection(request('POST', '/api/conversations/x/stop', 'operator'), LINK)).toBeNull();
  });

  it('ac4: a machine credential over a channel cannot use the proxy prefix (admin only)', () => {
    expect(remoteGateRejection(request('POST', '/api/conversations/@desk/conv-x/message', 'operator'), LINK)).toEqual({ status: 403, missingScope: 'admin' });
    expect(remoteGateRejection(request('GET', '/api/conversations/%40desk%2Fconv-x/messages', 'operator'), LINK)).toEqual({ status: 403, missingScope: 'admin' });
  });

  it('fences agent actors from terminals, forwards and conversation writes only', () => {
    const agent = machine({ agentId: 'agent-pan-1' });
    expect(linkActorFence(agent, 'GET', '/ws/terminal')).toBe('agent-fenced');
    expect(linkActorFence(agent, 'GET', '/ws/forward')).toBe('agent-fenced');
    expect(linkActorFence(agent, 'POST', '/api/conversations')).toBe('agent-fenced');
    expect(linkActorFence(agent, 'DELETE', '/api/conversations/x/scheduled-messages/1')).toBe('agent-fenced');
    expect(linkActorFence(agent, 'HEAD', '/api/conversations/x')).toBeNull();
    expect(linkActorFence(agent, 'POST', '/api/lanes')).toBeNull();
    expect(linkActorFence(machine('operator'), 'GET', '/ws/terminal')).toBeNull();
    expect(linkActorFence({ kind: 'root-session' }, 'POST', '/api/conversations/x/message')).toBeNull();
  });
});

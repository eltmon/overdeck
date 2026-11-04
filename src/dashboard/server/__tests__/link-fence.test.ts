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
import { closeOverdeckDatabase } from '../../../lib/overdeck/infra.js';
import { invalidateRemoteAccessConfig } from '../../../lib/remote-access/config.js';
import type { ChannelMarker } from '../channel-peer.js';
import { linkActorFence } from '../link-fence.js';
import { chainedHopRefusal } from '../linked-conversation-proxy.js';
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
  closeOverdeckDatabase();
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
  closeOverdeckDatabase();
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

  it('FR-3: lets the operator actor reach the remote-control reads and writes of a conversation', () => {
    for (const [method, path] of [
      ['GET', '/api/conversations/x/attachments/shot.png'],
      ['GET', '/api/conversations/x/tool-body/toolu_1'],
      ['GET', '/api/conversations/x/diffs/full'],
      ['POST', '/api/conversations/x/switch-model'],
      ['POST', '/api/conversations/x/compact'],
      ['POST', '/api/conversations/x/resume'],
      ['POST', '/api/conversations/x/upload-image'],
    ] as const) {
      expect(remoteGateRejection(request(method, path, 'operator'), LINK), `${method} ${path}`).toBeNull();
    }
    expect(remoteGateRejection(request('POST', '/api/conversations/x/compact', 'agent:agent-pan-1'), LINK)).toEqual({ status: 403, code: 'agent-fenced' });
  });

  it('ac4: a machine credential over a channel cannot use the proxy prefix (PAN-4651: the proxy refuses, no-chained-hops)', () => {
    // PAN-4651 D-4651-17: the gate now judges the prefix by its inner route, so the
    // proxy's own channel check is what stops a hop to a third machine.
    expect(remoteGateRejection(request('POST', '/api/conversations/@desk/conv-x/message', 'operator'), LINK)).toBeNull();
    expect(remoteGateRejection(request('GET', '/api/conversations/%40desk%2Fconv-x/messages', 'operator'), LINK)).toBeNull();
    expect(chainedHopRefusal(LINK)?.status).toBe(403);
    expect(chainedHopRefusal(null)).toBeNull();
  });

  it('fences agent actors from terminals, forwards and conversation writes only', () => {
    const agent = machine({ agentId: 'agent-pan-1' });
    expect(linkActorFence(agent, 'GET', '/ws/terminal')).toBe('agent-fenced');
    expect(linkActorFence(agent, 'GET', '/ws/forward')).toBe('agent-fenced');
    expect(linkActorFence(agent, 'POST', '/api/conversations')).toBe('agent-fenced');
    expect(linkActorFence(agent, 'DELETE', '/api/conversations/x/scheduled-messages/1')).toBe('agent-fenced');
    expect(linkActorFence(agent, 'HEAD', '/api/conversations/x')).toBeNull();
    expect(linkActorFence(agent, 'POST', '/api/lanes')).toBe('agent-fenced');
    expect(linkActorFence(machine('operator'), 'GET', '/ws/terminal')).toBeNull();
    expect(linkActorFence({ kind: 'root-session' }, 'POST', '/api/conversations/x/message')).toBeNull();
  });
});

describe('provenance fence (PAN-4651 D-4651-2)', () => {
  const startedBy: Record<string, string> = { 'conv-a': 'env-laptop', 'conv-c': 'env-desk' };
  const deps = { conversationStartedBy: (name: string) => startedBy[name] ?? null };
  const agentOf = (environmentId: string): DashboardCredential => ({
    kind: 'machine', tokenId: 't', environmentId, scopes: MACHINE_TOKEN_SCOPES('operator'), actor: { agentId: 'agent-pan-1' }, access: 'operator',
  });

  it('ac1: an agent actor changes only conversations its own machine started', () => {
    expect(linkActorFence(agentOf('env-laptop'), 'POST', '/api/conversations/conv-a/message', deps)).toBeNull();
    expect(linkActorFence(agentOf('env-laptop'), 'POST', '/api/conversations/conv-a/stop', deps)).toBeNull();
    expect(linkActorFence(agentOf('env-other'), 'POST', '/api/conversations/conv-a/message', deps)).toBe('agent-fenced');
    expect(linkActorFence(agentOf('env-laptop'), 'POST', '/api/conversations/conv-c/message', deps)).toBe('agent-fenced');
    expect(linkActorFence(agentOf('env-laptop'), 'POST', '/api/conversations/conv-b/message', deps)).toBe('agent-fenced');
    expect(linkActorFence(agentOf('env-laptop'), 'DELETE', '/api/conversations', deps)).toBe('agent-fenced');
    expect(linkActorFence(agentOf('env-laptop'), 'POST', '/api/conversations/@desk/conv-a/message', deps)).toBe('agent-fenced');
  });

  it('ac2: work-door creates pass; bare creates, the project door, terminals and forwards stay refused', () => {
    const agent = agentOf('env-laptop');
    expect(linkActorFence(agent, 'POST', '/api/machines/work/conversations', deps)).toBeNull();
    expect(linkActorFence(agent, 'POST', '/api/machines/work/workers', deps)).toBeNull();
    expect(linkActorFence(agent, 'POST', '/api/machines/work/issues/PAN-7/start', deps)).toBeNull();
    expect(linkActorFence(agent, 'POST', '/api/workers/agent-pan-7-w1/stop', deps)).toBeNull();
    expect(linkActorFence(agent, 'POST', '/api/machines/work/projects', deps)).toBe('agent-fenced');
    expect(linkActorFence(agent, 'POST', '/api/conversations', deps)).toBe('agent-fenced');
    expect(linkActorFence(agent, 'POST', '/api/workers', deps)).toBe('agent-fenced');
    expect(linkActorFence(agent, 'POST', '/api/lanes', deps)).toBe('agent-fenced');
    expect(linkActorFence(agent, 'GET', '/ws/terminal', deps)).toBe('agent-fenced');
    expect(linkActorFence(agent, 'GET', '/ws/forward', deps)).toBe('agent-fenced');
  });

  it('PAN-4638 FR-11: an agent actor may not reap a lane here; the owner lane doors pass', () => {
    const agent = agentOf('env-laptop');
    expect(linkActorFence(agent, 'POST', '/api/lanes/x/reap', deps)).toBe('agent-fenced');
    expect(linkActorFence(agent, 'GET', '/api/lanes/x', deps)).toBeNull();
    expect(linkActorFence(agent, 'POST', '/api/machines/work/lanes', deps)).toBeNull();
    expect(linkActorFence(agent, 'POST', '/api/machines/work/lanes/x/reap', deps)).toBeNull();
    expect(linkActorFence(agent, 'GET', '/api/machines/work/lanes/x/status', deps)).toBeNull();
    expect(linkActorFence(machine('operator'), 'POST', '/api/lanes/x/reap', deps)).toBeNull();
  });

  it('PAN-4638: an agent actor stops only lanes its own machine started', () => {
    expect(linkActorFence(agentOf('env-laptop'), 'POST', '/api/lanes/conv-a/stop', deps)).toBeNull();
    expect(linkActorFence(agentOf('env-laptop'), 'POST', '/api/lanes/a/stop', { conversationStartedBy: (name) => (name === 'a' ? 'env-laptop' : null) })).toBeNull();
    expect(linkActorFence(agentOf('env-other'), 'POST', '/api/lanes/conv-a/stop', deps)).toBe('agent-fenced');
    expect(linkActorFence(agentOf('env-laptop'), 'POST', '/api/lanes/unknown-lane/stop', deps)).toBe('agent-fenced');
    expect(linkActorFence(machine('operator'), 'POST', '/api/lanes/unknown-lane/stop', deps)).toBeNull();
  });

  it('ac3: an operator actor keeps every right, provenance or not', () => {
    const operator = machine('operator');
    expect(linkActorFence(operator, 'POST', '/api/conversations/conv-b/message', deps)).toBeNull();
    expect(linkActorFence(operator, 'POST', '/api/conversations', deps)).toBeNull();
    expect(linkActorFence(operator, 'POST', '/api/machines/work/projects', deps)).toBeNull();
  });

  it('fails closed when the provenance read throws', () => {
    const broken = { conversationStartedBy: () => { throw new Error('db unavailable'); } };
    expect(linkActorFence(agentOf('env-laptop'), 'POST', '/api/conversations/conv-a/message', broken)).toBe('agent-fenced');
  });

  it('the remote request gate reads the provenance door by default', async () => {
    const { createConversation } = await import('../../../lib/overdeck/conversations.js');
    const { markConversationStartedBy } = await import('../../../lib/overdeck/conversation-provenance.js');
    createConversation({ name: 'conv-linked', tmuxSession: 'conv-linked', cwd: home, harness: 'claude-code' });
    markConversationStartedBy('conv-linked', 'env-laptop');
    expect(remoteGateRejection(request('POST', '/api/conversations/conv-linked/message', 'agent:agent-pan-1'), LINK)).toBeNull();
    expect(remoteGateRejection(request('POST', '/api/conversations/conv-unstamped/message', 'agent:agent-pan-1'), LINK)).toEqual({ status: 403, code: 'agent-fenced' });
  });
});

/**
 * PAN-4651 WI-28 (D-4651-17): an `odk_` token reaches a linked conversation
 * within its own scopes, the owner receives that ceiling, a channel caller
 * gets no-chained-hops, and an operator browser request is unchanged.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Option } from 'effect';
import { HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken } from '../../../lib/access-tokens.js';
import type { LinkForwardInit } from '../../../lib/anywhere/link-client.js';
import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import { _resetInternalTokenCacheForTests } from '../../../lib/internal-token.js';
import { invalidateRemoteAccessConfig } from '../../../lib/remote-access/config.js';
import { chainedHopRefusal, forwardLinkedConversationRequest, parseLinkedConversationPath } from '../linked-conversation-proxy.js';
import { remoteGateRejection } from '../remote-request-gate.js';
import { _resetDashboardSessionTokenForTests } from '../routes/dashboard-auth.js';

const originalHome = process.env.OVERDECK_HOME;
let home: string;

const DESK = { id: 'link-desk', environmentId: 'env-desk', label: 'desk', revokedAt: null } as MachineLink;

function tokenRequest(token: string, method: string, path: string) {
  return HttpServerRequest.fromWeb(new Request(`http://dashboard.test${path}`, { method, headers: { authorization: `Bearer ${token}` } }))
    .modify({ remoteAddress: Option.some('198.51.100.9') });
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4651-proxy-token-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = 'proxy-token-internal';
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetAccessTokensForTests();
  invalidateRemoteAccessConfig();
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

describe('linked conversation proxy for tokens (D-4651-17)', () => {
  it('ac28: a read:conversations token reads a linked conversation and is refused POST …/message (insufficient_scope tell)', async () => {
    const { token } = await createAccessToken({ name: 'mcp', kind: 'token', scopes: ['read:conversations'] });
    expect(remoteGateRejection(tokenRequest(token, 'GET', '/api/conversations/@desk/conv-a/messages'), null)).toBeNull();
    expect(remoteGateRejection(tokenRequest(token, 'POST', '/api/conversations/@desk/conv-a/message'), null)).toEqual({ status: 403, missingScope: 'tell' });
  });

  it('ac28: with tell, the POST reaches the owner as operator with x-overdeck-link-ceiling of the token\'s scopes', async () => {
    const forward = vi.fn(async (_env: string, _init: LinkForwardInit) => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from('{"ok":true}') }));
    const target = parseLinkedConversationPath('/api/conversations/@desk/conv-a/message')!;
    const response = await forwardLinkedConversationRequest(
      { method: 'POST', target, query: '', contentType: 'application/json', body: Buffer.from('{"message":"hi"}'), credential: { kind: 'token', tokenId: 'k', scopes: ['read:conversations', 'tell'] } },
      { getLink: async () => DESK, forward },
    );
    expect(response.status).toBe(200);
    expect(forward.mock.calls[0]![1]).toMatchObject({ actor: 'operator', ceiling: ['read:conversations', 'tell'] });
  });

  it('ac28: an operator browser request is unchanged (no ceiling)', async () => {
    const forward = vi.fn(async (_env: string, _init: LinkForwardInit) => ({ status: 200, headers: {}, body: Buffer.from('{}') }));
    await forwardLinkedConversationRequest(
      { method: 'GET', target: parseLinkedConversationPath('/api/conversations/@desk/conv-a/messages')!, query: '', credential: { kind: 'root-session' } },
      { getLink: async () => DESK, forward },
    );
    expect(forward.mock.calls[0]![1].actor).toBe('operator');
    expect(forward.mock.calls[0]![1]).not.toHaveProperty('ceiling');
  });

  it('ac28: a channel request to the prefix answers 403 no-chained-hops', async () => {
    const refused = chainedHopRefusal({ mode: 'link', remoteKeyHex: 'aa'.repeat(32), pairingId: null });
    expect(refused?.status).toBe(403);
  });
});

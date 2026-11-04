/**
 * PAN-4938 WI-2 (PAN-4927 D-9): an agent-kind agent token reaches a linked
 * conversation as its agent; a conversation token and a plain token reach it
 * as the operator. Every token keeps its scopes as the ceiling.
 */
import { describe, expect, it, vi } from 'vitest';

import type { LinkForwardInit } from '../../../lib/anywhere/link-client.js';
import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import { forwardLinkedConversationRequest, parseLinkedConversationPath, tokenLinkActor } from '../linked-conversation-proxy.js';
import type { DashboardCredential } from '../routes/dashboard-auth.js';

const DESK = { id: 'link-desk', environmentId: 'env-desk', label: 'desk', revokedAt: null } as MachineLink;

async function forwardedInit(credential: DashboardCredential): Promise<LinkForwardInit> {
  const forward = vi.fn(async (_env: string, _init: LinkForwardInit) => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from('{"ok":true}') }));
  const response = await forwardLinkedConversationRequest(
    {
      method: 'POST',
      target: parseLinkedConversationPath('/api/conversations/@desk/conv-a/message')!,
      query: '',
      contentType: 'application/json',
      body: Buffer.from('{"message":"hi"}'),
      credential,
    },
    { getLink: async () => DESK, forward },
  );
  expect(response.status).toBe(200);
  return forward.mock.calls[0]![1];
}

describe('linked conversation proxy for agent tokens (PAN-4927 D-9)', () => {
  it('an agent-kind token forwards as { agentId } with its scopes as the ceiling', async () => {
    const init = await forwardedInit({ kind: 'token', tokenId: 'k', scopes: ['read:state', 'tell', 'operate'], agentId: 'agent-pan-1', agentKind: 'agent', role: 'work' });
    expect(init).toMatchObject({ actor: { agentId: 'agent-pan-1' }, ceiling: ['read:state', 'tell', 'operate'] });
  });

  it('a conversation-kind token forwards as the operator', async () => {
    const init = await forwardedInit({ kind: 'token', tokenId: 'k', scopes: ['tell'], agentId: 'abc', agentKind: 'conversation' });
    expect(init).toMatchObject({ actor: 'operator', ceiling: ['tell'] });
  });

  it('a plain token forwards as the operator', async () => {
    const init = await forwardedInit({ kind: 'token', tokenId: 'k', scopes: ['tell', 'admin'] });
    expect(init).toMatchObject({ actor: 'operator', ceiling: ['tell'] });
  });

  it('tokenLinkActor needs both agentKind agent and an agentId', () => {
    expect(tokenLinkActor({ kind: 'token', tokenId: 'k', scopes: [], agentKind: 'agent' })).toBe('operator');
    expect(tokenLinkActor({ kind: 'token', tokenId: 'k', scopes: [], agentId: 'agent-pan-2', agentKind: 'agent' })).toEqual({ agentId: 'agent-pan-2' });
  });
});

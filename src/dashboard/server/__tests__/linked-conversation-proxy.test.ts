/**
 * PAN-4650 WI-6: /api/conversations/@<machine>/<name>/… forwards to the owner's
 * /api/conversations/<name>/… through the link with the right actor, passes the
 * owner's answer back unchanged, and maps an unavailable link to 503.
 */
import { HttpServerResponse } from 'effect/unstable/http';
import { describe, expect, it, vi } from 'vitest';

import {
  linkForward,
  LinkUnavailableError,
  type LinkForwardInit,
  type LinkForwardResponse,
  type LinkRouteSource,
} from '../../../lib/anywhere/link-client.js';
import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import {
  actorForSender,
  forwardLinkedConversationRequest,
  parseLinkedConversationPath,
  type LinkedProxyDeps,
} from '../linked-conversation-proxy.js';

const ENV = '6f1c0000-0000-4000-8000-000000000001';

function link(): MachineLink {
  return {
    id: 'link-desk', environmentId: ENV, label: 'desk', machineKey: 'ab'.repeat(32), token: `odk_${'9'.repeat(64)}`, access: 'operator',
    reverseTokenId: null, routes: [], createdAt: '2026-11-01T00:00:00.000Z', revokedAt: null,
  };
}

function deps(answer: LinkForwardResponse | Error): LinkedProxyDeps & { forward: ReturnType<typeof vi.fn> } {
  return {
    getLink: async (key) => (key === 'desk' || key === ENV ? link() : null),
    forward: vi.fn(async (_env: string, _init: LinkForwardInit) => {
      if (answer instanceof Error) throw answer;
      return answer;
    }),
  };
}

const JSON_OK: LinkForwardResponse = { status: 202, headers: { 'content-type': 'application/json' }, body: Buffer.from('{"ok":true}') };

describe('linked conversation proxy (PAN-4650 WI-6)', () => {
  it('ac1: a message POST reaches the owner path as operator and the answer comes back unchanged', async () => {
    const target = parseLinkedConversationPath('/api/conversations/@desk/conv-x/message')!;
    const d = deps(JSON_OK);
    const response = await forwardLinkedConversationRequest(
      { method: 'POST', target, query: '', contentType: 'application/json', body: Buffer.from('{"message":"hi"}') },
      d,
    );

    expect(d.forward).toHaveBeenCalledWith(ENV, {
      method: 'POST',
      path: '/api/conversations/conv-x/message',
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"message":"hi"}'),
      actor: 'operator',
    });
    expect(response.status).toBe(202);
    expect(await HttpServerResponse.toWeb(response).text()).toBe('{"ok":true}');
  });

  it('ac2: the percent-encoded form resolves to the same owner path and keeps the query', async () => {
    expect(parseLinkedConversationPath(`/api/conversations/%40${ENV}%2Fconv-x/messages`)).toEqual({ target: ENV, ownerName: 'conv-x', rest: '/messages' });
    expect(parseLinkedConversationPath(`/api/conversations/%40${ENV}/conv-x/messages`)).toEqual({ target: ENV, ownerName: 'conv-x', rest: '/messages' });
    const d = deps(JSON_OK);
    await forwardLinkedConversationRequest({ method: 'GET', target: parseLinkedConversationPath(`/api/conversations/%40${ENV}%2Fconv-x/messages`)!, query: '?before=9&limit=75' }, d);
    expect(d.forward.mock.calls[0]![1]).toMatchObject({ method: 'GET', path: '/api/conversations/conv-x/messages?before=9&limit=75' });
  });

  it('passes an image through with its bytes and content-type', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);
    const d = deps({ status: 200, headers: { 'content-type': 'image/png' }, body: png });
    const response = await forwardLinkedConversationRequest(
      { method: 'GET', target: parseLinkedConversationPath('/api/conversations/@desk/conv-x/attachments/shot%201.png')!, query: '' },
      d,
    );
    expect(d.forward.mock.calls[0]![1]).toMatchObject({ path: '/api/conversations/conv-x/attachments/shot%201.png' });
    const web = HttpServerResponse.toWeb(response);
    expect(web.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await web.arrayBuffer())).toEqual(png);
  });

  it('ac3: an offline link answers 503 machine-offline, from linkForward itself', async () => {
    const offline: LinkRouteSource = {
      routeFor: () => ({ state: 'offline', url: null, machineKey: 'ab'.repeat(32), token: 'odk_x', label: 'desk' }),
      waitOnline: async () => false,
      localKey: async () => { throw new Error('unused'); },
    };
    const d: LinkedProxyDeps = { getLink: async () => link(), forward: (env, init) => linkForward(env, { ...init, routeSource: offline }) };
    const response = await forwardLinkedConversationRequest({ method: 'GET', target: parseLinkedConversationPath('/api/conversations/@desk/conv-x/about')!, query: '' }, d);
    expect(response.status).toBe(503);
    expect(JSON.parse(await HttpServerResponse.toWeb(response).text())).toMatchObject({ code: 'machine-offline' });
  });

  it('answers 503 no-link for an unknown or revoked machine and never forwards', async () => {
    const d = deps(JSON_OK);
    const response = await forwardLinkedConversationRequest({ method: 'GET', target: parseLinkedConversationPath('/api/conversations/@nowhere/conv-x')!, query: '' }, d);
    expect(response.status).toBe(503);
    expect(d.forward).not.toHaveBeenCalled();
    const unreachable = deps(new LinkUnavailableError('machine-unreachable', 'desk did not answer'));
    const failed = await forwardLinkedConversationRequest({ method: 'GET', target: parseLinkedConversationPath('/api/conversations/@desk/conv-x')!, query: '' }, unreachable);
    expect(JSON.parse(await HttpServerResponse.toWeb(failed).text())).toMatchObject({ code: 'machine-unreachable' });
  });

  it('ignores local names and refuses dot segments', () => {
    expect(parseLinkedConversationPath('/api/conversations/conv-x/message')).toBeNull();
    expect(parseLinkedConversationPath('/api/conversations/@desk')).toBeNull();
    expect(parseLinkedConversationPath('/api/conversations/@desk/conv-x/../../machines/self')).toBeNull();
    expect(parseLinkedConversationPath('/api/conversations/@desk/conv-x/%2E%2E/x')).toBeNull();
  });

  it('maps senders to actors (D-4650-6)', () => {
    expect(actorForSender(undefined)).toBe('operator');
    expect(actorForSender('conv-operator-4242')).toBe('operator');
    expect(actorForSender('conv-20261101-1234')).toBe('operator');
    expect(actorForSender('agent-pan-4650')).toEqual({ agentId: 'agent-pan-4650' });
    expect(actorForSender('bad sender!')).toBeNull();
  });
});

/** PAN-4650 WI-8: linked conversations stream, route and answer by their linked name. */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../wsTransport', () => {
  class FakeTransport {
    disposed = false;
    constructor(readonly url?: string, readonly pool?: unknown) {}
    dispose() { this.disposed = true; }
  }
  const defaultTransport = new FakeTransport();
  return {
    WsTransport: FakeTransport,
    getTransport: () => defaultTransport,
    rpcUrlWithPath: (path: string) => `ws://dashboard.test${path}`,
  };
});
vi.mock('../apiFetch', () => ({
  fetchWithTimeout: vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
}));

const { getTransport } = await import('../wsTransport');
const { fetchWithTimeout } = await import('../apiFetch');
const {
  conversationApiName,
  conversationRouteKey,
  findLinkedConversationRow,
  isLinkedConversation,
  resetLinkedTransportsForTests,
  terminalWsPathFor,
  transportForConversation,
} = await import('../linkedConversation');
const { buildPendingAnswerRequest } = await import('../pendingInputAnswer');
const { answerConversationPaneChoice } = await import('../paneChoice');

const LINKED = { id: -4, name: '@env-desk/conv-x', origin: 'linked' as const };

afterEach(() => resetLinkedTransportsForTests());

describe('linked conversations (PAN-4650 WI-8)', () => {
  it('ac1: a linked name streams over its machine transport with the owner name; a local name uses the default', () => {
    const linked = transportForConversation('@env-desk/conv-x');
    expect((linked.transport as unknown as { url: string }).url).toBe('ws://dashboard.test/ws/linked/env-desk/rpc');
    expect(linked.subscribeName).toBe('conv-x');
    expect(transportForConversation('@env-desk/conv-y').transport).toBe(linked.transport);

    const local = transportForConversation('conv-y');
    expect(local.transport).toBe(getTransport());
    expect(local.subscribeName).toBe('conv-y');
  });

  it('replaces a failed machine transport through its own pool, never the default', () => {
    const first = transportForConversation('@env-desk/conv-x').transport as unknown as {
      pool: { current(): unknown; reset(failed: unknown): void };
      disposed: boolean;
    };
    first.pool.reset(first);
    expect(first.disposed).toBe(true);
    const next = first.pool.current();
    expect(next).not.toBe(first);
    expect(next).not.toBe(getTransport());
  });

  it('routes and names a linked row by its linked name, a local row by its id', () => {
    expect(isLinkedConversation(LINKED)).toBe(true);
    expect(conversationRouteKey(LINKED)).toBe('@env-desk/conv-x');
    expect(conversationRouteKey({ id: 12, name: 'conv-local' })).toBe('12');
    expect(conversationApiName(LINKED)).toBe('@env-desk/conv-x');
    expect(terminalWsPathFor('@env-desk/conv-x')).toBe('/ws/linked/env-desk/terminal');
    expect(terminalWsPathFor('conv-local')).toBeNull();
  });

  it('ac3: codex-approval and pane-choice URLs carry the linked name, never the negative id', async () => {
    const request = buildPendingAnswerRequest({
      kind: 'conv', id: conversationApiName(LINKED), answers: ['2. Allow'], toolUseId: 'codex-approval:abc',
    });
    expect('url' in request && request.url).toBe(`/api/conversations/${encodeURIComponent('@env-desk/conv-x')}/codex-approval`);

    await answerConversationPaneChoice(conversationApiName(LINKED), 1, 'sig');
    const url = vi.mocked(fetchWithTimeout).mock.calls[0]![0] as string;
    expect(url).toBe(`/api/conversations/${encodeURIComponent('@env-desk/conv-x')}/pane-choice`);
    expect(url).not.toContain('-4');
  });
});

describe('findLinkedConversationRow', () => {
  const rows = [
    { name: 'conv-9', origin: 'local' as const },
    { name: '@env-a/conv-9', origin: 'linked' as const, machineLabel: 'laptop', remoteName: 'conv-9' },
    { name: 'conv-looks-linked', origin: 'local' as const, machineLabel: 'laptop', remoteName: 'conv-9' },
  ];

  it('returns the row whose name is the exact linked key', () => {
    expect(findLinkedConversationRow(rows, '@env-a/conv-9')).toBe(rows[1]);
  });

  it('falls back to the linked row matching the machine label and owner name', () => {
    expect(findLinkedConversationRow(rows, '@laptop/conv-9')).toBe(rows[1]);
  });

  it('returns null for a local key even when a row of that name exists', () => {
    expect(findLinkedConversationRow(rows, 'conv-9')).toBeNull();
  });

  it('returns null when no row matches the linked key', () => {
    expect(findLinkedConversationRow(rows, '@env-b/conv-9')).toBeNull();
  });

  it('ignores a non-linked row that carries a matching machineLabel and remoteName', () => {
    expect(findLinkedConversationRow(rows, '@laptop/conv-9')).not.toBe(rows[2]);
  });
});

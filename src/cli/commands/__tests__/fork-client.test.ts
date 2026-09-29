/**
 * forkConversationViaServer always stamps callerKind on the POST body, and
 * forwards allowPrimary only when the caller passed it (PAN-4338). Every
 * call uses { pollMs: 0, timeoutMs: 50 } so a resolved-immediately conv
 * never waits on a real multi-second poll.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forkConversationViaServer } from '../fork-client.js';

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  const conversation = { id: 1, name: 'n', tmuxSession: 't', forkStatus: null };
  fetchMock = vi.fn(async (url: string) =>
    url.includes('/summary-fork') ? jsonResponse({ conversation }) : jsonResponse(conversation));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function postBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.find(([url]: [string]) => url.includes('/summary-fork'));
  return JSON.parse((call![1] as RequestInit).body as string) as Record<string, unknown>;
}

describe('forkConversationViaServer (PAN-4338)', () => {
  it('POSTs allowPrimary and the explicit callerKind', async () => {
    await forkConversationViaServer(
      'source',
      { forkMode: 'summary', allowPrimary: true, callerKind: 'operator' },
      { pollMs: 0, timeoutMs: 50 },
    );
    expect(postBody()).toMatchObject({ allowPrimary: true, callerKind: 'operator' });
  });

  it('omits allowPrimary and still stamps callerKind when neither is requested', async () => {
    await forkConversationViaServer('source', { forkMode: 'summary' }, { pollMs: 0, timeoutMs: 50 });
    const body = postBody();
    expect(body).not.toHaveProperty('allowPrimary');
    expect(typeof body['callerKind']).toBe('string');
  });

  it('POSTs callerKind agent as given, without forcing allowPrimary', async () => {
    await forkConversationViaServer(
      'source',
      { forkMode: 'summary', callerKind: 'agent' },
      { pollMs: 0, timeoutMs: 50 },
    );
    const body = postBody();
    expect(body).not.toHaveProperty('allowPrimary');
    expect(body['callerKind']).toBe('agent');
  });
});

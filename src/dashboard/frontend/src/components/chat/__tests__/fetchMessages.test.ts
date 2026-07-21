/**
 * PAN-2908 follow-up: a 404 on an agent conversation's /messages means "no
 * saved history" (queued specialist, wiped workspace, cleaned session file) —
 * not an incident. It resolves to an empty payload (the honest empty state),
 * while real user conversations keep the failure card + Retry.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMessages } from '../ConversationPanel';

function stubFetch(status: number, body: unknown = {}) {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(body, { status })));
}

describe('fetchMessages · agent 404 means no saved history', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('resolves an empty payload for a known agent with no transcript (404)', async () => {
    stubFetch(404, { error: 'not found' });
    const data = await fetchMessages('agent-queued-1', undefined, 'agent-queued-1');
    expect(data).toEqual({ messages: [], workLog: [], streaming: false });
  });

  it('still throws for a real conversation 404 (history may genuinely be in trouble)', async () => {
    stubFetch(404, { error: 'not found' });
    await expect(fetchMessages('conv-20260720-1234')).rejects.toThrow('Failed to fetch messages');
  });

  it('still throws for non-404 failures even for agents', async () => {
    stubFetch(500, { error: 'boom' });
    await expect(fetchMessages('agent-queued-1', undefined, 'agent-queued-1')).rejects.toThrow('Failed to fetch messages');
  });
});

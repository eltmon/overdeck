/** Agent-backed panels have a dedicated transcript route and surface misses. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMessages } from '../ConversationPanel';

function stubFetch(status: number, body: unknown = {}) {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(body, { status })));
}

describe('fetchMessages · agent transcript route', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the agent route and preserves a transcript miss for rendering', async () => {
    stubFetch(404, { error: 'No transcript found for agent-queued-1.', checked: ['/tmp/older.jsonl'] });
    const data = await fetchMessages('agent-queued-1', undefined, 'agent-queued-1');
    expect(fetch).toHaveBeenCalledWith('/api/agents/agent-queued-1/conversation', expect.any(Object));
    expect(data).toEqual({
      messages: [],
      workLog: [],
      streaming: false,
      error: 'No transcript found for agent-queued-1.',
      checked: ['/tmp/older.jsonl'],
    });
  });

  it('still throws for a real conversation 404 (history may genuinely be in trouble)', async () => {
    stubFetch(404, { error: 'not found' });
    await expect(fetchMessages('conv-20260720-1234')).rejects.toThrow('Failed to fetch messages');
    expect(fetch).toHaveBeenCalledWith('/api/conversations/conv-20260720-1234/messages', expect.any(Object));
  });

  it('still throws for non-404 failures even for agents', async () => {
    stubFetch(500, { error: 'boom' });
    await expect(fetchMessages('agent-queued-1', undefined, 'agent-queued-1')).rejects.toThrow('Failed to fetch messages');
  });
});

import { describe, expect, it } from 'vitest';
import { applyConversationMessagesEvent } from '../useConversationMessagesStream';

describe('applyConversationMessagesEvent', () => {
  it('replaces cache contents for full snapshots', () => {
    const cache = applyConversationMessagesEvent(
      {
        messages: [{ id: 'old', role: 'user', text: 'old', createdAt: '2026-06-08T00:00:00.000Z' }],
        workLog: [],
        streaming: true,
        discovering: true,
      },
      {
        kind: 'messages',
        snapshot: true,
        messages: [{ id: 'new', role: 'user', text: 'new', createdAt: '2026-06-08T00:00:01.000Z' }],
        workLog: [],
        streaming: false,
      },
    );

    expect(cache.messages.map((message) => message.id)).toEqual(['new']);
    expect(cache.discovering).toBe(false);
  });

  it('merges incremental deltas without dropping prior transcript history', () => {
    const cache = applyConversationMessagesEvent(
      {
        messages: [
          { id: 'm1', role: 'user', text: 'hello', createdAt: '2026-06-08T00:00:00.000Z' },
          { id: 'm2', role: 'assistant', text: 'working', createdAt: '2026-06-08T00:00:01.000Z', streaming: true },
        ],
        workLog: [
          { id: 'w1', createdAt: '2026-06-08T00:00:02.000Z', label: 'Bash', tone: 'tool' },
        ],
        streaming: true,
      },
      {
        kind: 'messages',
        snapshot: false,
        messages: [
          { id: 'm2', role: 'assistant', text: 'done', createdAt: '2026-06-08T00:00:01.000Z', completedAt: '2026-06-08T00:00:03.000Z' },
          { id: 'm3', role: 'user', text: 'next', createdAt: '2026-06-08T00:00:04.000Z' },
        ],
        workLog: [
          { id: 'w1', createdAt: '2026-06-08T00:00:02.000Z', label: 'Bash', tone: 'tool', result: 'ok' },
        ],
        streaming: false,
      },
    );

    expect(cache.messages.map((message) => [message.id, message.text])).toEqual([
      ['m1', 'hello'],
      ['m2', 'done'],
      ['m3', 'next'],
    ]);
    expect(cache.workLog).toEqual([
      { id: 'w1', createdAt: '2026-06-08T00:00:02.000Z', label: 'Bash', tone: 'tool', result: 'ok' },
    ]);
  });
});

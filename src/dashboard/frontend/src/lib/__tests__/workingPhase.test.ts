import { describe, expect, it } from 'vitest';
import { isConversationWorking, TURN_STALL_MS } from '../workingPhase';
import type { ChatMessage, WorkLogEntry } from '../../components/chat/chat-types';

const NOW = Date.parse('2026-08-24T12:00:00.000Z');

function msg(partial: Partial<ChatMessage> & Pick<ChatMessage, 'role'>): ChatMessage {
  return {
    id: 'm',
    text: '',
    createdAt: new Date(NOW - 60_000).toISOString(),
    streaming: false,
    sequence: 1,
    ...partial,
  };
}

function work(overrides: Partial<WorkLogEntry> = {}): WorkLogEntry {
  return {
    id: 'w',
    createdAt: new Date(NOW - 30_000).toISOString(),
    label: 'Shell',
    tone: 'tool',
    sequence: 2,
    ...overrides,
  };
}

describe('isConversationWorking', () => {
  it('returns false when the session is not alive', () => {
    expect(isConversationWorking(false, [msg({ role: 'user' })], [], NOW)).toBe(false);
  });

  it('spins on startup with no transcript at all', () => {
    expect(isConversationWorking(true, [], [], NOW)).toBe(true);
  });

  it('spins while the last message is a recent user prompt', () => {
    const m = msg({ role: 'user', createdAt: new Date(NOW - 5_000).toISOString() });
    expect(isConversationWorking(true, [m], [], NOW)).toBe(true);
  });

  it('does not spin when the last activity is stale beyond the stall window', () => {
    const m = msg({ role: 'user', createdAt: new Date(NOW - TURN_STALL_MS - 1).toISOString() });
    expect(isConversationWorking(true, [m], [], NOW)).toBe(false);
  });

  it('keeps spinning for codex-style narration followed by newer tool activity (PAN-3770)', () => {
    // user prompt → completed-looking agent message → tool call after it
    const messages = [
      msg({ role: 'user', createdAt: new Date(NOW - 40_000).toISOString(), sequence: 1 }),
      msg({ role: 'assistant', createdAt: new Date(NOW - 30_000).toISOString(), completedAt: new Date(NOW - 30_000).toISOString(), sequence: 2 }),
    ];
    const log = [work({ createdAt: new Date(NOW - 10_000).toISOString(), sequence: 3 })];
    expect(isConversationWorking(true, messages, log, NOW)).toBe(true);
  });

  it('goes idle once a final assistant message trails all tool activity', () => {
    const messages = [
      msg({ role: 'user', createdAt: new Date(NOW - 60_000).toISOString(), sequence: 1 }),
      msg({ role: 'assistant', createdAt: new Date(NOW - 5_000).toISOString(), completedAt: new Date(NOW - 5_000).toISOString(), sequence: 3 }),
    ];
    const log = [work({ createdAt: new Date(NOW - 20_000).toISOString(), sequence: 2 })];
    expect(isConversationWorking(true, messages, log, NOW)).toBe(false);
  });

  it('ignores stale tool entries that predate the last message', () => {
    const messages = [
      msg({ role: 'assistant', createdAt: new Date(NOW - 5_000).toISOString(), completedAt: new Date(NOW - 5_000).toISOString() }),
    ];
    const log = [work({ createdAt: new Date(NOW - 120_000).toISOString() })];
    expect(isConversationWorking(true, messages, log, NOW)).toBe(false);
  });

  it('treats fresh tool activity as working when there is no comparable message timestamp', () => {
    const log = [work({ createdAt: new Date(NOW - 10_000).toISOString() })];
    expect(isConversationWorking(true, [], log, NOW)).toBe(true);
  });
});

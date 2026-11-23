import { describe, expect, it } from 'vitest';
import { getPendingToolEntry, getWorkingPhase, isConversationWorking, TURN_STALL_MS } from '../workingPhase';
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

  // PAN-5633: a failed Codex turn writes the user prompt, then a "Turn failed" error row, and no reply.
  it('a trailing error row after a user message is not working', () => {
    const messages = [msg({ role: 'user', createdAt: new Date(NOW - 10_000).toISOString(), sequence: 1 })];
    const log = [work({ tone: 'error', label: 'Turn failed', createdAt: new Date(NOW - 9_000).toISOString(), sequence: 2 })];
    expect(isConversationWorking(true, messages, log, NOW)).toBe(false);
  });

  it('a user message after an error row is working', () => {
    // A new prompt started the next turn.
    const messages = [msg({ role: 'user', createdAt: new Date(NOW - 5_000).toISOString(), sequence: 3 })];
    const log = [work({ tone: 'error', label: 'Turn failed', createdAt: new Date(NOW - 9_000).toISOString(), sequence: 2 })];
    expect(isConversationWorking(true, messages, log, NOW)).toBe(true);
  });

  it('a failed tool row with toolInput mid-turn stays working', () => {
    const messages = [
      msg({ role: 'assistant', createdAt: new Date(NOW - 10_000).toISOString(), completedAt: new Date(NOW - 10_000).toISOString(), sequence: 1 }),
    ];
    const log = [work({ tone: 'error', toolInput: { command: 'x' }, createdAt: new Date(NOW - 5_000).toISOString(), sequence: 2 })];
    expect(isConversationWorking(true, messages, log, NOW)).toBe(true);
  });

  it('an ACP failed tool row without toolInput mid-turn stays working', () => {
    // acp-conversation-parser marks a failed tool call tone 'error' with command/result but no toolInput.
    const messages = [
      msg({ role: 'assistant', createdAt: new Date(NOW - 10_000).toISOString(), completedAt: new Date(NOW - 10_000).toISOString(), sequence: 1 }),
    ];
    const log = [work({ tone: 'error', label: 'Shell', command: 'npm test', result: 'exit 1', createdAt: new Date(NOW - 5_000).toISOString(), sequence: 2 })];
    expect(isConversationWorking(true, messages, log, NOW)).toBe(true);
  });

  it('an ACP Prompt failed row after a user message is not working', () => {
    const messages = [msg({ role: 'user', createdAt: new Date(NOW - 10_000).toISOString(), sequence: 1 })];
    const log = [work({ tone: 'error', label: 'Prompt failed', createdAt: new Date(NOW - 9_000).toISOString(), sequence: 2 })];
    expect(isConversationWorking(true, messages, log, NOW)).toBe(false);
  });
});

describe('elided tool results (PAN-4558)', () => {
  const elided: WorkLogEntry = {
    id: 'toolu_elided', createdAt: '2026-10-19T00:00:00.000Z', label: 'Bash', toolTitle: 'Bash', tone: 'tool',
    resultBytes: 9_000, bodyOmitted: true,
  };
  const pending: WorkLogEntry = { ...elided, id: 'toolu_pending', resultBytes: undefined, bodyOmitted: undefined };

  it('does not treat a tool with resultBytes as pending', () => {
    expect(getPendingToolEntry([elided])).toBeUndefined();
    expect(getPendingToolEntry([pending])?.id).toBe('toolu_pending');
  });

  it('does not report a tool phase for a tool whose result was elided', () => {
    const turn = [{ role: 'assistant' }];
    expect(getWorkingPhase(turn, [pending])).not.toEqual(getWorkingPhase(turn, []));
    expect(getWorkingPhase(turn, [elided])).toEqual(getWorkingPhase(turn, []));
  });
});

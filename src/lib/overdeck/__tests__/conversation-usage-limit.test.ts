/**
 * PAN-4641 WI-3 — a conversation's usage-limit state and the outcome of a
 * scheduled delivery, read from injected transcript tails.
 */
import { describe, expect, it } from 'vitest';

import {
  conversationSupportsScheduledMessages,
  deliveryOutcomeFromTranscriptTail,
  readConversationUsageLimit,
  readDeliveryOutcome,
  type UsageLimitDeps,
} from '../conversation-usage-limit.js';
import type { LegacyConversation } from '../conversations.js';

function conv(overrides: Partial<LegacyConversation> = {}): LegacyConversation {
  return { name: 'conv-x', harness: 'claude-code', origin: 'local', ...overrides } as LegacyConversation;
}

function jsonl(records: ReadonlyArray<unknown>): string {
  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
}

function textOf(text: string): ReadonlyArray<{ type: 'text'; text: string }> {
  return [{ type: 'text', text }];
}

function limitRecord(timestamp: string, resetsAt = 1788354000): Record<string, unknown> {
  return {
    type: 'assistant',
    timestamp,
    isApiErrorMessage: true,
    apiErrorStatus: 429,
    error: 'rate_limit',
    quotaLimits: { status: 'rejected', resetsAt, rateLimitType: 'five_hour' },
    message: { role: 'assistant', content: textOf("You've hit your session limit · resets 9am (America/New_York)") },
  };
}

function reply(timestamp: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: 'assistant', timestamp, message: { role: 'assistant', content: textOf('Done.') }, ...extra };
}

function userRecord(timestamp: string): Record<string, unknown> {
  return { type: 'user', timestamp, message: { role: 'user', content: 'continue' } };
}

function deps(text: string, now: number): UsageLimitDeps {
  return {
    resolveSessionFile: async () => '/fake/session.jsonl',
    readTail: async () => ({ text, cutFirstLine: false }),
    now: () => now,
  };
}

const RESET_MS = 1788354000 * 1000; // 2026-09-02T13:00:00Z

describe('readConversationUsageLimit', () => {
  const tail = jsonl([userRecord('2026-09-02T09:00:00.000Z'), limitRecord('2026-09-02T09:00:05.000Z')]);

  it('reports limited with a future reset', async () => {
    expect(await readConversationUsageLimit(conv(), deps(tail, RESET_MS - 60_000))).toEqual({
      limited: true,
      resetsAt: '2026-09-02T13:00:00.000Z',
      window: 'five_hour',
      source: 'quota-limits',
      errorAt: '2026-09-02T09:00:05.000Z',
    });
  });

  it('reports limited: false once the reset has passed', async () => {
    expect(await readConversationUsageLimit(conv(), deps(tail, RESET_MS + 1)))
      .toMatchObject({ limited: false, resetsAt: '2026-09-02T13:00:00.000Z' });
  });

  it('returns null for a normal last turn', async () => {
    const normal = jsonl([limitRecord('2026-09-02T09:00:05.000Z'), userRecord('2026-09-02T13:01:00.000Z'), reply('2026-09-02T13:01:05.000Z')]);
    expect(await readConversationUsageLimit(conv(), deps(normal, RESET_MS))).toBeNull();
  });

  it('returns null for a codex conversation without reading its transcript', async () => {
    let reads = 0;
    const counting: UsageLimitDeps = { ...deps(tail, RESET_MS), readTail: async () => { reads += 1; return { text: tail, cutFirstLine: false }; } };
    expect(await readConversationUsageLimit(conv({ harness: 'codex' }), counting)).toBeNull();
    expect(reads).toBe(0);
  });

  it('refuses scheduling for codex conversations and vault browse copies', () => {
    expect(conversationSupportsScheduledMessages(conv())).toBe(true);
    expect(conversationSupportsScheduledMessages(conv({ harness: 'codex' }))).toBe(false);
    expect(conversationSupportsScheduledMessages(conv({ origin: 'vault' }))).toBe(false);
  });
});

describe('deliveryOutcomeFromTranscriptTail', () => {
  const sentAtMs = Date.parse('2026-09-02T13:01:00.000Z');

  it('is waiting when only the pasted user record is newer', () => {
    const text = jsonl([limitRecord('2026-09-02T09:00:05.000Z'), userRecord('2026-09-02T13:01:01.000Z')]);
    expect(deliveryOutcomeFromTranscriptTail(text, false, sentAtMs)).toEqual({ kind: 'waiting' });
  });

  it('is waiting when nothing is newer than the paste', () => {
    const text = jsonl([limitRecord('2026-09-02T09:00:05.000Z')]);
    expect(deliveryOutcomeFromTranscriptTail(text, false, sentAtMs)).toEqual({ kind: 'waiting' });
  });

  it('is confirmed by a newer normal assistant record, past a trailing tool result', () => {
    const text = jsonl([
      userRecord('2026-09-02T13:01:01.000Z'),
      reply('2026-09-02T13:01:05.000Z'),
      userRecord('2026-09-02T13:01:06.000Z'),
    ]);
    expect(deliveryOutcomeFromTranscriptTail(text, false, sentAtMs)).toEqual({ kind: 'confirmed' });
  });

  it('is limited-again on a newer usage-limit error record', () => {
    const text = jsonl([userRecord('2026-09-02T13:01:01.000Z'), limitRecord('2026-09-02T13:01:02.000Z', 1788372000)]);
    expect(deliveryOutcomeFromTranscriptTail(text, false, sentAtMs)).toEqual({
      kind: 'limited-again',
      usageLimit: { resetsAt: '2026-09-02T18:00:00.000Z', window: 'five_hour', source: 'quota-limits' },
    });
  });

  it('ignores sidechain records', () => {
    const text = jsonl([userRecord('2026-09-02T13:01:01.000Z'), reply('2026-09-02T13:01:05.000Z', { isSidechain: true })]);
    expect(deliveryOutcomeFromTranscriptTail(text, false, sentAtMs)).toEqual({ kind: 'waiting' });
  });

  it('ignores records older than the paste', () => {
    const text = jsonl([reply('2026-09-02T13:00:30.000Z')]);
    expect(deliveryOutcomeFromTranscriptTail(text, false, sentAtMs)).toEqual({ kind: 'waiting' });
  });

  it('readDeliveryOutcome reads through the injected tail', async () => {
    const text = jsonl([userRecord('2026-09-02T13:01:01.000Z'), reply('2026-09-02T13:01:05.000Z')]);
    expect(await readDeliveryOutcome(conv(), sentAtMs, deps(text, sentAtMs))).toEqual({ kind: 'confirmed' });
  });
});

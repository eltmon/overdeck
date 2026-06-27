import { describe, it, expect, vi } from 'vitest';

// The summarize* functions spawn `claude`; only the pure helpers are exercised
// here. Stub the provider-env lookup so importing the module never touches the
// heavy agents module.
vi.mock('../../agents.js', () => ({
  getProviderEnvForModel: async () => ({}),
}));

import {
  fallbackTranscriptTitle,
  sanitizeTitle,
  serializeConversationTranscript,
  titleTranscriptWindow,
} from '../transcript-summary.js';

describe('serializeConversationTranscript', () => {
  it('labels user and assistant turns', () => {
    const out = serializeConversationTranscript([
      { role: 'user', text: 'fix the login bug' },
      { role: 'assistant', text: 'looking into it now' },
    ]);
    expect(out).toBe('User: fix the login bug\n\nAssistant: looking into it now');
  });

  it('drops system messages and blank turns', () => {
    const out = serializeConversationTranscript([
      { role: 'system', text: 'session started' },
      { role: 'user', text: '   ' },
      { role: 'user', text: 'real question' },
    ]);
    expect(out).toBe('User: real question');
  });

  it('truncates an over-long single message', () => {
    const out = serializeConversationTranscript([
      { role: 'user', text: 'x'.repeat(5000) },
    ]);
    expect(out.endsWith('…')).toBe(true);
    // "User: " (6) + 1800 truncated chars + "…" (1)
    expect(out.length).toBe(6 + 1800 + 1);
  });

  it('keeps head and tail when the transcript exceeds the budget', () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      text: `turn ${i} `.padEnd(2000, 'z'),
    }));
    const out = serializeConversationTranscript(messages);
    expect(out).toContain('[… middle of the conversation omitted for length …]');
    expect(out.startsWith('User: turn 0')).toBe(true);
    // Far smaller than the un-trimmed join of twenty 2000-char turns.
    expect(out.length).toBeLessThan(24_000);
  });

  it('returns an empty string for no conversational content', () => {
    expect(serializeConversationTranscript([{ role: 'system', text: 'noise' }])).toBe('');
  });
});

describe('sanitizeTitle', () => {
  it('strips surrounding quotes', () => {
    expect(sanitizeTitle('"Refactor the auth flow"')).toBe('Refactor the auth flow');
  });

  it('collapses internal whitespace', () => {
    expect(sanitizeTitle('Fix   the\tlogin   bug')).toBe('Fix the login bug');
  });

  it('keeps only the first line', () => {
    expect(sanitizeTitle('Add dark mode\nand other stuff')).toBe('Add dark mode');
  });

  it('returns an empty string for null/undefined/blank', () => {
    expect(sanitizeTitle(null)).toBe('');
    expect(sanitizeTitle(undefined)).toBe('');
    expect(sanitizeTitle('   ')).toBe('');
  });
});

describe('fallbackTranscriptTitle', () => {
  it('uses the latest user turn', () => {
    const transcript = [
      'User: Fix the flaky dashboard title generation',
      '',
      'Assistant: I will inspect the route.',
      '',
      'User: Failed to regenerate title: claude invocation timed out after 90000ms',
    ].join('\n');

    expect(fallbackTranscriptTitle(transcript)).toBe(
      'Failed to regenerate title claude invocation timed out',
    );
  });

  it('strips markup and keeps a compact title', () => {
    const transcript = [
      'User: please summarize `src/lib/conversations/transcript-summary.ts` and https://example.com/details',
    ].join('\n');

    expect(fallbackTranscriptTitle(transcript)).toBe(
      'summarize src/lib/conversations/transcript-summary.ts',
    );
  });

  it('returns empty for transcripts without titleable text', () => {
    expect(fallbackTranscriptTitle('[… middle of the conversation omitted for length …]')).toBe('');
  });
});

describe('titleTranscriptWindow', () => {
  it('leaves already-small transcripts unchanged', () => {
    const transcript = 'User: fix title generation\n\nAssistant: inspecting it';
    expect(titleTranscriptWindow(transcript)).toBe(transcript);
  });

  it('keeps the opening and latest context for large transcripts', () => {
    const transcript = [
      'User: opening context '.padEnd(3_000, 'h'),
      'Assistant: middle context '.padEnd(5_000, 'm'),
      'User: latest direction '.padEnd(3_000, 't'),
    ].join('\n\n');

    const windowed = titleTranscriptWindow(transcript);

    expect(windowed).toContain('[… middle of the conversation omitted for title generation …]');
    expect(windowed.startsWith('User: opening context')).toBe(true);
    expect(windowed.endsWith('t'.repeat(100))).toBe(true);
    expect(windowed.length).toBeLessThan(8_000);
  });
});

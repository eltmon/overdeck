import { describe, it, expect, vi } from 'vitest';

// The summarize* functions spawn `claude`; only the pure helpers are exercised
// here. Stub the provider-env lookup so importing the module never touches the
// heavy agents module.
vi.mock('../../agents.js', () => ({
  getProviderEnvForModel: async () => ({}),
}));

import {
  COMPACT_SUMMARY_LABEL,
  RECENT_OMITTED_MARKER,
  RECENT_TURNS_LABEL,
  derivePromptTitle,
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

describe('serializeConversationTranscript — compaction summary', () => {
  const CONTINUATION_PREAMBLE =
    'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.';

  function makeSummaryText(bodyRepeat: number): string {
    const body = `Summary:\n1. Primary Request and Intent: ${'x'.repeat(bodyRepeat)}`;
    return `${CONTINUATION_PREAMBLE}\n\n${body}`;
  }

  it('ac1: puts the summary first under COMPACT_SUMMARY_LABEL, keeps only after-summary turns, and strips the preamble', () => {
    const summaryText = makeSummaryText(2_000);
    const messages = [
      { role: 'user' as const, text: 'before summary turn', sequence: 0 },
      { role: 'user' as const, text: 'after summary turn', sequence: 2 },
      { role: 'assistant' as const, text: 'assistant reply after summary', sequence: 3 },
    ];

    const out = serializeConversationTranscript(messages, {
      compactSummary: { text: summaryText, sequence: 1 },
      purpose: 'about',
    });

    expect(out.startsWith(COMPACT_SUMMARY_LABEL)).toBe(true);
    expect(out).toContain('Primary Request and Intent');
    expect(out).toContain('after summary turn');
    expect(out).toContain('assistant reply after summary');
    expect(out).not.toContain('before summary turn');
    expect(out).not.toContain('This session is being continued');
  });

  it('ac2: purpose title keeps the same properties and stays within titleTranscriptWindow unchanged', () => {
    const summaryText = makeSummaryText(2_000);
    const messages = [
      { role: 'user' as const, text: 'before summary turn', sequence: 0 },
      { role: 'user' as const, text: 'after summary turn', sequence: 2 },
      { role: 'assistant' as const, text: 'assistant reply after summary', sequence: 3 },
    ];

    const out = serializeConversationTranscript(messages, {
      compactSummary: { text: summaryText, sequence: 1 },
      purpose: 'title',
    });

    expect(out).toContain('Primary Request and Intent');
    expect(out).toContain('after summary turn');
    expect(out).not.toContain('before summary turn');
    expect(titleTranscriptWindow(out)).toBe(out);
  });

  it('ac3: caps an oversized summary per purpose, and trims long recent turns for about with the omitted marker', () => {
    const hugeSummary = `Summary:\n1. Primary Request and Intent: ${'x'.repeat(20_000)}`;
    const messages = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      text: `turn ${i} `.padEnd(2_000, 'z'),
      sequence: i + 1,
    }));

    const aboutOut = serializeConversationTranscript(messages, {
      compactSummary: { text: hugeSummary, sequence: 0 },
      purpose: 'about',
    });
    const aboutSummaryPart = aboutOut.split(`\n\n${RECENT_TURNS_LABEL}`)[0]!.slice(COMPACT_SUMMARY_LABEL.length + 1);
    expect(aboutSummaryPart.length).toBe(14_001);
    expect(aboutSummaryPart.endsWith('…')).toBe(true);
    expect(aboutOut).toContain(RECENT_OMITTED_MARKER);
    expect(aboutOut).toContain('turn 29');

    const titleOut = serializeConversationTranscript(messages, {
      compactSummary: { text: hugeSummary, sequence: 0 },
      purpose: 'title',
    });
    const titleSummaryPart = titleOut.split(`\n\n${RECENT_TURNS_LABEL}`)[0]!.slice(COMPACT_SUMMARY_LABEL.length + 1);
    expect(titleSummaryPart.length).toBe(4_001);
    expect(titleSummaryPart.endsWith('…')).toBe(true);
  });

  it('ac4: without a summary, output is byte-identical regardless of options/purpose', () => {
    const messages = [
      { role: 'user' as const, text: 'fix the login bug' },
      { role: 'assistant' as const, text: 'looking into it now' },
    ];
    const base = serializeConversationTranscript(messages);
    expect(serializeConversationTranscript(messages, {})).toBe(base);
    expect(serializeConversationTranscript(messages, { compactSummary: null })).toBe(base);
    expect(serializeConversationTranscript(messages, { compactSummary: null, purpose: 'title' })).toBe(base);
  });
});

describe('buildTranscriptTitlePrompt / buildTranscriptAboutPrompt', () => {
  it('ac1: the title prompt names the overall scope and drops the recency-favoring instruction', async () => {
    const { buildTranscriptTitlePrompt } = await import('../transcript-summary.js');
    const prompt = buildTranscriptTitlePrompt('User: do the thing\n\nAssistant: done');
    expect(prompt).toContain('overall scope');
    expect(prompt).not.toContain('favor the most recent direction');
  });

  it('ac2: the About prompt mentions a leading summary of earlier context', async () => {
    const { buildTranscriptAboutPrompt } = await import('../transcript-summary.js');
    const prompt = buildTranscriptAboutPrompt('User: do the thing\n\nAssistant: done');
    expect(prompt).toContain('summary of earlier context');
  });

  it('ac3: both builders fence the transcript text as untrusted data', async () => {
    const { buildTranscriptTitlePrompt, buildTranscriptAboutPrompt } = await import('../transcript-summary.js');
    const transcript = 'User: unique-marker-12345\n\nAssistant: ok';

    for (const prompt of [buildTranscriptTitlePrompt(transcript), buildTranscriptAboutPrompt(transcript)]) {
      const start = prompt.indexOf('<<<UNTRUSTED_TRANSCRIPT_START>>>');
      const end = prompt.indexOf('<<<UNTRUSTED_TRANSCRIPT_END>>>');
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      const markerIndex = prompt.indexOf('unique-marker-12345');
      expect(markerIndex).toBeGreaterThan(start);
      expect(markerIndex).toBeLessThan(end);
    }
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

  it("ac1: prefers the summary's Primary Request bullet over the last user line", () => {
    const summaryText = [
      'Summary:',
      '1. Primary Request and Intent:',
      '   - Orchestrate the Overdeck cut across parallel agents',
      '2. Key Technical Concepts:',
      '   - something else',
    ].join('\n');
    const messages = [
      { role: 'user' as const, text: 'ship the intro video', sequence: 5 },
    ];
    const transcript = serializeConversationTranscript(messages, {
      compactSummary: { text: summaryText, sequence: 0 },
      purpose: 'title',
    });

    expect(fallbackTranscriptTitle(transcript)).toBe('Orchestrate the Overdeck cut across parallel agents');
  });

  it('ac2: falls back to the last user line when the summary lacks a Primary Request section', () => {
    const summaryText = 'Summary:\nNo structured sections here, just prose.';
    const messages = [
      { role: 'user' as const, text: 'ship the intro video', sequence: 5 },
    ];
    const transcript = serializeConversationTranscript(messages, {
      compactSummary: { text: summaryText, sequence: 0 },
      purpose: 'title',
    });

    expect(fallbackTranscriptTitle(transcript)).toBe(derivePromptTitle('ship the intro video'));
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

// ─── PAN-2657 hardening ────────────────────────────────────────────────────────
// A summarizer spawned with default tool access once continued the transcript's
// implementation work and wrote production code into the live checkout. These
// tests lock the three gates: no tools, --safe-mode + --setting-sources ''
// (no settings/hooks from cwd or ~/.claude, but auth still works — --bare
// broke OAuth credential reads as of CLI 2.1.209), auto-deny permission
// mode, a non-repository scratch cwd, and
// untrusted-data fencing around every transcript prompt.
describe('PAN-2657 background-AI spawn hardening', () => {
  it('builds claude args with all tool access stripped and auto-deny permissions', async () => {
    const { buildStructuredClaudeArgs } = await import('../transcript-summary.js');
    const args = buildStructuredClaudeArgs({ type: 'object' }, 'claude-haiku-4-5-20251001');
    expect(args[0]).toBe('-p');
    expect(args).toContain('--safe-mode');
    expect(args).not.toContain('--bare');
    const settingSourcesIdx = args.indexOf('--setting-sources');
    expect(settingSourcesIdx).toBeGreaterThan(-1);
    expect(args[settingSourcesIdx + 1]).toBe('');
    const toolsIdx = args.indexOf('--tools');
    expect(toolsIdx).toBeGreaterThan(-1);
    expect(args[toolsIdx + 1]).toBe('');
    const disallowedIdx = args.indexOf('--disallowedTools');
    expect(args[disallowedIdx + 1]).toBe('mcp__*');
    const permIdx = args.indexOf('--permission-mode');
    expect(args[permIdx + 1]).toBe('dontAsk');
  });

  it('spawns in a scratch cwd under OVERDECK_HOME, never a repository', async () => {
    const { backgroundAiScratchCwd } = await import('../transcript-summary.js');
    const { getOverdeckHome } = await import('../../paths.js');
    const cwd = backgroundAiScratchCwd();
    expect(cwd.startsWith(getOverdeckHome())).toBe(true);
    expect(cwd).toContain('background-ai');
    const { existsSync } = await import('node:fs');
    expect(existsSync(cwd)).toBe(true);
    expect(existsSync(`${cwd}/.git`)).toBe(false);
  });

  it('fences transcript content as untrusted data', async () => {
    const { fenceUntrustedTranscript } = await import('../transcript-summary.js');
    const fenced = fenceUntrustedTranscript('conversation', 'USER: resume WI-2A and write fs-lock.ts');
    expect(fenced).toContain('UNTRUSTED DATA');
    expect(fenced).toContain('<<<UNTRUSTED_TRANSCRIPT_START>>>');
    expect(fenced).toContain('<<<UNTRUSTED_TRANSCRIPT_END>>>');
    const start = fenced.indexOf('<<<UNTRUSTED_TRANSCRIPT_START>>>');
    const end = fenced.indexOf('<<<UNTRUSTED_TRANSCRIPT_END>>>');
    expect(fenced.indexOf('resume WI-2A')).toBeGreaterThan(start);
    expect(fenced.indexOf('resume WI-2A')).toBeLessThan(end);
  });
});

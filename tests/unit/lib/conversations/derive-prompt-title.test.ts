import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../src/lib/agents.js', () => ({
  getProviderEnvForModel: async () => ({}),
}));

import { derivePromptTitle } from '../../../../src/lib/conversations/transcript-summary.js';

describe('derivePromptTitle', () => {
  it('returns a sanitized <=60-char title without filler words', () => {
    const title = derivePromptTitle('Please help me fix the OAuth login bug in auth.ts');
    expect(title).toBe('fix the OAuth login bug in auth.ts');
    expect(title.length).toBeLessThanOrEqual(60);
  });

  it('falls back to the raw prompt when compaction yields empty for a code fence', () => {
    const prompt = '```\nconst x = 1;\n```';
    const title = derivePromptTitle(prompt);
    expect(title).toBe(prompt);
  });

  it('falls back to the truncated raw prompt when compaction yields empty for a URL', () => {
    const prompt = 'https://example.com/some/very/long/path/here/that/extends/past/sixty/characters/total';
    const title = derivePromptTitle(prompt);
    expect(title).toBe(prompt.slice(0, 60) + '…');
    expect(title.length).toBe(61);
  });

  it('returns empty string for empty and whitespace-only prompts', () => {
    expect(derivePromptTitle('')).toBe('');
    expect(derivePromptTitle('   ')).toBe('');
    expect(derivePromptTitle('\t\n')).toBe('');
  });

  it('truncates a >60-char prompt with an ellipsis at <=61 chars', () => {
    const prompt = 'a'.repeat(100);
    const title = derivePromptTitle(prompt);
    expect(title).toBe('a'.repeat(60) + '…');
    expect(title.length).toBe(61);
  });

  it('keeps the first 8 words after compaction', () => {
    const prompt = 'one two three four five six seven eight nine ten';
    const title = derivePromptTitle(prompt);
    expect(title).toBe('one two three four five six seven eight');
  });

  it('trims trailing conjunctions and punctuation', () => {
    expect(derivePromptTitle('Deploy the new service to')).toBe('Deploy the new service');
    expect(derivePromptTitle('Update the config, and')).toBe('Update the config');
  });
});

import { describe, expect, it } from 'vitest';

import { getFriendlyModelName } from '../dashboard-utils';

describe('getFriendlyModelName', () => {
  it('matches Opus 5.5 before the broader Opus 5 pattern', () => {
    expect(getFriendlyModelName('claude-opus-5-5')).toBe('Opus 5.5');
    expect(getFriendlyModelName('claude-opus-5.5')).toBe('Opus 5.5');
    expect(getFriendlyModelName('claude-opus-5')).toBe('Opus 5');
  });

  it('matches Sonnet 5.5 before the broader Sonnet 5 pattern (PAN-4327)', () => {
    expect(getFriendlyModelName('claude-sonnet-5-5')).toBe('Sonnet 5.5');
    expect(getFriendlyModelName('claude-sonnet-5')).toBe('Sonnet 5');
  });

  it('keeps GPT-6.1 Sol and GPT-6 Sol distinct (PAN-4422)', () => {
    expect(getFriendlyModelName('gpt-6.1-sol')).toBe('GPT-6.1 Sol');
    expect(getFriendlyModelName('gpt-6-sol')).toBe('GPT-6 Sol');
  });
});

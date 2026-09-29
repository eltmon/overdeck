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
});

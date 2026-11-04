import { afterEach, describe, expect, it } from 'vitest';
import { parseLimitResetText } from '../limit-reset-text.js';

describe('parseLimitResetText (PAN-4641)', () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('rolls a passed time of day to the next day in the named zone', () => {
    expect(parseLimitResetText("You've hit your session limit · resets 9am (America/New_York)", new Date('2026-08-31T20:00:00Z')))
      .toBe('2026-09-01T13:00:00.000Z');
  });

  it('parses minutes on a time later the same day', () => {
    expect(parseLimitResetText('resets 12:30pm (America/New_York)', new Date('2026-08-27T15:38:26Z')))
      .toBe('2026-08-27T16:30:00.000Z');
  });

  it('parses a month and day (matches the recorded quotaLimits.resetsAt 1790881200)', () => {
    const iso = parseLimitResetText("You've hit your weekly limit · resets Oct 1, 3pm (America/New_York)", new Date('2026-09-24T12:00:00Z'));
    expect(iso).toBe('2026-10-01T19:00:00.000Z');
    expect(Date.parse(iso!) / 1000).toBe(1790881200);
  });

  it('falls back to the process zone for an unknown zone name', () => {
    process.env.TZ = 'UTC';
    expect(parseLimitResetText('resets 9am (Mars/Base)', new Date('2026-08-31T05:00:00Z')))
      .toBe('2026-08-31T09:00:00.000Z');
  });

  it('returns null for a proxied 429 without a reset phrase', () => {
    expect(parseLimitResetText('API Error: Request rejected (429) · Provider returned error', new Date('2026-08-31T05:00:00Z')))
      .toBeNull();
  });
});

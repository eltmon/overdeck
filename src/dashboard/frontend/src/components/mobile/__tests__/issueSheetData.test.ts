import { describe, expect, it } from 'vitest';

import { eventLine, formatEventTime } from '../issueSheetData';

describe('formatEventTime', () => {
  it('shows a time for the same local calendar day as now', () => {
    const now = new Date('2026-11-13T23:00:00.000Z');
    const at = '2026-11-13T19:43:00.000Z';
    expect(formatEventTime(at, now)).toBe(new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }));
  });

  it('shows a date and time for another day', () => {
    const now = new Date('2026-11-14T23:00:00.000Z');
    const at = '2026-11-13T19:43:00.000Z';
    expect(formatEventTime(at, now)).toBe(
      new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    );
  });

  it('returns null for an unparsable at', () => {
    expect(formatEventTime('not-a-date', new Date())).toBeNull();
  });
});

describe('eventLine', () => {
  const now = new Date('2026-11-13T23:00:00.000Z');

  it('names the PR number for merge.completed with a known PR', () => {
    const line = eventLine({ kind: 'merge.completed', at: '2026-11-13T19:43:00.000Z' }, 12, now);
    expect(line).toContain('Merged PR #12 at');
  });

  it('gives the plain label for stopped with no at', () => {
    expect(eventLine({ kind: 'stopped', at: null }, null, now)).toBe('Agent stopped responding');
  });

  it('gives the plain label for merge.completed with no known PR', () => {
    expect(eventLine({ kind: 'merge.completed', at: null }, null, now)).toBe('Merged');
  });

  it('omits the time suffix when at cannot be parsed', () => {
    expect(eventLine({ kind: 'merge.failed', at: 'nope' }, null, now)).toBe('Merge failed');
  });
});

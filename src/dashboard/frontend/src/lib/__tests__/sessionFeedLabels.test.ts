import { describe, expect, it } from 'vitest';
import { formatBucketLabel, groupByContiguousLabel, JUST_NOW_THRESHOLD_MS } from '../sessionFeedLabels';

describe('sessionFeedLabels', () => {
  it('exports the Just Now threshold as a single named constant', () => {
    expect(JUST_NOW_THRESHOLD_MS).toBe(5 * 60 * 1000);
  });

  it('returns Just Now for inputs within five minutes of now', () => {
    const now = new Date(2026, 4, 23, 21, 0, 0);
    const exactlyFiveMinutesAgo = new Date(2026, 4, 23, 20, 55, 0);

    expect(formatBucketLabel(exactlyFiveMinutesAgo, now)).toBe('Just Now');
  });

  it('returns hour-of-day for earlier-today inputs older than five minutes', () => {
    const now = new Date(2026, 4, 23, 21, 0, 0);
    const earlierToday = new Date(2026, 4, 23, 18, 30, 0);

    expect(formatBucketLabel(earlierToday, now)).toBe('6 PM');
  });

  it('returns Yesterday with month, day, and hour for previous-day inputs', () => {
    const now = new Date(2026, 4, 23, 9, 0, 0);
    const yesterday = new Date(2026, 4, 22, 21, 30, 0);

    expect(formatBucketLabel(yesterday.toISOString(), now)).toBe('Yesterday May 22 · 9 PM');
  });

  it('returns weekday and month/day for inputs older than yesterday within the past week', () => {
    const now = new Date(2026, 4, 23, 12, 0, 0);
    const thisWeek = new Date(2026, 4, 20, 8, 0, 0);

    expect(formatBucketLabel(thisWeek, now)).toBe('Wednesday May 20');
  });

  it('returns a locale date for older inputs', () => {
    const now = new Date(2026, 4, 23, 12, 0, 0);
    const older = new Date(2026, 3, 10, 8, 0, 0);

    expect(formatBucketLabel(older, now)).toBe('Apr 10');
  });

  it('groups adjacent items with the same label and starts a new group when labels differ', () => {
    const items = [
      { id: 'a', label: 'Just Now' },
      { id: 'b', label: 'Just Now' },
      { id: 'c', label: '9 PM' },
      { id: 'd', label: 'Just Now' },
    ];

    expect(groupByContiguousLabel(items, (item) => item.label)).toEqual([
      { label: 'Just Now', items: [items[0], items[1]] },
      { label: '9 PM', items: [items[2]] },
      { label: 'Just Now', items: [items[3]] },
    ]);
  });
});

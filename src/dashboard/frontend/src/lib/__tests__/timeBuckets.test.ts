import { describe, expect, it } from 'vitest';
import { bucketByTime, classifyTimeBucket } from '../timeBuckets';

interface Item {
  id: string;
  timestamp: string | Date;
}

function item(id: string, timestamp: string | Date): Item {
  return { id, timestamp };
}

describe('timeBuckets', () => {
  it('returns all six bucket categories', () => {
    const buckets = bucketByTime<Item>([], (entry) => entry.timestamp, '2026-05-15T12:00:00.000Z');

    expect(Object.keys(buckets)).toEqual([
      'justNow',
      'earlierToday',
      'yesterday',
      'thisWeek',
      'thisMonth',
      'older',
    ]);
  });

  it('places items into the documented bucket boundaries', () => {
    const now = new Date(2026, 4, 15, 12, 0, 0);
    const buckets = bucketByTime([
      item('exactly-1h', new Date(2026, 4, 15, 11, 0, 0)),
      item('earlier-today', new Date(2026, 4, 15, 10, 59, 59, 999)),
      item('yesterday', new Date(2026, 4, 14, 23, 59, 59, 999)),
      item('exactly-7d', new Date(2026, 4, 8, 12, 0, 0)),
      item('this-month', new Date(2026, 4, 1, 0, 0, 0)),
      item('older', new Date(2026, 3, 30, 23, 59, 59, 999)),
    ], (entry) => entry.timestamp, now);

    expect(buckets.justNow.map((entry) => entry.id)).toEqual(['exactly-1h']);
    expect(buckets.earlierToday.map((entry) => entry.id)).toEqual(['earlier-today']);
    expect(buckets.yesterday.map((entry) => entry.id)).toEqual(['yesterday']);
    expect(buckets.thisWeek.map((entry) => entry.id)).toEqual(['exactly-7d']);
    expect(buckets.thisMonth.map((entry) => entry.id)).toEqual(['this-month']);
    expect(buckets.older.map((entry) => entry.id)).toEqual(['older']);
  });

  it('honors local timezone day boundaries', () => {
    const now = new Date(2026, 4, 15, 0, 30, 0);
    const thirtyOneMinutesAgo = new Date(2026, 4, 14, 23, 59, 0);
    const twoHoursAgoYesterday = new Date(2026, 4, 14, 22, 30, 0);

    expect(classifyTimeBucket(thirtyOneMinutesAgo, now)).toBe('justNow');
    expect(classifyTimeBucket(twoHoursAgoYesterday, now)).toBe('yesterday');
  });

  it('handles last day of month boundaries in local time', () => {
    const now = new Date(2026, 4, 1, 12, 0, 0);
    const yesterday = new Date(2026, 3, 30, 23, 59, 59);
    const olderPreviousMonth = new Date(2026, 3, 20, 12, 0, 0);

    expect(classifyTimeBucket(yesterday, now)).toBe('yesterday');
    expect(classifyTimeBucket(olderPreviousMonth, now)).toBe('older');
  });
});

export type TimeBucketKey = 'justNow' | 'earlierToday' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'older';

export interface TimeBucketed<T> {
  justNow: T[];
  earlierToday: T[];
  yesterday: T[];
  thisWeek: T[];
  thisMonth: T[];
  older: T[];
}

export function bucketByTime<T>(
  items: T[],
  getTimestamp: (item: T) => string | Date | number,
  nowTs: string | Date | number = new Date(),
): TimeBucketed<T> {
  const buckets: TimeBucketed<T> = {
    justNow: [],
    earlierToday: [],
    yesterday: [],
    thisWeek: [],
    thisMonth: [],
    older: [],
  };
  const now = toDate(nowTs);

  for (const item of items) {
    const timestamp = toDate(getTimestamp(item));
    buckets[classifyTimeBucket(timestamp, now)].push(item);
  }

  return buckets;
}

export function classifyTimeBucket(timestamp: Date, now: Date = new Date()): TimeBucketKey {
  const ageMs = now.getTime() - timestamp.getTime();
  if (ageMs <= 60 * 60 * 1000 && ageMs >= 0) return 'justNow';
  if (isSameLocalDay(timestamp, now)) return 'earlierToday';

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameLocalDay(timestamp, yesterday)) return 'yesterday';

  if (ageMs >= 0 && ageMs <= 7 * 24 * 60 * 60 * 1000) return 'thisWeek';
  if (timestamp.getFullYear() === now.getFullYear() && timestamp.getMonth() === now.getMonth()) return 'thisMonth';
  return 'older';
}

function toDate(value: string | Date | number): Date {
  return value instanceof Date ? value : new Date(value);
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

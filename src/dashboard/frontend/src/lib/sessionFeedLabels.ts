export const JUST_NOW_THRESHOLD_MS = 5 * 60 * 1000;

export interface ContiguousLabelGroup<T> {
  label: string;
  items: T[];
}

export function formatBucketLabel(timestamp: string | Date, now: Date): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const ageMs = now.getTime() - date.getTime();

  if (ageMs <= JUST_NOW_THRESHOLD_MS) return 'Just Now';
  if (isSameLocalDay(date, now)) return formatHour(date);

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameLocalDay(date, yesterday)) return `Yesterday ${formatMonthDay(date)} · ${formatHour(date)}`;

  if (ageMs >= 0 && ageMs <= 7 * 24 * 60 * 60 * 1000) return `${formatWeekday(date)} ${formatMonthDay(date)}`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

export function groupByContiguousLabel<T>(items: T[], getLabel: (item: T) => string): ContiguousLabelGroup<T>[] {
  const groups: ContiguousLabelGroup<T>[] = [];

  for (const item of items) {
    const label = getLabel(item);
    const current = groups.at(-1);
    if (current?.label === label) {
      current.items.push(item);
    } else {
      groups.push({ label, items: [item] });
    }
  }

  return groups;
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function formatHour(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric' });
}

function formatMonthDay(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatWeekday(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'long' });
}

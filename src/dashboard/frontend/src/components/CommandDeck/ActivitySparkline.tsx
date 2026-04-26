/**
 * <ActivitySparkline events windowMinutes buckets /> — sliding-window event histogram.
 *
 * Renders a 120×16 SVG: each event in the window contributes 1 unit to the bucket
 * matching its timestamp. Buckets to the right are newer; older buckets slide off
 * the left as time advances.
 */

export type SparklineCategory = 'success' | 'info' | 'review' | 'warning' | 'failure';

export interface SparklineEvent {
  timestamp: number;
  weight?: number;
  category?: SparklineCategory;
}

interface ActivitySparklineProps {
  events: ReadonlyArray<SparklineEvent>;
  windowMinutes?: number;
  buckets?: number;
  width?: number;
  height?: number;
  now?: number;
  className?: string;
}

const CATEGORY_COLORS: Record<SparklineCategory, string> = {
  success: '#22c55e', // green
  info: '#3b82f6',    // blue
  review: '#a855f7',  // purple
  warning: '#f97316', // orange
  failure: '#ef4444', // red
};

function barColor(category: SparklineCategory | undefined): string {
  if (!category) return 'var(--primary)';
  return CATEGORY_COLORS[category] ?? 'var(--primary)';
}

export function ActivitySparkline({
  events,
  windowMinutes = 60,
  buckets = 12,
  width = 120,
  height = 16,
  now,
  className,
}: ActivitySparklineProps) {
  const nowMs = now ?? Date.now();
  const windowMs = windowMinutes * 60_000;
  const windowStart = nowMs - windowMs;
  const bucketMs = windowMs / buckets;

  const counts: number[] = new Array(buckets).fill(0);
  const categories: (SparklineCategory | undefined)[] = new Array(buckets).fill(undefined);
  for (const ev of events) {
    if (ev.timestamp < windowStart || ev.timestamp > nowMs) continue;
    const offset = ev.timestamp - windowStart;
    let idx = Math.floor(offset / bucketMs);
    if (idx >= buckets) idx = buckets - 1;
    if (idx < 0) idx = 0;
    counts[idx]! += ev.weight ?? 1;
    // If multiple events in a bucket, prefer warning > failure > review > success > info
    const prev = categories[idx];
    const next = ev.category;
    const rank = { failure: 4, warning: 3, review: 2, success: 1, info: 0 } as const;
    if (!prev || (next && (rank[next] ?? -1) > (rank[prev] ?? -1))) {
      categories[idx] = next;
    }
  }

  const maxCount = Math.max(1, ...counts);
  const barWidth = width / buckets;
  const gap = Math.min(1, barWidth * 0.15);

  return (
    <svg
      data-testid="activity-sparkline"
      data-buckets={buckets}
      data-window-minutes={windowMinutes}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={`Activity over the last ${windowMinutes} minutes`}
      style={{ display: 'inline-block', overflow: 'visible' }}
    >
      {counts.map((count, i) => {
        const ratio = count / maxCount;
        const barHeight = Math.max(count > 0 ? 1 : 0, ratio * height);
        const x = i * barWidth + gap / 2;
        const y = height - barHeight;
        return (
          <rect
            key={i}
            data-testid={`sparkline-bar-${i}`}
            data-count={count}
            x={x}
            y={y}
            width={barWidth - gap}
            height={barHeight}
            rx={1}
            fill={count > 0 ? barColor(categories[i]) : 'var(--border)'}
            opacity={count > 0 ? 0.85 : 0.35}
          >
            <title>{`${count} event${count === 1 ? '' : 's'}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

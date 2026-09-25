/**
 * The headline strip over the Status tab (PAN-4199 WI-13; v1 headline tiles).
 *
 * Four numbers that answer "is the machine actually moving?" at a glance:
 * PRs merged in the last 30 days, substrate bugs filed in that window that
 * have since closed, the running order book's progress, and how many features
 * are waiting on UAT. Every one is derived — the stats come from
 * `GET /api/flywheel/stats`, the UAT count from the merge train — so a failed
 * read shows an em dash rather than a stale or invented number.
 */
import { useQuery } from '@tanstack/react-query';
import type { FlywheelOrderBookSummary } from '@overdeck/contracts';

import { mergeTrainTotals, useMergeTrainData } from '../merge-train/MergeTrainView';
import { fetchFlywheelStats } from './FlywheelStatsPanel';

const HEADLINE_WINDOW_DAYS = 30;

/** A count the server may not have answered for: an em dash, never a zero. */
function numberTile(value: number | undefined): string {
  return typeof value === 'number' ? String(value) : '—';
}

function Tile({ label, value, testId, title }: { label: string; value: string; testId: string; title: string }) {
  return (
    <div className="min-w-0 flex-1 border-l border-border pl-3 first:border-l-0 first:pl-0" title={title}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="truncate text-base font-medium text-foreground" data-testid={testId}>{value}</div>
    </div>
  );
}

export function FlywheelHeadlineStrip({ orderBook }: { orderBook: FlywheelOrderBookSummary | null }) {
  const statsQuery = useQuery({
    queryKey: ['flywheel', 'stats', HEADLINE_WINDOW_DAYS],
    queryFn: () => fetchFlywheelStats(HEADLINE_WINDOW_DAYS),
    refetchInterval: 60_000,
  });
  const { sections } = useMergeTrainData(true);
  const stats = statsQuery.data;
  // The strip never guesses: a failed — or malformed — stats read means no
  // number, not a zero, and never a crash that takes the Status tab with it.
  const merged = numberTile(stats?.criteria?.c1_bugRate?.denominator);
  const fixed = Array.isArray(stats?.bugs) ? String(stats.bugs.filter((bug) => bug.closedAt).length) : '—';

  return (
    <section aria-label="Flywheel headline" className="flex items-start gap-3 border-b border-border pb-3">
      <Tile
        label={`PRs merged · ${HEADLINE_WINDOW_DAYS}d`}
        value={merged}
        testId="flywheel-headline-prs"
        title={`Pull requests merged in the last ${HEADLINE_WINDOW_DAYS} days — the denominator of the discovery rate.`}
      />
      <Tile
        label="Bugs fixed"
        value={fixed}
        testId="flywheel-headline-fixed"
        title={`Substrate bugs filed in the last ${HEADLINE_WINDOW_DAYS} days that have since closed. A bug filed before the window is not counted here even if it closed inside it.`}
      />
      {orderBook && (
        <Tile
          label="Order book"
          value={`${orderBook.landed}/${orderBook.total}`}
          testId="flywheel-headline-orderbook"
          title={`${orderBook.name} (${orderBook.id}) — items landed of items ordered.`}
        />
      )}
      <Tile
        label="Awaiting UAT"
        value={String(mergeTrainTotals(sections).features)}
        testId="flywheel-headline-uat"
        title="Features queued on the merge train, across every project it knows."
      />
    </section>
  );
}

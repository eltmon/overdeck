/**
 * Stats tab (PAN-3964 FR-10): substrate-bug discovery rate (c1) and P0 count
 * (c2), computed by the server from the tracker and the forge on every read.
 * The v1 c3–c7 criteria read deleted run telemetry and do not come back.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FlywheelStats, FlywheelStatsCriterionStatus, FlywheelStatsTrend } from '@overdeck/contracts';

import { StatusBadge, type Tone } from './primitives';

const WINDOWS = [7, 30, 90] as const;

const STATUS_TONE: Record<FlywheelStatsCriterionStatus, Tone> = {
  green: 'success',
  yellow: 'warning',
  red: 'destructive',
  insufficient_data: 'neutral',
};

const STATUS_LABEL: Record<FlywheelStatsCriterionStatus, string> = {
  green: 'Green',
  yellow: 'Yellow',
  red: 'Red',
  insufficient_data: 'No data',
};

const TREND_LABEL: Record<FlywheelStatsTrend, string> = { up: '↗ up', down: '↘ down', flat: '→ flat' };

export async function fetchFlywheelStats(windowDays: number): Promise<FlywheelStats> {
  const res = await fetch(`/api/flywheel/stats?window=${windowDays}`);
  if (!res.ok) throw new Error(`GET /api/flywheel/stats → ${res.status}`);
  const stats = (await res.json()) as FlywheelStats;
  // A 200 carrying something else is a failed read, not data: the panel and
  // the headline strip share this query, so one bad body would otherwise
  // crash whichever of them rendered next (PAN-4199).
  if (!stats?.window?.since || !stats.criteria?.c1_bugRate) {
    throw new Error('GET /api/flywheel/stats returned a body without window/criteria');
  }
  return stats;
}

function StatCard({ label, value, status, trend, dataSufficient, since, detail, explanation }: {
  label: string;
  value: string;
  status: FlywheelStatsCriterionStatus;
  trend: FlywheelStatsTrend;
  dataSufficient: boolean;
  since: string;
  detail: string;
  explanation: string;
}) {
  return (
    <section role="region" aria-label={`${label} metric`} className="rounded-md border border-border bg-card p-3" title={explanation}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">{label}</h3>
        {dataSufficient
          ? <StatusBadge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatusBadge>
          : <StatusBadge tone="neutral">Collecting</StatusBadge>}
      </div>
      <div className="mt-2 text-lg font-medium text-foreground" data-testid={`flywheel-stat-${label}`}>
        {dataSufficient ? value : `collecting since ${since}`}
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{detail}</span>
        <span aria-label={`Trend: ${trend}`}>{TREND_LABEL[trend]}</span>
      </div>
    </section>
  );
}

export function FlywheelStatsPanel() {
  const [windowDays, setWindowDays] = useState<number>(30);
  const { data, error, isLoading } = useQuery({
    queryKey: ['flywheel', 'stats', windowDays],
    queryFn: () => fetchFlywheelStats(windowDays),
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-3" aria-label="Flywheel stats">
      <div className="flex items-center justify-between gap-2">
        <div className="flex rounded-md border border-border p-0.5 text-[11px]" role="group" aria-label="Stats window">
          {WINDOWS.map((days) => (
            <button
              key={days}
              type="button"
              aria-pressed={windowDays === days}
              onClick={() => setWindowDays(days)}
              className={`rounded-sm px-2.5 py-1 ${windowDays === days ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {days}d
            </button>
          ))}
        </div>
        {data && <span className="text-[11px] text-muted-foreground">since {data.window.since.slice(0, 10)}</span>}
      </div>

      {isLoading && !data ? (
        <div className="py-6 text-center text-sm text-muted-foreground">Loading flywheel stats…</div>
      ) : !data ? (
        <p className="text-sm text-destructive" role="alert">
          Failed to load flywheel stats: {error instanceof Error ? error.message : 'unknown error'}
        </p>
      ) : (
        <>
          {error && <p className="text-xs text-destructive" role="status">Refresh failed — showing the last good data.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <StatCard
              label="Discovery rate"
              value={data.criteria.c1_bugRate.value === null ? '—' : data.criteria.c1_bugRate.value.toFixed(2)}
              status={data.criteria.c1_bugRate.status}
              trend={data.criteria.c1_bugRate.trend}
              dataSufficient={data.criteria.c1_bugRate.dataSufficient}
              since={data.window.since.slice(0, 10)}
              detail={`${data.criteria.c1_bugRate.count} bugs / ${data.criteria.c1_bugRate.denominator} merged PRs`}
              explanation="Substrate bugs filed in the window divided by PRs merged in the window. Green under 0.1, yellow under 0.3."
            />
            <StatCard
              label="P0 bugs"
              value={String(data.criteria.c2_p0Bugs.value)}
              status={data.criteria.c2_p0Bugs.status}
              trend={data.criteria.c2_p0Bugs.trend}
              dataSufficient={data.criteria.c2_p0Bugs.dataSufficient}
              since={data.window.since.slice(0, 10)}
              detail="labelled P0"
              explanation="P0 substrate bugs filed in the window. Green at 0, yellow at 1–2."
            />
          </div>
          <section aria-label="Substrate bugs">
            <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Substrate bugs · {data.bugs.length}
            </h3>
            {data.bugs.length === 0 ? (
              <p className="text-xs text-muted-foreground">None filed in this window.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {data.bugs.map((bug) => (
                  <li key={bug.number} className="flex items-baseline gap-2">
                    <span className="font-mono text-muted-foreground">#{bug.number}</span>
                    <span className="font-mono text-muted-foreground">{bug.severity}</span>
                    <span className="min-w-0 flex-1 truncate text-foreground">{bug.title}</span>
                    <span className="text-muted-foreground">{bug.closedAt ? 'closed' : 'open'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

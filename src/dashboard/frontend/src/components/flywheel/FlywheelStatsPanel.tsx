import { useEffect, useState } from 'react';
import type { FlywheelStats, FlywheelStatsCriteria, FlywheelStatsCriterion, FlywheelStatsCriterionStatus, FlywheelStatsTrend } from '@overdeck/contracts';
import { cn } from '../../lib/utils';

const REFRESH_INTERVAL_MS = 60_000;

const CRITERION_KEYS = [
  'c1_bugRate',
  'c2_p0Bugs',
  'c3_passRate',
  'c4_mttr',
  'c5_intervention',
  'c6_timeConsistency',
  'c7_flake',
] as const satisfies readonly (keyof FlywheelStatsCriteria)[];

const CRITERION_EXPLANATIONS: Record<keyof FlywheelStatsCriteria, string> = {
  c1_bugRate: 'Substrate bugs filed in the selected window divided by completed pipeline runs in the same window.',
  c2_p0Bugs: 'Count of P0 substrate bugs filed during the selected window.',
  c3_passRate: 'Pipeline pass success rate after counting only review or test failures tied to substrate bugs discovered on the same issue within 24 hours.',
  c4_mttr: 'Median and p95 time from substrate bug filing to fix merge for bugs filed in the selected window.',
  c5_intervention: 'Operator intervention events divided by completed pipeline runs in the selected window.',
  c6_timeConsistency: 'For simple, medium, and complex bead-count buckets, compares p95 completed-run duration to the median duration.',
  c7_flake: 'Substrate-attributable review or test failures that pass one cycle and fail the next with the same head SHA.',
};

const STATUS_CLASS: Record<FlywheelStatsCriterionStatus | 'collecting', string> = {
  green: 'bg-success text-success',
  yellow: 'bg-warning text-warning',
  red: 'bg-destructive text-destructive',
  insufficient_data: 'bg-muted-foreground text-muted-foreground',
  collecting: 'bg-muted-foreground text-muted-foreground',
};

const STATUS_LABEL: Record<FlywheelStatsCriterionStatus | 'collecting', string> = {
  green: 'Green',
  yellow: 'Yellow',
  red: 'Red',
  insufficient_data: 'Insufficient data',
  collecting: 'Collecting data',
};

const TREND_LABEL: Record<FlywheelStatsTrend, string> = {
  up: '↗ Up',
  down: '↘ Down',
  flat: '→ Flat',
};

async function fetchFlywheelStats(): Promise<FlywheelStats> {
  const res = await fetch('/api/flywheel/stats');
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json() as Promise<FlywheelStats>;
}

function formatSince(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 10);
}

function formatDuration(ms: number): string {
  const abs = Math.abs(ms);
  if (abs >= 24 * 60 * 60 * 1000) return `${(ms / (24 * 60 * 60 * 1000)).toFixed(1)}d`;
  if (abs >= 60 * 60 * 1000) return `${(ms / (60 * 60 * 1000)).toFixed(1)}h`;
  if (abs >= 60 * 1000) return `${(ms / (60 * 1000)).toFixed(1)}m`;
  return `${Math.round(ms)}ms`;
}

function formatScalar(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value > 0 && Math.abs(value) < 1) return `${(value * 100).toFixed(1)}%`;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatObjectValue(value: Record<string, unknown>): string {
  return Object.entries(value)
    .map(([key, entry]) => {
      if (typeof entry === 'number' && key.toLowerCase().endsWith('ms')) return `${key}: ${formatDuration(entry)}`;
      if (typeof entry === 'number') return `${key}: ${formatScalar(entry)}`;
      if (typeof entry === 'string' || typeof entry === 'boolean' || entry === null) return `${key}: ${String(entry)}`;
      return `${key}: ${JSON.stringify(entry)}`;
    })
    .join(' · ');
}

function formatCriterionValue(value: FlywheelStatsCriterion['value']): string {
  return typeof value === 'number' ? formatScalar(value) : formatObjectValue(value as Record<string, unknown>);
}

function statusForCriterion(criterion: FlywheelStatsCriterion): FlywheelStatsCriterionStatus | 'collecting' {
  return criterion.dataSufficient ? criterion.status : 'collecting';
}

function FlywheelStatsCard({
  criterion,
  criterionKey,
  generatedAt,
}: {
  criterion: FlywheelStatsCriterion;
  criterionKey: keyof FlywheelStatsCriteria;
  generatedAt: string;
}) {
  const displayedStatus = statusForCriterion(criterion);
  const value = criterion.dataSufficient ? formatCriterionValue(criterion.value) : `collecting since ${formatSince(generatedAt)}`;

  return (
    <section
      role="region"
      aria-label={`${criterion.label} metric`}
      className="rounded-lg border border-border bg-card/60 p-4"
      title={CRITERION_EXPLANATIONS[criterionKey]}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{criterion.label}</h3>
        <div className="flex shrink-0 items-center gap-1 text-xs font-medium" aria-label={`Status: ${STATUS_LABEL[displayedStatus]}`}>
          <span className={cn('h-2.5 w-2.5 rounded-full', STATUS_CLASS[displayedStatus].split(' ')[0])} aria-hidden="true" />
          <span className={STATUS_CLASS[displayedStatus].split(' ')[1]}>{STATUS_LABEL[displayedStatus]}</span>
        </div>
      </div>

      <div className="mt-4 text-2xl font-semibold text-foreground">{value}</div>
      <div className="mt-2 text-sm text-muted-foreground">Target: {formatCriterionValue(criterion.target)}</div>

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3 text-xs text-muted-foreground">
        <span>Sample size: {criterion.sampleSize}</span>
        {criterion.trend && <span aria-label={`Trend: ${TREND_LABEL[criterion.trend]}`}>{TREND_LABEL[criterion.trend]}</span>}
      </footer>
    </section>
  );
}

export function FlywheelStatsPanel() {
  const [stats, setStats] = useState<FlywheelStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await fetchFlywheelStats();
        if (cancelled) return;
        setStats(next);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  if (loading && !stats) {
    return (
      <div className="flex min-h-[200px] items-center justify-center text-sm text-muted-foreground">
        Loading Flywheel stats…
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load Flywheel stats: {error ?? 'unknown error'}
      </div>
    );
  }

  return (
    <div className="space-y-4" aria-label="Flywheel stats">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2 text-xs text-muted-foreground">
        <span>Window: {stats.window}</span>
        <span>Generated: {formatSince(stats.generatedAt)}</span>
      </header>

      {error && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning" role="status">
          Failed to refresh Flywheel stats: {error}. Showing last good data.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {CRITERION_KEYS.map((criterionKey) => (
          <FlywheelStatsCard
            key={criterionKey}
            criterionKey={criterionKey}
            criterion={stats.criteria[criterionKey]}
            generatedAt={stats.generatedAt}
          />
        ))}
      </div>
    </div>
  );
}

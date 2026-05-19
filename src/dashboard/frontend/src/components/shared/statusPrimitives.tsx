import type { ReactNode } from 'react';
import type { FlywheelPipelineItem } from '@panctl/contracts';
import { cn } from '../../lib/utils';

interface MetricTileProps {
  label: string;
  value: string | number;
  subtext?: string;
  tone?: 'default' | 'success' | 'warning' | 'info';
}

interface IssueRowProps {
  item: FlywheelPipelineItem;
}

const VERB_CLASS: Record<FlywheelPipelineItem['verb'], string> = {
  planning: 'bg-primary/15 text-primary border-primary/30',
  working: 'bg-info/15 text-info-foreground border-info/30',
  reviewing: 'bg-signal-review/15 text-signal-review-foreground border-signal-review/30',
  testing: 'bg-warning/15 text-warning-foreground border-warning/30',
  shipping: 'bg-success/15 text-success border-success/30',
  merging: 'bg-warning/15 text-warning-foreground border-warning/30',
  blocked: 'bg-destructive/15 text-destructive border-destructive/30',
  parked: 'bg-muted text-muted-foreground border-border',
};

const TILE_TONE_CLASS: Record<NonNullable<MetricTileProps['tone']>, string> = {
  default: 'text-foreground',
  success: 'text-success',
  warning: 'text-warning-foreground',
  info: 'text-info-foreground',
};

export function MetricStrip({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 md:grid-cols-4" aria-label="Flywheel headline metrics">{children}</div>;
}

export function MetricTile({ label, value, subtext, tone = 'default' }: MetricTileProps) {
  return (
    <div className="rounded-lg border border-border bg-card/70 p-4">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('mt-1 text-3xl font-semibold tabular-nums tracking-tight', TILE_TONE_CLASS[tone])}>{value}</div>
      {subtext && <div className="mt-1 text-xs text-muted-foreground">{subtext}</div>}
    </div>
  );
}

export function VerbBadge({ verb }: { verb: FlywheelPipelineItem['verb'] }) {
  return (
    <span className={cn('inline-flex rounded border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide', VERB_CLASS[verb])}>
      {verb}
    </span>
  );
}

export function IssueRow({ item }: IssueRowProps) {
  return (
    <div className="rounded-lg border border-border bg-card/60 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded border border-border bg-background px-2 py-0.5 font-mono text-xs text-primary">{item.issueId}</span>
        <VerbBadge verb={item.verb} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{item.title}</span>
        <span className="font-mono text-xs uppercase tracking-wide text-muted-foreground">{item.status}</span>
      </div>
      {typeof item.progressPercent === 'number' && Number.isFinite(item.progressPercent) && (
        <div className="mt-3 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, item.progressPercent))}%` }} />
          </div>
          <span className="w-10 text-right font-mono text-xs text-muted-foreground">{Math.round(item.progressPercent)}%</span>
        </div>
      )}
    </div>
  );
}

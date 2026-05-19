import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';

export type MetricSignal = 'info' | 'warning' | 'review' | 'success' | 'destructive' | 'muted' | 'cost';
export type MetricTileVariant = 'pipeline' | 'agents';
export type MetricDeltaDirection = 'positive' | 'negative';

export type MetricTileDelta = {
  value: ReactNode;
  direction: MetricDeltaDirection;
};

export type MetricTileProps = {
  eyebrow: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  delta?: MetricTileDelta;
  icon: ReactNode;
  signal: MetricSignal;
  variant?: MetricTileVariant;
  className?: string;
  title?: string;
};

const SIGNAL_ICON_CLASSES = {
  info: 'text-info-foreground',
  warning: 'text-warning-foreground',
  review: 'text-signal-review-foreground',
  success: 'text-success-foreground',
  destructive: 'text-destructive-foreground',
  muted: 'text-muted-foreground',
  cost: 'text-signal-cost-foreground',
} satisfies Record<MetricSignal, string>;

const TILE_PADDING_CLASSES = {
  pipeline: 'px-[16px] py-[14px]',
  agents: 'px-[14px] py-[12px]',
} satisfies Record<MetricTileVariant, string>;

const VALUE_SIZE_CLASSES = {
  pipeline: 'text-[22px]',
  agents: 'text-[20px]',
} satisfies Record<MetricTileVariant, string>;

const SUB_SIZE_CLASSES = {
  pipeline: 'text-[11px]',
  agents: 'text-[10px]',
} satisfies Record<MetricTileVariant, string>;

const DELTA_CLASSES = {
  positive: 'text-success-foreground',
  negative: 'text-destructive-foreground',
} satisfies Record<MetricDeltaDirection, string>;

export default function MetricTile({
  eyebrow,
  value,
  sub,
  delta,
  icon,
  signal,
  variant = 'pipeline',
  className,
  title,
}: MetricTileProps) {
  return (
    <div
      data-component="metric-tile"
      data-signal={signal}
      data-variant={variant}
      title={title}
      className={cn(
        'rounded-[18px] border border-border bg-card',
        TILE_PADDING_CLASSES[variant],
        className,
      )}
    >
      <div className="flex items-center gap-[6px] text-[11px] font-medium uppercase leading-none tracking-[0.06em] text-muted-foreground">
        <span
          data-component="metric-tile-icon"
          className={cn(
            'flex h-[14px] w-[14px] shrink-0 items-center justify-center [&>svg]:h-[14px] [&>svg]:w-[14px]',
            SIGNAL_ICON_CLASSES[signal],
          )}
        >
          {icon}
        </span>
        <span className="truncate">{eyebrow}</span>
      </div>
      <div className="mt-[12px] flex items-end gap-[8px]">
        <span
          data-component="metric-tile-value"
          className={cn(
            'font-medium leading-none text-foreground [font-variant-numeric:tabular-nums]',
            VALUE_SIZE_CLASSES[variant],
          )}
        >
          {value}
        </span>
        {delta && (
          <span
            data-component="metric-tile-delta"
            data-direction={delta.direction}
            className={cn(
              'inline-flex items-center gap-[2px] text-[11px] font-medium leading-none [font-variant-numeric:tabular-nums]',
              DELTA_CLASSES[delta.direction],
            )}
          >
            {delta.value}
          </span>
        )}
      </div>
      {sub && (
        <div
          data-component="metric-tile-sub"
          className={cn('mt-[8px] truncate leading-none text-muted-foreground', SUB_SIZE_CLASSES[variant])}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

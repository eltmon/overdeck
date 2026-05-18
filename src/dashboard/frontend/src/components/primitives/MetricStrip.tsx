import type { CSSProperties } from 'react';

import { cn } from '../../lib/utils';
import MetricTile, { type MetricTileProps, type MetricTileVariant } from './MetricTile';

export type MetricStripTile = Omit<MetricTileProps, 'variant'> & {
  id?: string;
};

export type MetricStripProps = {
  tiles: MetricStripTile[];
  columns: number;
  variant?: MetricTileVariant;
  className?: string;
};

const STRIP_PADDING_CLASSES = {
  pipeline: 'border-b border-border px-[22px] py-[14px]',
  agents: 'p-0',
} satisfies Record<MetricTileVariant, string>;

export default function MetricStrip({ tiles, columns, variant = 'pipeline', className }: MetricStripProps) {
  const style = {
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
  } satisfies CSSProperties;

  return (
    <div
      data-component="metric-strip"
      data-columns={columns}
      data-variant={variant}
      className={cn('grid gap-[12px]', STRIP_PADDING_CLASSES[variant], className)}
      style={style}
    >
      {tiles.map((tile, index) => (
        <MetricTile key={tile.id ?? index} {...tile} variant={variant} />
      ))}
    </div>
  );
}

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import MetricStrip from './MetricStrip';
import MetricTile, { type MetricSignal } from './MetricTile';

const SIGNAL_CLASSES = {
  info: 'text-info-foreground',
  warning: 'text-warning-foreground',
  review: 'text-signal-review-foreground',
  success: 'text-success-foreground',
  destructive: 'text-destructive-foreground',
  muted: 'text-muted-foreground',
  cost: 'text-signal-cost-foreground',
} satisfies Record<MetricSignal, string>;

function TestIcon() {
  return (
    <svg data-testid="metric-icon" viewBox="0 0 14 14" fill="none" stroke="currentColor">
      <path d="M2 7h10" />
    </svg>
  );
}

describe('MetricTile', () => {
  it('keeps the metric value foreground while applying signal color only to the icon', () => {
    render(
      <div>
        {Object.keys(SIGNAL_CLASSES).map((signal) => (
          <MetricTile
            key={signal}
            eyebrow={signal}
            value="42"
            icon={<TestIcon />}
            signal={signal as MetricSignal}
          />
        ))}
      </div>,
    );

    for (const [signal, signalClass] of Object.entries(SIGNAL_CLASSES)) {
      const tile = screen.getByText(signal).closest('[data-component="metric-tile"]');
      const icon = tile?.querySelector('[data-component="metric-tile-icon"]');
      const value = within(tile as HTMLElement).getByText('42');

      expect(tile).toHaveAttribute('data-signal', signal);
      expect(tile).toHaveAttribute('data-variant', 'pipeline');
      expect(tile).toHaveClass('rounded-[18px]', 'border', 'border-border', 'bg-card', 'px-[16px]', 'py-[14px]');
      expect(icon).toHaveClass('h-[14px]', 'w-[14px]', signalClass);
      expect(value).toHaveClass('text-foreground', 'text-[22px]', '[font-variant-numeric:tabular-nums]');
      expect(value.className).not.toContain(signalClass);
    }
  });

  it('renders agent sizing, sub text, and signed delta colors', () => {
    render(
      <div>
        <MetricTile
          eyebrow="Cost"
          value="$12"
          sub="24h spend"
          delta={{ direction: 'positive', value: '↓ 8%' }}
          icon={<TestIcon />}
          signal="cost"
          variant="agents"
        />
        <MetricTile
          eyebrow="Stuck"
          value="3"
          delta={{ direction: 'negative', value: '↑ 2' }}
          icon={<TestIcon />}
          signal="destructive"
        />
      </div>,
    );

    const costTile = screen.getByText('Cost').closest('[data-component="metric-tile"]');
    const costValue = screen.getByText('$12');
    const costSub = screen.getByText('24h spend');
    const positiveDelta = screen.getByText('↓ 8%');
    const negativeDelta = screen.getByText('↑ 2');

    expect(costTile).toHaveAttribute('data-variant', 'agents');
    expect(costTile).toHaveClass('px-[14px]', 'py-[12px]');
    expect(costValue).toHaveClass('text-[20px]', 'text-foreground');
    expect(costSub).toHaveClass('text-[10px]', 'text-muted-foreground');
    expect(positiveDelta).toHaveAttribute('data-direction', 'positive');
    expect(positiveDelta).toHaveClass('text-success-foreground');
    expect(negativeDelta).toHaveAttribute('data-direction', 'negative');
    expect(negativeDelta).toHaveClass('text-destructive-foreground');
  });
});

describe('MetricStrip', () => {
  it('composes metric tiles in a configurable pipeline grid', () => {
    render(
      <MetricStrip
        columns={5}
        tiles={[
          { id: 'active', eyebrow: 'Active issues', value: 12, icon: <TestIcon />, signal: 'info' },
          { id: 'review', eyebrow: 'Review running', value: 4, icon: <TestIcon />, signal: 'warning' },
        ]}
      />,
    );

    const strip = screen.getByText('Active issues').closest('[data-component="metric-strip"]');
    const tiles = strip?.querySelectorAll('[data-component="metric-tile"]');

    expect(strip).toHaveAttribute('data-columns', '5');
    expect(strip).toHaveAttribute('data-variant', 'pipeline');
    expect(strip).toHaveClass('grid', 'gap-[12px]', 'border-b', 'border-border', 'px-[22px]', 'py-[14px]');
    expect(strip?.getAttribute('style')).toContain('grid-template-columns: repeat(5, minmax(0, 1fr));');
    expect(tiles).toHaveLength(2);
    expect(tiles?.[0]).toHaveAttribute('data-variant', 'pipeline');
  });

  it('composes agent tiles without strip padding and passes agent sizing to each tile', () => {
    render(
      <MetricStrip
        columns={6}
        variant="agents"
        tiles={[
          { id: 'running', eyebrow: 'Running', value: 8, icon: <TestIcon />, signal: 'success' },
          { id: 'queue', eyebrow: 'Queue', value: 2, icon: <TestIcon />, signal: 'muted' },
        ]}
      />,
    );

    const strip = screen.getByText('Running').closest('[data-component="metric-strip"]');
    const tiles = strip?.querySelectorAll('[data-component="metric-tile"]');

    expect(strip).toHaveAttribute('data-columns', '6');
    expect(strip).toHaveAttribute('data-variant', 'agents');
    expect(strip).toHaveClass('grid', 'gap-[12px]', 'p-0');
    expect(strip?.getAttribute('style')).toContain('grid-template-columns: repeat(6, minmax(0, 1fr));');
    expect(tiles).toHaveLength(2);
    expect(tiles?.[0]).toHaveAttribute('data-variant', 'agents');
    expect(tiles?.[0]).toHaveClass('px-[14px]', 'py-[12px]');
  });
});

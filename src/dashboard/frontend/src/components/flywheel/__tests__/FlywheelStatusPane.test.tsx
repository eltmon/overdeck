import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FlywheelStatusPane, freshnessLabel } from '../FlywheelStatusPane';
import { NOW, flywheelStatus } from './fixtures';

describe('FlywheelStatusPane (PAN-3964 FR-9)', () => {
  it('renders the last tick, its freshness, and no needs-you callout when null', () => {
    render(<FlywheelStatusPane status={flywheelStatus()} unreachable={false} nowMs={NOW} />);
    expect(screen.getByTestId('flywheel-last-tick')).toHaveTextContent('tick 3 · watch · PAN-3964');
    expect(screen.getByTestId('flywheel-freshness')).toHaveTextContent('live');
    expect(screen.getByTestId('flywheel-freshness')).toHaveAttribute('data-tone', 'info');
    expect(screen.queryByTestId('flywheel-needs-you')).toBeNull();
  });

  it('shows the needs-you callout when the tick carries one', () => {
    const status = flywheelStatus({
      lastTick: { tick: 4, pick: null, phase: 'park', inFlight: [], needsYou: 'decide the PAN-3920 scope', at: '2026-09-23T09:59:50.000Z' },
    });
    render(<FlywheelStatusPane status={status} unreachable={false} nowMs={NOW} />);
    expect(screen.getByTestId('flywheel-needs-you')).toHaveTextContent('decide the PAN-3920 scope');
  });

  it('renders in-flight rows with state, attention, PR, and last journal; issue ids navigate', () => {
    const onNavigateIssue = vi.fn();
    render(<FlywheelStatusPane status={flywheelStatus()} unreachable={false} nowMs={NOW} onNavigateIssue={onNavigateIssue} />);
    const row = screen.getByTestId('flywheel-inflight-PAN-3964');
    expect(row).toHaveTextContent('in-review');
    expect(row).toHaveTextContent('needs-you');
    expect(row).toHaveTextContent('#4001 · review-requested · pending');
    expect(row).toHaveTextContent('review.dispatched · 5m ago');
    expect(screen.getByTestId('flywheel-inflight-PAN-3920')).toHaveTextContent('working');
    fireEvent.click(screen.getByRole('button', { name: 'PAN-3964' }));
    expect(onNavigateIssue).toHaveBeenCalledWith('PAN-3964');
  });

  it.each([
    ['live', '2026-09-23T09:59:40.000Z', 'live', 'info'],
    ['breathing', '2026-09-23T09:50:00.000Z', 'last tick 10m ago', 'neutral'],
    ['stalled', '2026-09-23T09:00:00.000Z', 'stalled — last tick 60m ago', 'destructive'],
  ] as const)('freshness %s reads "%s"', (freshness, at, label, tone) => {
    expect(freshnessLabel(freshness, at, NOW)).toBe(label);
    const status = flywheelStatus({ freshness, lastTick: { ...flywheelStatus().lastTick!, at } });
    render(<FlywheelStatusPane status={status} unreachable={false} nowMs={NOW} />);
    expect(screen.getByTestId('flywheel-freshness')).toHaveTextContent(label);
    expect(screen.getByTestId('flywheel-freshness')).toHaveAttribute('data-tone', tone);
  });

  it('idle empty state names pan flywheel start', () => {
    render(<FlywheelStatusPane status={flywheelStatus({ run: 'idle', conversation: null, lastTick: null, freshness: null, inFlight: [] })} unreachable={false} nowMs={NOW} />);
    expect(screen.getByText(/No flywheel running/)).toHaveTextContent('No flywheel running — pan flywheel start or Start below');
  });

  it('paused empty state points at Resume', () => {
    render(<FlywheelStatusPane status={flywheelStatus({ run: 'paused', freshness: 'stalled' })} unreachable={false} nowMs={NOW} />);
    expect(screen.getByText('Paused — Resume to continue')).toBeInTheDocument();
    expect(screen.queryByTestId('flywheel-freshness')).toBeNull();
  });

  it('running without a tick waits for the first tick', () => {
    render(<FlywheelStatusPane status={flywheelStatus({ lastTick: null, freshness: null })} unreachable={false} nowMs={NOW} />);
    expect(screen.getByText('Running — waiting for the first tick')).toBeInTheDocument();
  });

  it('an unreachable server never reads as idle', () => {
    render(<FlywheelStatusPane status={undefined} unreachable nowMs={NOW} />);
    expect(screen.getByText("Can't reach the server — retrying")).toBeInTheDocument();
    expect(screen.queryByText(/No flywheel running/)).toBeNull();
  });
});

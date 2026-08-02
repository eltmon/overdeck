import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InfraGauges } from '../../InfraGauges';
import { appendEcgSample, GodViewTopBar } from '../../TopBar';
import { useGodViewStore } from '../../../../hooks/useGodViewSocket';
import type { ConfluenceData } from '../useConfluenceData';

function data(overrides: {
  eventsPerSec?: number;
  eventsPerMin?: number;
  system?: Record<string, unknown> | null;
  beads?: { wip: number; blocked: number; ready: number } | null;
  costPerMin?: number | null;
  tokensToday?: number | null;
} = {}): ConfluenceData {
  const system = overrides.system === undefined ? {
    cpu: 24,
    memPercent: 61,
    memUsed: 8,
    memTotal: 16,
    summary: { swapUsedPercent: 12, loadAverage1m: 2.5 },
  } : overrides.system;
  return {
    orbs: [],
    hookStream: {
      entries: [],
      eventTimes: [],
      eventsPerSec: overrides.eventsPerSec ?? 1.5,
      eventsPerMin: overrides.eventsPerMin ?? 90,
      specRates: {},
      energy: 0,
      microStatesByAgentId: {},
      costEvents: [],
    },
    meta: {
      mergesToday: 4,
      tokensToday: overrides.tokensToday === undefined ? 38_500_000 : overrides.tokensToday,
      costPerMin: overrides.costPerMin === undefined ? 1.25 : overrides.costPerMin,
      mergeQ: 3,
      conversations: 2,
      staleTotal: 5,
      oldestIdle: 47,
      beads: overrides.beads === undefined ? { wip: 6, blocked: 2, ready: 8 } : overrides.beads,
      system,
      active: 7,
      total: 12,
      roleCounts: {},
    },
  } as unknown as ConfluenceData;
}

describe('God View enriched top bar', () => {
  const context = {
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    stroke: vi.fn(),
    strokeStyle: '',
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T12:34:56.000Z'));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    useGodViewStore.setState({ systemHealth: null });
  });

  it('renders the FR-19 stats in order and wires help and fullscreen', () => {
    const onHelp = vi.fn();
    const onFullscreen = vi.fn();
    const { container } = render(
      <GodViewTopBar
        data={data()}
        onHelpToggle={onHelp}
        onFullscreenToggle={onFullscreen}
      />,
    );

    expect(screen.getByText(/^\d{2}:34:56$/)).toBeInTheDocument();
    expect([...container.querySelectorAll('.confluence-stat em')].map((node) => node.textContent))
      .toEqual([
        'EV/S', 'EV/M', 'VEL', 'LOAD', 'WIP', 'BLOCKED', 'READY', 'MERGE Q', '$/MIN',
        'MERGES', 'TOKENS', '❄ STALE', '🧹 PARKED', 'OLDEST',
      ]);
    for (const value of ['1.5', '90', '2.50', '6', '2', '8', '3', '$1.25', '4', '38.5M', '5', '47m', '7 active']) {
      expect(screen.getByText(value)).toBeInTheDocument();
    }
    expect(container.querySelector('[data-label="CPU"]')).toHaveTextContent('CPU 24%');
    expect(container.querySelector('[data-label="MEM"]')).toHaveTextContent('MEM 61%');
    expect(container.querySelector('[data-label="SWAP"]')).toHaveTextContent('SWAP 12%');
    const ecg = screen.getByLabelText('Events per minute ECG');
    expect(ecg).toHaveAttribute('width', '130');
    expect(ecg).toHaveAttribute('height', '30');
    fireEvent.click(screen.getByRole('button', { name: 'Open Confluence field guide' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle God View fullscreen' }));
    expect(onHelp).toHaveBeenCalledOnce();
    expect(onFullscreen).toHaveBeenCalledOnce();
  });

  it('renders unavailable beads and cost slices as dashes without throwing', () => {
    const { container } = render(
      <GodViewTopBar
        data={data({ system: null, beads: null, costPerMin: null, tokensToday: null })}
        onHelpToggle={vi.fn()}
        onFullscreenToggle={vi.fn()}
      />,
    );
    for (const label of ['CPU', 'MEM', 'SWAP']) {
      expect(container.querySelector(`[data-label="${label}"]`)).toHaveTextContent(`${label} —`);
    }
    for (const label of ['LOAD', 'WIP', 'BLOCKED', 'READY', '$/MIN', 'TOKENS']) {
      const stat = [...container.querySelectorAll('.confluence-stat')]
        .find((node) => node.querySelector('em')?.textContent === label);
      expect(stat).toHaveTextContent(`${label}—`);
    }
  });

  it('samples the ECG at 500 ms, caps the ring at 130, and pops when events change', () => {
    const { container, rerender } = render(
      <GodViewTopBar data={data()} onHelpToggle={vi.fn()} onFullscreenToggle={vi.fn()} />,
    );
    const initialDraws = vi.mocked(context.clearRect).mock.calls.length;
    act(() => vi.advanceTimersByTime(499));
    expect(vi.mocked(context.clearRect)).toHaveBeenCalledTimes(initialDraws);
    act(() => vi.advanceTimersByTime(1));
    expect(vi.mocked(context.clearRect)).toHaveBeenCalledTimes(initialDraws + 1);

    rerender(
      <GodViewTopBar
        data={data({ eventsPerSec: 2.5 })}
        onHelpToggle={vi.fn()}
        onFullscreenToggle={vi.fn()}
      />,
    );
    expect(container.querySelector('.confluence-event-pop')).toHaveClass('pop');
    act(() => vi.advanceTimersByTime(220));
    expect(container.querySelector('.confluence-event-pop')).not.toHaveClass('pop');

    const samples = Array.from({ length: 200 }, (_, index) => index)
      .reduce((ring, value) => appendEcgSample(ring, value), [] as number[]);
    expect(samples).toHaveLength(130);
    expect(samples[0]).toBe(70);
    expect(samples.at(-1)).toBe(199);
  });

  it('renders CPU, MEM, and SWAP gauges in the sidebar', () => {
    useGodViewStore.setState({ systemHealth: data().meta.system });
    render(<InfraGauges />);
    for (const label of ['CPU', 'MEM', 'SWAP']) expect(screen.getByText(label)).toBeInTheDocument();
    for (const value of ['24%', '61%', '12%']) expect(screen.getByText(value)).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ShipProgress, SHIP_STEPS } from './ShipProgress';
import type { IssueShipModel } from './types';
import { useShipLogQuery, type ShipLogData } from '../CommandDeck/ZoneCOverviewTabs/queries';

function makeShip(overrides: Partial<IssueShipModel> = {}): IssueShipModel {
  return {
    status: 'pending',
    readyForMerge: false,
    mergeStep: null,
    log: null,
    ...overrides,
  };
}

function makeLog(step: string, lines: Array<{ ts: string; line: string }>): NonNullable<IssueShipModel['log']> {
  return {
    startedAt: '2026-07-13T10:00:00.000Z',
    updatedAt: '2026-07-13T10:01:00.000Z',
    step,
    lines,
  };
}

describe('ShipProgress component', () => {
  it('renders the full cockpit view with title and status badge', () => {
    render(<ShipProgress ship={makeShip({ status: 'merging', mergeStep: 'rebasing' })} />);
    expect(screen.getByText('Ship — merge door')).toBeTruthy();
    expect(screen.getByText('merging')).toBeTruthy();
  });

  it('marks earlier steps done and the current step active for verifying', () => {
    render(<ShipProgress ship={makeShip({ status: 'verifying', mergeStep: 'verifying' })} />);

    const rebasing = screen.getByText('Rebase onto main').closest('[data-step-key]');
    const verifying = screen.getByText('Verify (quality gates)').closest('[data-step-key]');
    const merging = screen.getByText('Merge PR').closest('[data-step-key]');

    expect(rebasing).toHaveAttribute('data-step-state', 'done');
    expect(verifying).toHaveAttribute('data-step-state', 'current');
    expect(merging).toHaveAttribute('data-step-state', 'pending');
  });

  it('marks all steps done when merged', () => {
    render(<ShipProgress ship={makeShip({ status: 'merged', mergeStep: 'post-merge-cleanup' })} />);
    const steps = document.querySelectorAll('[data-step-key]');
    expect(steps).toHaveLength(SHIP_STEPS.length);
    for (const step of steps) {
      expect(step).toHaveAttribute('data-step-state', 'done');
    }
  });

  it('renders ship-log lines in non-compact mode', () => {
    const ship = makeShip({
      status: 'merging',
      mergeStep: 'squash-merging',
      log: makeLog('squash-merging', [
        { ts: '2026-07-13T10:00:01.000Z', line: 'Rebase complete' },
        { ts: '2026-07-13T10:00:02.000Z', line: 'Checks passed' },
      ]),
    });
    render(<ShipProgress ship={ship} />);

    expect(screen.getByText('Rebase complete')).toBeTruthy();
    expect(screen.getByText('Checks passed')).toBeTruthy();
    expect(screen.getByText('10:00:01')).toBeTruthy();
  });

  it('shows the waiting message when active but no log lines exist', () => {
    render(<ShipProgress ship={makeShip({ status: 'verifying', mergeStep: 'verifying', log: makeLog('verifying', []) })} />);
    expect(screen.getByText('Waiting for door output…')).toBeTruthy();
  });

  it('renders a compact rail row while merging', () => {
    render(<ShipProgress ship={makeShip({ status: 'merging', mergeStep: 'rebasing' })} compact />);
    expect(screen.getByTestId('ship-door-row')).toBeTruthy();
    expect(screen.getByText('Ship')).toBeTruthy();
    expect(screen.getByText('Rebase onto main')).toBeTruthy();
  });

  it('renders a compact rail row when merged', () => {
    render(<ShipProgress ship={makeShip({ status: 'merged', mergeStep: 'post-merge-cleanup' })} compact />);
    expect(screen.getByTestId('ship-door-row')).toBeTruthy();
    expect(screen.getByText('Ship')).toBeTruthy();
  });

  it('renders nothing in compact mode when idle/pending', () => {
    const { container } = render(<ShipProgress ship={makeShip({ status: 'pending' })} compact />);
    expect(container.firstChild).toBeNull();
  });

  it('exposes the inventory section attributes', () => {
    render(<ShipProgress ship={makeShip({ status: 'merging', mergeStep: 'rebasing' })} />);
    expect(document.querySelector('[data-section="ship-progress-full"]')).toBeTruthy();
    expect(document.querySelector('[data-section="ship-progress-steps"]')).toBeTruthy();
    expect(document.querySelectorAll('[data-section="ship-progress-step"]')).toHaveLength(SHIP_STEPS.length);
    expect(document.querySelector('[data-section="ship-progress-log"]')).toBeTruthy();
  });
});

describe('useShipLogQuery', () => {
  let queryClient: QueryClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  function wrapper(queryClient: QueryClient) {
    return function Wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(QueryClientProvider, { client: queryClient }, children);
    };
  }

  function makeResponse(status: string, step: string | null): ShipLogData {
    return {
      issueId: 'PAN-2499',
      mergeStatus: status,
      mergeStep: step,
      log: {
        startedAt: '2026-07-13T10:00:00.000Z',
        updatedAt: '2026-07-13T10:00:01.000Z',
        step: step ?? undefined,
        lines: [{ ts: '2026-07-13T10:00:01.000Z', line: `${status} ${step}` }],
      },
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls every 2s while merging/verifying and 15s otherwise', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeResponse('merging', 'rebasing')),
    } as Response);

    const { result, rerender } = renderHook(() => useShipLogQuery('PAN-2499'), { wrapper: wrapper(queryClient) });

    // Let the initial fetch resolve.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.data?.mergeStatus).toBe('merging');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeResponse('merged', 'post-merge-cleanup')),
    } as Response);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    // Wait for the fourth fetch to resolve so React Query updates.
    await act(async () => {
      const res = await fetchMock.mock.results[3]!.value;
      await res.json();
    });
    rerender();
    expect(result.current.data?.mergeStatus).toBe('merged');
    expect(fetchMock).toHaveBeenCalledTimes(4);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    // Wait for the slow-poll refetch to resolve.
    await act(async () => {
      const res = await fetchMock.mock.results[4]!.value;
      await res.json();
    });
    rerender();
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});

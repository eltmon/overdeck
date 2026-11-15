/**
 * PAN-4199 WI-13 — the headline strip. Every tile is derived; a failed read
 * shows an em dash rather than a zero the operator would read as real.
 */
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlywheelStats } from '@overdeck/contracts';

vi.mock('../../DialogProvider', () => ({ useConfirm: () => vi.fn(async () => true) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { FlywheelHeadlineStrip } from '../FlywheelHeadlineStrip';
import { renderWithQuery, stubFetch } from './fixtures';

function bug(number: number, closedAt: string | null) {
  return { number, title: `bug ${number}`, createdAt: '2026-09-01T00:00:00.000Z', closedAt, severity: 'P1' as const };
}

const stats: FlywheelStats = {
  window: { days: 30, since: '2026-08-24T00:00:00.000Z', until: '2026-09-23T00:00:00.000Z' },
  generatedAt: '2026-09-23T10:00:00.000Z',
  criteria: {
    c1_bugRate: { value: 0.25, count: 3, denominator: 12, status: 'yellow', trend: 'flat', dataSufficient: true },
    c2_p0Bugs: { value: 0, status: 'green', trend: 'flat', dataSufficient: true },
  },
  bugs: [bug(1, '2026-09-10T00:00:00.000Z'), bug(2, '2026-09-11T00:00:00.000Z'), bug(3, null)],
};

const CAR = (issueId: string) => ({ issueId, state: 'held', liveBatch: null });

function setup(opts: { statsStatus?: number; queue?: unknown[] } = {}) {
  return stubFetch((url) => {
    if (url.includes('/api/dashboard/session')) return Response.json({ csrfToken: 't' });
    if (url.startsWith('/api/flywheel/stats')) {
      return opts.statsStatus ? new Response('{}', { status: opts.statsStatus }) : Response.json(stats);
    }
    if (url.includes('/api/merge-train/board')) {
      return Response.json({ masterEnabled: true, projects: [{ projectKey: 'overdeck', cars: opts.queue ?? [], strikes: [], batches: [], recent: [] }] });
    }
    return undefined;
  });
}

describe('FlywheelHeadlineStrip (PAN-4199 WI-13)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows merged PRs and only the bugs that closed (ac1)', async () => {
    setup();
    renderWithQuery(<FlywheelHeadlineStrip orderBook={null} />);
    await waitFor(() => expect(screen.getByTestId('flywheel-headline-prs')).toHaveTextContent('12'));
    expect(screen.getByTestId('flywheel-headline-fixed')).toHaveTextContent('2');
  });

  it('shows the order book progress only when a book is running (ac2)', async () => {
    setup();
    const { unmount } = renderWithQuery(
      <FlywheelHeadlineStrip orderBook={{ id: 'book-1', name: 'Sept', status: 'running', landed: 4, total: 9 }} />,
    );
    await waitFor(() => expect(screen.getByTestId('flywheel-headline-orderbook')).toHaveTextContent('4/9'));
    unmount();

    renderWithQuery(<FlywheelHeadlineStrip orderBook={null} />);
    expect(screen.queryByTestId('flywheel-headline-orderbook')).toBeNull();
  });

  it('shows an em dash rather than a zero when the stats read fails (ac3)', async () => {
    setup({ statsStatus: 500 });
    renderWithQuery(<FlywheelHeadlineStrip orderBook={null} />);
    await waitFor(() => expect(screen.getByTestId('flywheel-headline-prs')).toHaveTextContent('—'));
    expect(screen.getByTestId('flywheel-headline-fixed')).toHaveTextContent('—');
  });

  it('shows em dashes when the stats read answers 200 with a body it cannot use', async () => {
    stubFetch((url) => {
      if (url.includes('/api/dashboard/session')) return Response.json({ csrfToken: 't' });
      return Response.json({});
    });
    renderWithQuery(<FlywheelHeadlineStrip orderBook={null} />);
    await waitFor(() => expect(screen.getByTestId('flywheel-headline-prs')).toHaveTextContent('—'));
    expect(screen.getByTestId('flywheel-headline-fixed')).toHaveTextContent('—');
    // PAN-4753: an unusable board read is a dash too, never a zero.
    await waitFor(() => expect(screen.getByTestId('flywheel-headline-uat')).toHaveTextContent('—'));
  });

  it('counts the features waiting on the merge train, from the board (ac4, PAN-4753 WI-11)', async () => {
    setup({ queue: ['PAN-1', 'PAN-2', 'PAN-3'].map(CAR) });
    renderWithQuery(<FlywheelHeadlineStrip orderBook={null} />);
    await waitFor(() => expect(screen.getByTestId('flywheel-headline-uat')).toHaveTextContent('3'));
  });
});

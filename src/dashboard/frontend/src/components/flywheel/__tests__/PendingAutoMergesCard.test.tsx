import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 't' })),
}));

import { PendingAutoMergesCard, formatAutoMergeCountdown } from '../PendingAutoMergesCard';
import { renderWithQuery, stubFetch } from './fixtures';

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    issueId: 'PAN-1',
    prUrl: 'https://github.com/eltmon/overdeck/pull/77',
    scheduledMergeAt: new Date(Date.now() + 95_000).toISOString(),
    status: 'pending',
    ...overrides,
  };
}

describe('PendingAutoMergesCard (PAN-3964 FR-11)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('formats the countdown', () => {
    const now = Date.parse('2026-09-23T10:00:00.000Z');
    expect(formatAutoMergeCountdown('2026-09-23T10:01:30.000Z', now)).toBe('auto-merging in 1:30');
    expect(formatAutoMergeCountdown('2026-09-23T09:59:00.000Z', now)).toBe('merging…');
  });

  it('is hidden when nothing is pending', async () => {
    const fetchMock = stubFetch((url) => (url === '/api/merge-train/auto-merge/pending' ? Response.json([entry({ status: 'cancelled' })]) : undefined));
    const { container } = renderWithQuery(<PendingAutoMergesCard />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/merge-train/auto-merge/pending'));
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the countdown and cancels through DELETE, then refetches', async () => {
    const fetchMock = stubFetch((url, init) => {
      if (url === '/api/merge-train/auto-merge/pending') return Response.json([entry()]);
      if (url === '/api/merge-train/auto-merge/PAN-1' && init?.method === 'DELETE') return Response.json({ success: true });
      return undefined;
    });
    renderWithQuery(<PendingAutoMergesCard />);
    const row = await screen.findByTestId('pending-auto-merge-PAN-1');
    expect(row).toHaveTextContent('PR #77');
    expect(row).toHaveTextContent(/auto-merging in 1:3\d/);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/merge-train/auto-merge/PAN-1',
      expect.objectContaining({ method: 'DELETE' }),
    ));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([u]) => u === '/api/merge-train/auto-merge/pending').length).toBeGreaterThanOrEqual(2));
  });

  it('disables Cancel while the entry is merging', async () => {
    stubFetch((url) => (url === '/api/merge-train/auto-merge/pending' ? Response.json([entry({ status: 'merging' })]) : undefined));
    renderWithQuery(<PendingAutoMergesCard />);
    await screen.findByTestId('pending-auto-merge-PAN-1');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByTestId('pending-auto-merge-PAN-1')).toHaveTextContent('merging…');
  });
});

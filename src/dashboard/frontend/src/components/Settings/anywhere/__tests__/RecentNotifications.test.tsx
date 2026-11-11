import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { RecentNotifications } from '../RecentNotifications';
import type { PushHistoryEntry } from '../../../push/pushApi';

function entry(overrides: Partial<PushHistoryEntry>): PushHistoryEntry {
  return {
    id: 'e1',
    ts: new Date().toISOString(),
    kind: 'question',
    category: 'question',
    key: 'auq:t1',
    subject: 'conv:my-conv',
    title: 'Question · my-conv',
    issueId: null,
    url: '/m?subject=my-conv',
    deliveries: [{ provider: 'webpush', target: 's1', ok: true }],
    resolution: null,
    state: null,
    ...overrides,
  };
}

function renderWith(entries: PushHistoryEntry[]) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ entries }), { status: 200 })));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RecentNotifications />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RecentNotifications (PAN-5111)', () => {
  it('shows delivery outcomes and states', async () => {
    renderWith([
      entry({
        id: 'a',
        title: 'Two targets',
        deliveries: [{ provider: 'webpush', target: 's1', ok: true }, { provider: 'native', target: 'p1', ok: true }],
        state: 'resolved-without-answer',
      }),
      entry({
        id: 'b',
        title: 'Gone target',
        deliveries: [{ provider: 'webpush', target: 's2', ok: false, reason: 'gone', status: 410 }],
        state: 'answered',
      }),
      entry({ id: 'c', title: 'Waiting one', state: 'open' }),
      entry({ id: 'd', title: 'Edge push', key: 'journal:1', kind: 'finished', subject: null, issueId: 'PAN-7', state: null }),
    ]);

    const two = (await screen.findByText('Two targets')).closest('li') as HTMLElement;
    expect(two.textContent).toContain('Delivered to 2');
    expect(screen.getByText('Answered or withdrawn').getAttribute('title')).toContain('answered in the terminal');

    const gone = screen.getByText('Gone target').closest('li') as HTMLElement;
    expect(gone.textContent).toContain('Not delivered, 1 failed (gone 410)');
    expect(gone.textContent).toContain('Answered');

    expect((screen.getByText('Waiting one').closest('li') as HTMLElement).textContent).toContain('Waiting');

    const edge = screen.getByText('Edge push').closest('li') as HTMLElement;
    expect(edge.textContent).toContain('Delivered to 1');
    expect(edge.textContent).not.toMatch(/Waiting|Answered/);
    expect(edge.querySelector('a')?.getAttribute('href')).toBe('/issues/PAN-7');
  });

  it('links a conversation entry to its conversation', async () => {
    renderWith([entry({ title: 'Conv question' })]);
    const row = (await screen.findByText('Conv question')).closest('li') as HTMLElement;
    expect(row.querySelector('a')?.getAttribute('href')).toBe('/conv/my-conv');
  });

  it('renders the empty state', async () => {
    renderWith([]);
    expect(await screen.findByText('No notifications sent yet.')).toBeTruthy();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { LinkPullRequestDialogHost, openPullRequestsDialog, usePullRequestsDialogStore } from '../LinkPullRequestDialog';
import { PullRequestMenuItems } from '../../CommandDeck/PullRequestMenuItems';

// PAN-3822 WI-6: the Pull requests dialog lists links with their sources,
// links, unlinks, relinks, refreshes, and shows the API's error text.

const BASE = '/api/conversations/conv-a/pull-requests';

function link(number: number, extra: Record<string, unknown> = {}) {
  return {
    host: 'github.com', repository: 'eltmon/overdeck', number, url: `https://github.com/eltmon/overdeck/pull/${number}`,
    source: 'manual', linkedAt: '2026-09-24T00:00:00.000Z', dismissedAt: null, snapshot: null, ...extra,
  };
}

const fetchMock = vi.fn();
let view: { links: unknown[]; effective: unknown };

function renderHost() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><LinkPullRequestDialogHost /></QueryClientProvider>);
}

beforeEach(() => {
  view = {
    links: [link(42, { source: 'branch' }), link(43, { dismissedAt: '2026-09-24T01:00:00.000Z' })],
    effective: link(42, { source: 'branch' }),
  };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (!init?.method || init.method === 'GET') return Response.json(view);
    return Response.json({ ok: true });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  act(() => usePullRequestsDialogStore.getState().close());
  vi.unstubAllGlobals();
});

describe('LinkPullRequestDialog (PAN-3822)', () => {
  it('opens from the action menu item and lists each link with its source', async () => {
    const onClose = vi.fn();
    render(
      <PullRequestMenuItems
        conversation={{ name: 'conv-a' }}
        mutations={{ linkPullRequest: vi.fn(), unlinkPullRequest: vi.fn() }}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByText('Pull requests…'));
    expect(onClose).toHaveBeenCalled();
    expect(usePullRequestsDialogStore.getState().conversationName).toBe('conv-a');

    renderHost();
    const list = await screen.findByRole('list', { name: 'Linked pull requests' });
    expect(list).toHaveTextContent('branch-detected · shown');
    expect(list).toHaveTextContent('unlinked');
    expect(screen.getByRole('button', { name: 'Unlink #42' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Relink #43' })).toBeInTheDocument();
  });

  it('links a ref, unlinks, relinks, and refreshes through the routes', async () => {
    act(() => openPullRequestsDialog('conv-a'));
    renderHost();
    await screen.findByRole('list', { name: 'Linked pull requests' });

    fireEvent.change(screen.getByLabelText('Pull request URL or #42'), { target: { value: '#44' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(BASE, expect.objectContaining({ method: 'POST', body: JSON.stringify({ ref: '#44' }) })));

    fireEvent.click(screen.getByRole('button', { name: 'Unlink #42' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}?ref=${encodeURIComponent('https://github.com/eltmon/overdeck/pull/42')}`, { method: 'DELETE' },
    ));

    fireEvent.click(await screen.findByRole('button', { name: 'Relink #43' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(BASE, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ ref: 'https://github.com/eltmon/overdeck/pull/43' }),
    })));

    fireEvent.click(await screen.findByRole('button', { name: 'Refresh pull request status' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`${BASE}/sync`, { method: 'POST' }));
  });

  it('shows the API error text and keeps the draft', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Response.json({ error: 'someone/else is not a repository of this project', code: 'foreign_repository' }, { status: 400 });
      }
      return Response.json(view);
    });
    act(() => openPullRequestsDialog('conv-a'));
    renderHost();
    await screen.findByRole('list', { name: 'Linked pull requests' });

    const input = screen.getByLabelText('Pull request URL or #42');
    fireEvent.change(input, { target: { value: 'someone/else#1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('someone/else is not a repository of this project');
    expect(input).toHaveValue('someone/else#1');
  });

  it('closes on Escape', async () => {
    act(() => openPullRequestsDialog('conv-a'));
    renderHost();
    await screen.findByRole('dialog', { name: 'Pull requests' });
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Pull requests' })).not.toBeInTheDocument());
  });
});

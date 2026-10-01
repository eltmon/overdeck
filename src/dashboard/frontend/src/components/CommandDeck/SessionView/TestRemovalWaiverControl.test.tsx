import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { TestRemovalWaiverControl } from './TestRemovalWaiverControl';

function renderControl(issueId = 'PAN-4438') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TestRemovalWaiverControl issueId={issueId} />
    </QueryClientProvider>,
  );
}

function mockFetch(get: object, post?: { status: number; body: object }) {
  global.fetch = vi.fn(async (url, opts) => {
    const method = opts?.method ?? 'GET';
    if (method === 'GET') return Response.json(get);
    if (method === 'POST' && post) return Response.json(post.body, { status: post.status });
    return Response.json({});
  }) as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TestRemovalWaiverControl (PAN-4438)', () => {
  it('disables Grant while the reason is empty', async () => {
    mockFetch({ issueId: 'PAN-4438', head: 'abc123', headShort: 'abc123', waiver: null, active: false });

    renderControl();

    await waitFor(() => expect(screen.getByTestId('waiver-head')).toHaveTextContent('abc123'));
    expect(screen.getByTestId('waiver-grant')).toBeDisabled();
  });

  it('POSTs the reason and the GET head, then enables Grant once a reason is typed', async () => {
    mockFetch(
      { issueId: 'PAN-4438', head: 'abc123', headShort: 'abc123', waiver: null, active: false },
      { status: 201, body: { waiver: { sha: 'abc123', reason: 'ok', at: '2026-09-30T00:00:00.000Z', by: 'dashboard' }, headShort: 'abc123' } },
    );

    const user = userEvent.setup();
    renderControl();

    await waitFor(() => expect(screen.getByTestId('waiver-head')).toHaveTextContent('abc123'));
    await user.type(screen.getByTestId('waiver-reason'), 'operator approved');
    expect(screen.getByTestId('waiver-grant')).not.toBeDisabled();

    await user.click(screen.getByTestId('waiver-grant'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/issues/PAN-4438/test-removal-waiver',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ reason: 'operator approved', head: 'abc123' }),
        }),
      );
    });
  });

  it('renders the server error text on a 409 response', async () => {
    mockFetch(
      { issueId: 'PAN-4438', head: 'abc123', headShort: 'abc123', waiver: null, active: false },
      { status: 409, body: { error: 'The head moved since you last saw it — reload and grant again.', code: 'head-moved' } },
    );

    const user = userEvent.setup();
    renderControl();

    await waitFor(() => expect(screen.getByTestId('waiver-head')).toHaveTextContent('abc123'));
    await user.type(screen.getByTestId('waiver-reason'), 'operator approved');
    await user.click(screen.getByTestId('waiver-grant'));

    await waitFor(() => {
      expect(screen.getByText(/reload and grant again/i)).toBeTruthy();
    });
  });

  it('renders the granted line and the re-run hint when active', async () => {
    mockFetch({
      issueId: 'PAN-4438',
      head: 'abc123',
      headShort: 'abc123',
      waiver: { sha: 'abc123', reason: 'operator approved', at: '2026-09-30T00:00:00.000Z', by: 'operator' },
      active: true,
    });

    renderControl();

    await waitFor(() => expect(screen.getByText(/Waiver granted by operator/i)).toBeTruthy());
    expect(screen.getByText(/pan review request PAN-4438/i)).toBeTruthy();
  });
});

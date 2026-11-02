/** PAN-4653 WI-5: the auto-settle-on-merge switch — optimistic flip, restore on error. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { toastErrorFn } = vi.hoisted(() => ({ toastErrorFn: vi.fn() }));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: toastErrorFn, success: vi.fn() }),
}));

import { AutoSettleOnMergeRow } from '../AutoSettleOnMergeRow';

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderRow() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AutoSettleOnMergeRow />
    </QueryClientProvider>,
  );
}

async function enabledSwitch(): Promise<HTMLElement> {
  const toggle = screen.getByRole('switch', { name: 'Toggle auto-settle on merge' });
  await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
  return toggle;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  toastErrorFn.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AutoSettleOnMergeRow', () => {
  it('reflects the server setting', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ enabled: true }));
    renderRow();
    await enabledSwitch();
    expect(fetchMock).toHaveBeenCalledWith('/api/conversations/auto-settle-on-merge');
  });

  it('posts the new value and flips before the response resolves', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ enabled: true }));
    renderRow();
    const toggle = await enabledSwitch();

    let resolvePost: (response: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { resolvePost = resolve; }));
    fireEvent.click(toggle);

    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe('/api/conversations/auto-settle-on-merge');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"enabled":false}');

    resolvePost(jsonResponse({ enabled: false }));
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
  });

  it('restores the previous value and shows an error when the post fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ enabled: true }));
    renderRow();
    const toggle = await enabledSwitch();

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500));
    fireEvent.click(toggle);

    await waitFor(() => expect(toastErrorFn).toHaveBeenCalled());
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });
});

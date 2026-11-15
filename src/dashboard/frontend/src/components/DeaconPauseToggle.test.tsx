import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeaconFrozenChip, DeaconPauseBanner, DeaconPauseToggle } from './DeaconPauseToggle';

const PAUSE_QUERY_KEY = ['deacon', 'pause'] as const;

function renderPaused(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(PAUSE_QUERY_KEY, { paused: true });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Deacon paused state semantics', () => {
  it('uses warning tokens in expanded and compact controls', () => {
    vi.stubGlobal('fetch', vi.fn());
    const expanded = renderPaused(<DeaconPauseToggle />);
    expect(screen.getByRole('button', { name: /Resume Deacon/i })).toHaveClass('border-warning/32', 'bg-warning/8', 'text-warning-foreground');
    expanded.unmount();

    renderPaused(<DeaconPauseToggle compact />);
    expect(screen.getByRole('button', { name: /Auto-resume frozen/i })).toHaveClass('border-warning/32', 'bg-warning/8', 'text-warning-foreground');
  });

  it('uses the warning alert vocabulary in the global pause banner', () => {
    vi.stubGlobal('fetch', vi.fn());
    const { container } = renderPaused(<DeaconPauseBanner />);
    expect(screen.getByText(/no automatic patrol/i).parentElement).toHaveClass('bg-warning/8', 'border-warning/32');
    expect(container.innerHTML).not.toMatch(/sky-|amber-/);
  });
});

describe('DeaconFrozenChip (PAN-5292 WI-E7)', () => {
  function stubPauseRoute(paused: boolean) {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return Response.json(JSON.parse(String(init.body)));
      return Response.json({ paused });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function renderChip() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    return render(<QueryClientProvider client={queryClient}><DeaconFrozenChip /></QueryClientProvider>);
  }

  it('renders nothing while Deacon is not paused', async () => {
    const fetchMock = stubPauseRoute(false);
    const { container } = renderChip();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/deacon/pause'));
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the warning-toned "Auto-resume frozen" button while paused', async () => {
    stubPauseRoute(true);
    renderChip();
    const chip = await screen.findByRole('button', { name: /Auto-resume frozen/ });
    expect(chip).toHaveClass('border-warning/32', 'bg-warning/8', 'text-warning-foreground');
    expect(chip).toHaveAttribute('title', 'Auto-resume (Deacon) is frozen — click to resume patrol');
  });

  it('resumes patrol with POST /api/deacon/pause {"paused":false} when clicked', async () => {
    const fetchMock = stubPauseRoute(true);
    renderChip();
    fireEvent.click(await screen.findByRole('button', { name: /Auto-resume frozen/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/deacon/pause', expect.objectContaining({
      method: 'POST',
      body: '{"paused":false}',
    })));
  });
});

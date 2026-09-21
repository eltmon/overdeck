import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeaconPauseBanner, DeaconPauseToggle } from './DeaconPauseToggle';

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
    expect(screen.getByRole('button', { name: /Deacon frozen/i })).toHaveClass('border-warning/32', 'bg-warning/8', 'text-warning-foreground');
  });

  it('uses the warning alert vocabulary in the global pause banner', () => {
    vi.stubGlobal('fetch', vi.fn());
    const { container } = renderPaused(<DeaconPauseBanner />);
    expect(screen.getByText(/no automatic patrol/i).parentElement).toHaveClass('bg-warning/8', 'border-warning/32');
    expect(container.innerHTML).not.toMatch(/sky-|amber-/);
  });
});

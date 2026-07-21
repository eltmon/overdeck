import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SetupChecklistBanner } from './SetupChecklistBanner';

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: vi.fn() },
}));

describe('SetupChecklistBanner', () => {
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
  });

  it('copies server-generated setup diagnostics from the expanded checklist', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          platform: 'linux',
          allRequiredFound: false,
          checks: [{
            id: 'claude',
            name: 'Claude Code',
            required: true,
            purpose: 'Runs agents',
            found: false,
            version: null,
            install: { linux: 'install claude', mac: 'install claude', win: 'install claude' },
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ schemaVersion: 1, markdown: 'safe diagnostics' }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <SetupChecklistBanner />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Show checklist' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('safe diagnostics'));
    expect(fetchMock).toHaveBeenLastCalledWith('/api/diagnostics/setup');
    expect(toastSuccess).toHaveBeenCalledWith('Diagnostics copied');
  });
});

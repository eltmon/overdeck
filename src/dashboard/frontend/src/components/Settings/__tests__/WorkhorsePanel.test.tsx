import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkhorsePanel } from '../WorkhorsePanel';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkhorsePanel />
    </QueryClientProvider>,
  );
}

describe('WorkhorsePanel', () => {
  beforeEach(() => {
    global.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/settings' && init?.method === 'PUT') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) } as Response);
      }
      if (url === '/api/settings') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            workhorses: {
              expensive: 'claude-opus-4-7',
              mid: 'claude-sonnet-4-6',
              cheap: 'claude-haiku-4-5',
            },
          }),
        } as Response);
      }
      if (url === '/api/settings/available-models') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            anthropic: [
              { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', costPer1MTokens: 45 },
              { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', costPer1MTokens: 15 },
            ],
            kimi: [
              { id: 'kimi-k2.6-flash', name: 'Kimi K2.6 Flash', costPer1MTokens: 1 },
            ],
          }),
        } as Response);
      }
      return Promise.resolve({ ok: false, text: () => Promise.resolve('not found') } as Response);
    }) as unknown as typeof fetch;
  });

  it('renders three workhorse dropdowns with descriptions and provider-grouped model labels', async () => {
    renderPanel();

    expect(await screen.findByLabelText('Expensive')).toBeInTheDocument();
    expect(screen.getByLabelText('Mid')).toBeInTheDocument();
    expect(screen.getByLabelText('Cheap')).toBeInTheDocument();
    expect(screen.getByText('Strongest, costly — plan/review default')).toBeInTheDocument();
    expect(screen.getByText('Balanced default')).toBeInTheDocument();
    expect(screen.getByText('Fast & cheap — universal inspect')).toBeInTheDocument();
    expect(screen.getAllByText('Anthropic > Claude Opus 4.7').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Kimi > Kimi K2.6 Flash').length).toBeGreaterThan(0);
  });

  it('round-trips workhorse edits through PUT /api/settings', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.selectOptions(await screen.findByLabelText('Cheap'), 'kimi-k2.6-flash');

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/settings', expect.objectContaining({ method: 'PUT' }));
    });

    const putCall = vi.mocked(global.fetch).mock.calls.find(([url, init]) => (
      url.toString() === '/api/settings' && init?.method === 'PUT'
    ));
    expect(JSON.parse(putCall?.[1]?.body as string).workhorses).toMatchObject({
      expensive: 'claude-opus-4-7',
      mid: 'claude-sonnet-4-6',
      cheap: 'kimi-k2.6-flash',
    });
  });
});

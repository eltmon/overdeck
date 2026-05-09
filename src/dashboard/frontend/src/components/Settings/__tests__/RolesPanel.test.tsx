import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RolesPanel } from '../RolesPanel';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const settingsPayload = {
  workhorses: {
    expensive: 'claude-opus-4-7',
    mid: 'claude-sonnet-4-6',
    cheap: 'claude-haiku-4-5',
  },
  roles: {
    plan: { model: 'workhorse:expensive' },
    work: {
      model: 'workhorse:mid',
      sub: {
        inspect: { model: 'workhorse:cheap' },
        'inspect-deep': { model: 'workhorse:mid' },
      },
    },
    review: {
      model: 'workhorse:expensive',
      sub: {
        security: { model: 'workhorse:expensive' },
        correctness: { model: 'workhorse:mid' },
        performance: { model: 'workhorse:mid' },
        requirements: { model: 'workhorse:mid' },
      },
    },
    test: { model: 'workhorse:mid' },
    ship: { model: 'workhorse:mid' },
  },
};

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RolesPanel />
    </QueryClientProvider>,
  );
}

describe('RolesPanel', () => {
  beforeEach(() => {
    global.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/settings' && init?.method === 'PUT') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) } as Response);
      }
      if (url === '/api/settings') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(settingsPayload),
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

  it('renders five role cards in order with workhorse and specific model choices', async () => {
    renderPanel();

    const cards = await screen.findAllByTestId('role-card');
    expect(cards).toHaveLength(5);
    expect(cards.map((card) => within(card).getByRole('heading', { level: 4 }).textContent)).toEqual([
      'Plan',
      'Work',
      'Review',
      'Test',
      'Ship',
    ]);

    expect(screen.getByLabelText('Plan model')).toHaveValue('workhorse:expensive');
    expect(screen.getByLabelText('Work model')).toHaveValue('workhorse:mid');
    expect(screen.getByLabelText('Test model')).toHaveValue('workhorse:mid');
    expect(screen.getByLabelText('Ship model')).toHaveValue('workhorse:mid');
    expect(screen.getAllByText('Expensive (claude-opus-4-7)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Anthropic > Claude Opus 4.7').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Kimi > Kimi K2.6 Flash').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Default: Workhorse: Expensive')[0]).toHaveAttribute(
      'title',
      'Workhorse: Expensive = claude-opus-4-7',
    );
  });

  it('expands work and review cards to show configured sub-role defaults', async () => {
    const user = userEvent.setup();
    renderPanel();

    const cards = await screen.findAllByTestId('role-card');
    await user.click(within(cards[1]).getByRole('button', { name: /show sub-roles/i }));
    expect(await screen.findByLabelText('Work Inspect model')).toHaveValue('workhorse:cheap');
    expect(screen.getByLabelText('Work Inspect Deep model')).toHaveValue('workhorse:mid');

    await user.click(within(cards[2]).getByRole('button', { name: /show sub-roles/i }));
    expect(await screen.findByLabelText('Review Security model')).toHaveValue('workhorse:expensive');
    expect(screen.getByLabelText('Review Correctness model')).toHaveValue('workhorse:mid');
    expect(screen.getByLabelText('Review Performance model')).toHaveValue('workhorse:mid');
    expect(screen.getByLabelText('Review Requirements model')).toHaveValue('workhorse:mid');
  });

  it('round-trips nested role edits through PUT /api/settings', async () => {
    const user = userEvent.setup();
    renderPanel();

    const cards = await screen.findAllByTestId('role-card');
    await user.click(within(cards[2]).getByRole('button', { name: /show sub-roles/i }));
    await user.selectOptions(await screen.findByLabelText('Review Security model'), 'kimi-k2.6-flash');

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/settings', expect.objectContaining({ method: 'PUT' }));
    });

    const putCall = vi.mocked(global.fetch).mock.calls.find(([url, init]) => (
      url.toString() === '/api/settings' && init?.method === 'PUT'
    ));
    const body = JSON.parse(putCall?.[1]?.body as string);
    expect(body.roles.review.sub.security.model).toBe('kimi-k2.6-flash');
    expect(body.roles.review.sub.correctness.model).toBe('workhorse:mid');
    expect(body.roles.plan.model).toBe('workhorse:expensive');
  });
});

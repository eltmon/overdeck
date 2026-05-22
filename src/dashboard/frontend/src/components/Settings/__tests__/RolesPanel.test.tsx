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
        synthesis: { model: 'workhorse:expensive' },
      },
    },
    test: { model: 'workhorse:mid' },
    ship: { model: 'workhorse:mid' },
    flywheel: {
      harness: 'claude-code',
      model: 'claude-opus-4-7',
      effort: 'high',
      maxAgents: 8,
      scope: 'pan-only',
    },
  },
  models: {
    providers: {
      anthropic: false,
      kimi: true,
    },
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

type ClaudeAuthOverride = { loggedIn?: boolean; hasAnthropicApiKey?: boolean };

function installFetchMock(opts: {
  settings?: typeof settingsPayload;
  claudeAuth?: ClaudeAuthOverride;
} = {}) {
  let currentSettings = structuredClone(opts.settings ?? settingsPayload);
  const claudeAuth = opts.claudeAuth ?? { loggedIn: false, hasAnthropicApiKey: false };

  global.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    if (url === '/api/settings' && init?.method === 'PUT') {
      currentSettings = JSON.parse(String(init.body));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) } as Response);
    }
    if (url === '/api/settings') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(currentSettings),
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
    if (url === '/api/settings/claude-auth') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(claudeAuth),
      } as Response);
    }
    return Promise.resolve({ ok: false, text: () => Promise.resolve('not found') } as Response);
  }) as unknown as typeof fetch;
}

describe('RolesPanel', () => {
  beforeEach(() => {
    installFetchMock();
  });

  it('renders role cards in order with workhorse, specific model, and flywheel choices', async () => {
    renderPanel();

    const cards = await screen.findAllByTestId('role-card');
    expect(cards).toHaveLength(6);
    expect(cards.map((card) => within(card).getByRole('heading', { level: 4 }).textContent)).toEqual([
      'Plan',
      'Work',
      'Review',
      'Test',
      'Ship',
      'Flywheel',
    ]);

    expect(screen.getByLabelText('Plan model')).toHaveValue('workhorse:expensive');
    expect(screen.getByLabelText('Work model')).toHaveValue('workhorse:mid');
    expect(screen.getByLabelText('Test model')).toHaveValue('workhorse:mid');
    expect(screen.getByLabelText('Ship model')).toHaveValue('workhorse:mid');
    expect(screen.getByLabelText('Flywheel model')).toHaveValue('claude-opus-4-7');
    expect(screen.getByLabelText('Flywheel harness')).toHaveValue('claude-code');
    expect(screen.getByLabelText('Flywheel effort')).toHaveValue('high');
    expect(screen.getByLabelText('Flywheel max agents')).toHaveValue(8);
    expect(screen.getByLabelText('Flywheel scope')).toHaveValue('pan-only');
    expect(screen.getByText('Changes apply on the next tick — no restart needed.')).toBeInTheDocument();
    expect(screen.getAllByText('Expensive (claude-opus-4-7)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Anthropic > Claude Opus 4.7').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Kimi > Kimi K2.6 Flash').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Default: Workhorse: Expensive')[0]).toHaveAttribute(
      'title',
      'Workhorse: Expensive = claude-opus-4-7',
    );
    expect(screen.getAllByText('Resolved: claude-opus-4-7').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('Anthropic is not configured');
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
    expect(screen.getByLabelText('Review Synthesis model')).toHaveValue('workhorse:expensive');
  });

  it('shows parent model choices only for sub-role pickers', async () => {
    const user = userEvent.setup();
    renderPanel();

    await screen.findByLabelText('Review model');
    expect(within(screen.getByLabelText('Review model')).queryByRole('option', { name: /Parent/i })).not.toBeInTheDocument();

    const cards = await screen.findAllByTestId('role-card');
    await user.click(within(cards[2]).getByRole('button', { name: /show sub-roles/i }));

    expect(within(await screen.findByLabelText('Review Security model')).getByRole('option', {
      name: 'Parent (inherits claude-opus-4-7)',
    })).toBeInTheDocument();
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

  it('saves parent selections through nested role updates', async () => {
    const user = userEvent.setup();
    renderPanel();

    const cards = await screen.findAllByTestId('role-card');
    await user.click(within(cards[2]).getByRole('button', { name: /show sub-roles/i }));
    await user.selectOptions(await screen.findByLabelText('Review Security model'), 'parent');

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/settings', expect.objectContaining({ method: 'PUT' }));
    });

    const putCall = vi.mocked(global.fetch).mock.calls.findLast(([url, init]) => (
      url.toString() === '/api/settings' && init?.method === 'PUT'
    ));
    const body = JSON.parse(putCall?.[1]?.body as string);
    expect(body.roles.review.sub.security.model).toBe('parent');
  });

  it('persists flywheel-specific settings and reloads the saved value', async () => {
    const user = userEvent.setup();
    renderPanel();

    await screen.findByLabelText('Flywheel scope');
    await user.selectOptions(screen.getByLabelText('Flywheel scope'), 'all-tracked-projects');

    await waitFor(() => {
      expect(screen.getByLabelText('Flywheel scope')).toHaveValue('all-tracked-projects');
    });

    const putCall = vi.mocked(global.fetch).mock.calls.findLast(([url, init]) => (
      url.toString() === '/api/settings' && init?.method === 'PUT'
    ));
    const body = JSON.parse(putCall?.[1]?.body as string);
    expect(body.roles.flywheel).toMatchObject({
      harness: 'claude-code',
      model: 'claude-opus-4-7',
      effort: 'high',
      maxAgents: 8,
      scope: 'all-tracked-projects',
    });
  });

  it('shows saved parent selections as inherited without missing-model or provider warnings', async () => {
    const user = userEvent.setup();
    const settings = structuredClone(settingsPayload);
    settings.roles.review.sub.security.model = 'parent';
    installFetchMock({ settings });
    renderPanel();

    const cards = await screen.findAllByTestId('role-card');
    await user.click(within(cards[2]).getByRole('button', { name: /show sub-roles/i }));

    const securitySelect = await screen.findByLabelText('Review Security model');
    expect(securitySelect).toHaveValue('parent');
    expect(Array.from(securitySelect.querySelectorAll('optgroup')).map((group) => group.label)).not.toContain('Current');

    const picker = securitySelect.closest('label') as HTMLElement;
    expect(within(picker).getByText('Resolved: claude-opus-4-7')).toBeInTheDocument();
    expect(within(picker).queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('RolesPanel — Anthropic spend warning (regression PAN-1093 follow-up)', () => {
  const settingsWithAnthropicEnabled = structuredClone(settingsPayload);
  settingsWithAnthropicEnabled.models.providers.anthropic = true;

  it('does NOT warn when user is on Claude subscription (no ANTHROPIC_API_KEY)', async () => {
    installFetchMock({
      settings: settingsWithAnthropicEnabled,
      claudeAuth: { loggedIn: true, hasAnthropicApiKey: false },
    });
    renderPanel();

    await screen.findAllByTestId('role-card');
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/settings/claude-auth');
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText(/will bill the Anthropic API/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/verify this is intentional for non-Anthropic budget control/i)).not.toBeInTheDocument();
  });

  it('DOES warn when ANTHROPIC_API_KEY is set (api-key auth)', async () => {
    installFetchMock({
      settings: settingsWithAnthropicEnabled,
      claudeAuth: { loggedIn: true, hasAnthropicApiKey: true },
    });
    renderPanel();

    await screen.findAllByTestId('role-card');
    const warnings = await screen.findAllByText(
      /Anthropic API key in use; this model will bill the Anthropic API\./i,
    );
    expect(warnings.length).toBeGreaterThan(0);
  });
});

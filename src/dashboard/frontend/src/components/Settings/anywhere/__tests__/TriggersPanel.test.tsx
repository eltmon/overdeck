import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DialogProvider } from '../../../DialogProvider';
import { TriggersPanel } from '../TriggersPanel';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

const FUNNEL_COMMAND = 'tailscale funnel --bg --https=8443 --set-path=/hooks http://127.0.0.1:3011/hooks';
const TRIGGERS = [
  {
    id: 'trg_3f9a0c1d2e4b',
    name: 'ci-failures',
    target: { kind: 'conversation', conversation: '20261101-0001' },
    template: null,
    verify: 'github',
    signingSecretSet: true,
    createdAt: '2026-11-01T00:00:00.000Z',
  },
  {
    id: 'trg_aaaaaaaaaaaa',
    name: 'payments',
    target: { kind: 'project', projectKey: 'overdeck' },
    template: 'Look at this payment.',
    verify: 'stripe',
    signingSecretSet: false,
    createdAt: '2026-10-30T00:00:00.000Z',
  },
];

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) } as Response;
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DialogProvider>{ui}</DialogProvider>
    </QueryClientProvider>,
  );
}

function deleteCalls() {
  return fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE');
}

describe('TriggersPanel (PAN-4648)', () => {
  beforeEach(() => {
    fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/triggers' && !init?.method) {
        return Promise.resolve(jsonResponse(200, { triggers: TRIGGERS, funnel: { port: 8443, baseUrl: null, command: FUNNEL_COMMAND } }));
      }
      if (url === '/api/triggers/trg_3f9a0c1d2e4b' && init?.method === 'DELETE') {
        return Promise.resolve(jsonResponse(200, { removed: true }));
      }
      return Promise.resolve(jsonResponse(404, { error: 'not found' }));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders each trigger with its target and verification, and the Funnel command', async () => {
    const { container } = renderWithProviders(<TriggersPanel />);

    const github = (await screen.findByText('ci-failures')).closest('li') as HTMLElement;
    const stripe = screen.getByText('payments').closest('li') as HTMLElement;
    expect(within(github).getByText(/Messages conversation 20261101-0001/)).toBeInTheDocument();
    expect(within(github).getByText(/GitHub signature · signing secret set/)).toBeInTheDocument();
    expect(within(stripe).getByText(/Starts a conversation in overdeck/)).toBeInTheDocument();
    expect(within(stripe).getByText(/Stripe signature · signing secret not set/)).toBeInTheDocument();
    expect(screen.getByText(/overdeck\.ai never sees them/)).toBeInTheDocument();
    expect(screen.getByTestId('trigger-funnel-command')).toHaveTextContent(FUNNEL_COMMAND);
    expect(container.textContent).not.toMatch(/[0-9a-f]{64}/);
  });

  it('sends DELETE /api/triggers/<id> when the in-app confirm is accepted', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TriggersPanel />);

    const row = (await screen.findByText('ci-failures')).closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Remove ci-failures?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
    expect(deleteCalls()[0]?.[0]).toBe('/api/triggers/trg_3f9a0c1d2e4b');
  });

  it('sends no DELETE when the confirm is declined', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TriggersPanel />);

    const row = (await screen.findByText('ci-failures')).closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(deleteCalls()).toHaveLength(0);
  });

  it('shows the empty state when there are no triggers', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, { triggers: [], funnel: { port: 8443, baseUrl: null, command: FUNNEL_COMMAND } })));
    renderWithProviders(<TriggersPanel />);
    expect(
      await screen.findByText('No triggers. A trigger is a secret URL that sends a message to a conversation or starts one in a project.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Events reach this machine directly through Tailscale Funnel; overdeck\.ai never sees them\./)).toBeInTheDocument();
    expect(screen.getByTestId('trigger-funnel-command')).toHaveTextContent(FUNNEL_COMMAND);
  });
});

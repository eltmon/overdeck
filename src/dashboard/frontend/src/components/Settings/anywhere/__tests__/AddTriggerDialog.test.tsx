import { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DialogProvider } from '../../../DialogProvider';
import { AddTriggerDialog } from '../AddTriggerDialog';
import { TriggersPanel } from '../TriggersPanel';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

const URL_SECRET = 'a'.repeat(64);
const SIGNING_SECRET = 'b'.repeat(64);
const STRIPE_TRIGGER = {
  id: 'trg_aaaaaaaaaaaa',
  name: 'payments',
  target: { kind: 'conversation', conversation: '20261101-0001' },
  template: null,
  verify: 'stripe',
  signingSecretSet: false,
  createdAt: '2026-10-30T00:00:00.000Z',
};

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

function OpenDialog() {
  const [open, setOpen] = useState(true);
  return <AddTriggerDialog open={open} onClose={() => setOpen(false)} />;
}

function callsWith(method: string) {
  return fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === method);
}

describe('AddTriggerDialog (PAN-4648)', () => {
  beforeEach(() => {
    fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/registered-projects') return Promise.resolve(jsonResponse(200, [{ key: 'overdeck', name: 'overdeck', path: '/p' }]));
      if (url === '/api/triggers' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { name: string; verify: string };
        return Promise.resolve(jsonResponse(201, {
          trigger: { ...STRIPE_TRIGGER, id: 'trg_bbbbbbbbbbbb', name: body.name, verify: body.verify, signingSecretSet: true },
          hookPath: `/hooks/trg_bbbbbbbbbbbb/${URL_SECRET}`,
          url: `https://desk.tailnet.ts.net:8443/hooks/trg_bbbbbbbbbbbb/${URL_SECRET}`,
          urlSecretShownOnce: true,
          generatedSigningSecret: body.verify === 'github' ? SIGNING_SECRET : null,
        }));
      }
      if (url === '/api/triggers' && !init?.method) {
        return Promise.resolve(jsonResponse(200, { triggers: [STRIPE_TRIGGER], funnel: { port: 8443, baseUrl: null, command: 'tailscale funnel' } }));
      }
      if (url === '/api/triggers/trg_aaaaaaaaaaaa/signing-secret' && init?.method === 'PUT') {
        return Promise.resolve(jsonResponse(200, { trigger: { ...STRIPE_TRIGGER, signingSecretSet: true } }));
      }
      return Promise.resolve(jsonResponse(404, { error: 'not found' }));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('blocks a Project target without a template before any request', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OpenDialog />);

    await user.type(screen.getByLabelText('Name'), 'deploys');
    await user.click(screen.getByLabelText('Project'));
    const projectSelect = await screen.findByRole('combobox', { name: 'Project' });
    await waitFor(() => expect(within(projectSelect).getByRole('option', { name: 'overdeck' })).toBeInTheDocument());
    await user.selectOptions(projectSelect, 'overdeck');
    await user.click(screen.getByRole('button', { name: 'Create trigger' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('A project trigger needs a prompt template.');
    expect(callsWith('POST')).toHaveLength(0);
  });

  it('shows the URL and generated signing secret once, and closing removes them from the DOM', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OpenDialog />);

    await user.type(screen.getByLabelText('Name'), 'ci-failures');
    await user.type(screen.getByLabelText('Conversation (name or id)'), '20261101-0001');
    await user.selectOptions(screen.getByLabelText('Verification'), 'github');
    await user.click(screen.getByRole('button', { name: 'Create trigger' }));

    expect(await screen.findByTestId('trigger-created-url')).toHaveTextContent(`https://desk.tailnet.ts.net:8443/hooks/trg_bbbbbbbbbbbb/${URL_SECRET}`);
    expect(screen.getByTestId('trigger-created-signing-secret')).toHaveTextContent(SIGNING_SECRET);
    expect(screen.getByText('This URL is shown once. Save it now.')).toBeInTheDocument();
    const posted = JSON.parse(String((callsWith('POST')[0]?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(posted).toMatchObject({ name: 'ci-failures', target: { kind: 'conversation', conversation: '20261101-0001' }, verify: 'github' });

    await user.click(screen.getByTestId('trigger-dialog-backdrop'));
    expect(screen.getByTestId('trigger-created-url')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByTestId('trigger-created-url')).toBeNull();
    expect(document.body.textContent).not.toContain(URL_SECRET);
  });

  it('offers the overdeck.ai inbox on the Anywhere plan and shows the inbox URL instead of the Funnel URL (PAN-2356)', async () => {
    const inboxUrl = `https://connect.overdeck.ai/h/${'d'.repeat(64)}.${'e'.repeat(32)}`;
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/directory') {
        return Promise.resolve(jsonResponse(200, {
          signedIn: true, state: 'online', url: 'https://connect.overdeck.ai', plan: 'tester', refusal: null,
          machines: [], approvals: [], joins: [], relay: null,
        }));
      }
      if (url === '/api/triggers' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse(201, {
          trigger: { ...STRIPE_TRIGGER, id: 'trg_cccccccccccc', name: 'held', verify: 'none', inbox: { id: 'ib_0123456789abcdef', createdAt: '2026-11-01T00:00:00.000Z' } },
          hookPath: `/hooks/trg_cccccccccccc/${URL_SECRET}`,
          url: null,
          urlSecretShownOnce: true,
          generatedSigningSecret: null,
          inboxUrl,
        }));
      }
      return base(input, init);
    });
    const user = userEvent.setup();
    renderWithProviders(<OpenDialog />);

    await user.type(screen.getByLabelText('Name'), 'held');
    await user.type(screen.getByLabelText('Conversation (name or id)'), '20261101-0001');
    await user.click(await screen.findByLabelText('Hold events while this machine is offline (overdeck.ai inbox, Anywhere plan)'));
    await user.click(screen.getByRole('button', { name: 'Create trigger' }));

    expect(await screen.findByTestId('trigger-created-inbox-url')).toHaveTextContent(inboxUrl);
    expect(screen.queryByTestId('trigger-created-url')).toBeNull();
    const posted = JSON.parse(String((callsWith('POST')[0]?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(posted).toMatchObject({ name: 'held', inbox: true });
  });

  it('hides the inbox option when the directory is not connected on the Anywhere plan (PAN-2356)', async () => {
    renderWithProviders(<OpenDialog />);
    await screen.findByLabelText('Name');
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => input.toString() === '/api/directory')).toBe(true));
    expect(screen.queryByLabelText(/overdeck.ai inbox/)).toBeNull();
  });

  it('shows a server error inline', async () => {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) =>
      Promise.resolve(input.toString() === '/api/triggers' && init?.method === 'POST'
        ? jsonResponse(400, { error: 'No conversation named or numbered "nope".' })
        : jsonResponse(200, [])));
    const user = userEvent.setup();
    renderWithProviders(<OpenDialog />);

    await user.type(screen.getByLabelText('Name'), 'ci');
    await user.type(screen.getByLabelText('Conversation (name or id)'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Create trigger' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No conversation named or numbered "nope".');
  });

  it('Set signing secret sends PUT /api/triggers/<id>/signing-secret', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TriggersPanel />);

    await user.click(await screen.findByRole('button', { name: 'Set signing secret' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Stripe endpoint secret/), 'whsec_new_secret');
    await user.click(within(dialog).getByRole('button', { name: 'Save secret' }));

    await waitFor(() => expect(callsWith('PUT')).toHaveLength(1));
    expect(callsWith('PUT')[0]?.[0]).toBe('/api/triggers/trg_aaaaaaaaaaaa/signing-secret');
    expect(JSON.parse(String((callsWith('PUT')[0]?.[1] as RequestInit).body))).toEqual({ secret: 'whsec_new_secret' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

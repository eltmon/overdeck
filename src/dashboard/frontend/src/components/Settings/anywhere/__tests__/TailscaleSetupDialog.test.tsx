import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { TailscaleSetupDialog } from '../TailscaleSetupDialog';
import { AnywhereSection } from '../../sections/AnywhereSection';
import { DialogProvider } from '../../../DialogProvider';
import type { TailscaleStatusBody } from '../tailscaleApi';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));
vi.mock('../../../XTerminal', () => ({
  XTerminal: ({ sessionName }: { sessionName: string }) => <div data-testid="x-terminal">{sessionName}</div>,
}));

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) } as Response;
}

const INSTALLER = 'curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale set --operator=op';

function tailscaleStatus(nextStep: TailscaleStatusBody['state']['nextStep'], overrides: Partial<TailscaleStatusBody['state']> = {}): TailscaleStatusBody {
  return {
    state: {
      installed: nextStep !== 'install',
      mode: nextStep === 'install' ? null : 'system',
      version: '1.104.4',
      daemonRunning: true,
      backendState: nextStep === 'login' ? 'NeedsLogin' : 'Running',
      authUrl: null,
      magicDnsName: 'desk.tailnet.ts.net',
      serveUrl: 'https://desk.tailnet.ts.net',
      loginName: 'me@example.com',
      serve: { proxiesDashboard: nextStep === 'protect' || nextStep === 'ready', otherHandlerOn443: false, funnelOn443: false },
      requireTokenMint: nextStep === 'ready',
      nextStep,
      ...overrides,
    },
    install: { kind: 'pane', command: INSTALLER },
    operatorCommand: 'sudo tailscale set --operator=op',
    port: 3011,
    platform: 'linux',
    userspaceAvailable: false,
  };
}

function anywhereStatus(viewerKind: string, problems: unknown[] = []) {
  return {
    machine: { environmentId: '0f0e0d0c-0000-4000-8000-000000000000', label: 'desk' },
    addresses: [{ origin: 'https://desk.tailnet.ts.net', loopback: false }],
    devices: { active: 0 },
    vault: { state: 'off', backend: null },
    problems,
    tailscale: { nextStep: 'protect', serveUrl: 'https://desk.tailnet.ts.net', magicDnsName: 'desk.tailnet.ts.net' },
    viewer: { kind: viewerKind },
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
let current: TailscaleStatusBody;
let loginResponse: Response;
let anywhere: ReturnType<typeof anywhereStatus>;

function calls(method: string, url: string) {
  return fetchMock.mock.calls.filter(([input, init]) => input.toString() === url && ((init as RequestInit | undefined)?.method ?? 'GET') === method);
}

beforeEach(() => {
  current = tailscaleStatus('install');
  loginResponse = jsonResponse(200, { authUrl: 'https://login.tailscale.com/a/abc' });
  anywhere = anywhereStatus('root-session');
  fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    const method = init?.method ?? 'GET';
    if (url.startsWith('/api/tailscale/status')) return Promise.resolve(jsonResponse(200, current));
    if (url === '/api/terminals' && method === 'POST') return Promise.resolve(jsonResponse(201, { sessionName: 'term-ts-1', cwd: '/home/op' }));
    if (url.startsWith('/api/terminals/') && method === 'DELETE') return Promise.resolve(jsonResponse(200, { ok: true }));
    if (url === '/api/tailscale/login') return Promise.resolve(loginResponse);
    if (url === '/api/tailscale/serve') return Promise.resolve(jsonResponse(200, { ok: true, url: 'https://desk.tailnet.ts.net', selfCheck: 'passed', changed: true }));
    if (url === '/api/anywhere/status') return Promise.resolve(jsonResponse(200, anywhere));
    if (url === '/api/devices') return Promise.resolve(jsonResponse(200, { devices: [] }));
    return Promise.resolve(jsonResponse(404, { error: 'not found' }));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  // Unmount first: the dialog deletes its panes on unmount, through the stubbed fetch.
  cleanup();
  vi.unstubAllGlobals();
});

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderDialog(onClose = vi.fn()) {
  const view = render(
    <QueryClientProvider client={client()}>
      <TailscaleSetupDialog open onClose={onClose} />
    </QueryClientProvider>,
  );
  return { ...view, onClose };
}

describe('TailscaleSetupDialog (PAN-1254)', () => {
  it('runs the install command in a pane and shows its terminal', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByRole('button', { name: 'Install Tailscale' }));

    const [, init] = calls('POST', '/api/terminals')[0]!;
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ command: INSTALLER });
    expect(await screen.findByTestId('x-terminal')).toHaveTextContent('term-ts-1');
    expect(screen.getByText('Type your password in the terminal if asked. Overdeck never sees it.')).toBeInTheDocument();
  });

  it('signs in with an Open sign-in link', async () => {
    const user = userEvent.setup();
    current = tailscaleStatus('login');
    renderDialog();
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(calls('POST', '/api/tailscale/login')).toHaveLength(1);
    expect(await screen.findByRole('link', { name: 'Open sign-in' })).toHaveAttribute('href', 'https://login.tailscale.com/a/abc');
  });

  it('switches to the operator panel when sign-in is denied', async () => {
    const user = userEvent.setup();
    current = tailscaleStatus('login', { operator: 'unknown' } as Partial<TailscaleStatusBody['state']>);
    loginResponse = jsonResponse(409, { error: 'Access denied', nextStep: 'operator' });
    renderDialog();
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('button', { name: 'Make this user the operator' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open sign-in' })).toBeNull();
  });

  it('names token sign-in before Turn on HTTPS access and POSTs serve', async () => {
    const user = userEvent.setup();
    current = tailscaleStatus('serve');
    renderDialog();
    const button = await screen.findByRole('button', { name: 'Turn on HTTPS access' });
    const notice = screen.getByText(/Require a token to sign in/);
    expect(notice.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(button);
    expect(calls('POST', '/api/tailscale/serve')).toHaveLength(1);
  });

  it('offers Protect the dashboard for the protect step and POSTs serve', async () => {
    const user = userEvent.setup();
    current = tailscaleStatus('protect');
    renderDialog();
    await user.click(await screen.findByRole('button', { name: 'Protect the dashboard' }));
    expect(calls('POST', '/api/tailscale/serve')).toHaveLength(1);
  });

  it('shows a refused serve with its admin link', async () => {
    const user = userEvent.setup();
    current = tailscaleStatus('serve');
    fetchMock.mockImplementationOnce(() => Promise.resolve(jsonResponse(200, current)));
    renderDialog();
    const button = await screen.findByRole('button', { name: 'Turn on HTTPS access' });
    fetchMock.mockImplementation((input: string | URL | Request) => {
      const url = input.toString();
      if (url === '/api/tailscale/serve') {
        return Promise.resolve(jsonResponse(409, { ok: false, reason: 'https-disabled', message: 'Enable Serve for your tailnet, then try again.', adminUrl: 'https://login.tailscale.com/f/serve' }));
      }
      return Promise.resolve(jsonResponse(200, current));
    });
    await user.click(button);
    expect(await screen.findByText(/Enable Serve for your tailnet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', 'https://login.tailscale.com/f/serve');
  });

  it('deletes the panes it created when it closes', async () => {
    const user = userEvent.setup();
    const queryClient = client();
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <TailscaleSetupDialog open onClose={() => undefined} />
      </QueryClientProvider>,
    );
    await user.click(await screen.findByRole('button', { name: 'Install Tailscale' }));
    await screen.findByTestId('x-terminal');
    rerender(
      <QueryClientProvider client={queryClient}>
        <TailscaleSetupDialog open={false} onClose={() => undefined} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(calls('DELETE', '/api/terminals/term-ts-1')).toHaveLength(1));
  });
});

describe('AnywhereSection Set up Tailscale (PAN-1254)', () => {
  function renderSection() {
    return render(
      <QueryClientProvider client={client()}>
        <DialogProvider>
          <AnywhereSection />
        </DialogProvider>
      </QueryClientProvider>,
    );
  }

  it('opens the setup dialog from the status card fix action', async () => {
    const user = userEvent.setup();
    anywhere = anywhereStatus('root-session', [{
      code: 'tailscale-serve-unprotected',
      message: 'Tailscale Serve sends tailnet visitors to this dashboard, but a token is not required to sign in.',
      action: { kind: 'tailscale-setup' },
    }]);
    current = tailscaleStatus('protect');
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Protect the dashboard' }));
    expect(await screen.findByRole('dialog', { name: 'Set up Tailscale' })).toBeInTheDocument();
  });

  it('shows Set up Tailscale to the root session', async () => {
    renderSection();
    expect(await screen.findByRole('button', { name: 'Set up Tailscale' })).toBeInTheDocument();
  });

  it('hides Set up Tailscale from a paired device', async () => {
    anywhere = anywhereStatus('device');
    renderSection();
    await screen.findByTestId('anywhere-tailscale');
    expect(screen.queryByRole('button', { name: 'Set up Tailscale' })).toBeNull();
  });
});

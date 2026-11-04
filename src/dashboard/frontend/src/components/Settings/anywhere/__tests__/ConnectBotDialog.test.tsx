import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { buildConnectorPairLink, parseConnectorPairLink } from '@overdeck/contracts';

import { ConnectBotDialog } from '../ConnectBotDialog';

vi.mock('../../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) } as Response;
}

const ENVIRONMENT = {
  descriptorVersion: 1,
  environmentId: '0f0e0d0c-0000-4000-8000-000000000000',
  label: 'desk',
  platform: { os: 'linux', arch: 'x64' },
  serverVersion: '0.60.0',
  protocolVersion: 1,
  capabilities: {},
};

const PAIRING_STRING = buildConnectorPairLink({
  environmentId: '0f0e0d0c-0000-4000-8000-000000000000',
  machineKeyHex: '1'.repeat(64),
  code: `odp_${'2'.repeat(64)}`,
});

let fetchMock: ReturnType<typeof vi.fn>;

function mockServer(pairingStatus: number) {
  fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    if (url === '/api/environment') return Promise.resolve(jsonResponse(200, ENVIRONMENT));
    if (url === '/api/connectors/pairing' && init?.method === 'POST') {
      return Promise.resolve(pairingStatus === 200
        ? jsonResponse(200, { pairingString: PAIRING_STRING, expiresAt: '2026-11-03T00:10:00Z' })
        : jsonResponse(403, { error: 'only the internal token or the root session can manage connectors' }));
    }
    return Promise.resolve(jsonResponse(404, { error: 'not found' }));
  });
  vi.stubGlobal('fetch', fetchMock);
}

function postedPairingBody(): { name: string; scopes: string[] } {
  const call = fetchMock.mock.calls.find(([input, init]) => input.toString() === '/api/connectors/pairing' && (init as RequestInit | undefined)?.method === 'POST');
  return JSON.parse(String((call?.[1] as RequestInit).body)) as { name: string; scopes: string[] };
}

async function renderDialog() {
  const user = userEvent.setup();
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ConnectBotDialog open onClose={() => undefined} />
    </QueryClientProvider>,
  );
  return { user };
}

describe('ConnectBotDialog (PAN-4951 WI-3)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the default scopes and the default Hermes name on the default form', async () => {
    mockServer(200);
    const { user } = await renderDialog();

    await user.click(screen.getByRole('button', { name: 'Create pairing code' }));
    await screen.findByLabelText('Pairing string');

    const body = postedPairingBody();
    expect(body.scopes).toEqual(['read:state', 'read:conversations', 'tell']);
    expect(body.name).toBe('Hermes bot');
  });

  it('adds approve to the body once it is ticked', async () => {
    mockServer(200);
    const { user } = await renderDialog();

    await user.click(screen.getByLabelText('Approve', { exact: false }));
    await user.click(screen.getByRole('button', { name: 'Create pairing code' }));
    await screen.findByLabelText('Pairing string');

    expect(postedPairingBody().scopes).toContain('approve');
  });

  it('renders read:state as checked and disabled, and unticking tell removes it from the body', async () => {
    mockServer(200);
    const { user } = await renderDialog();

    expect(screen.getByLabelText('Read state (always on)')).toBeChecked();
    expect(screen.getByLabelText('Read state (always on)')).toBeDisabled();

    await user.click(screen.getByLabelText('Send messages'));
    await user.click(screen.getByRole('button', { name: 'Create pairing code' }));
    await screen.findByLabelText('Pairing string');

    expect(postedPairingBody().scopes).not.toContain('tell');
  });

  it('renders a parseable pairing string and the connector pair command with the server version', async () => {
    mockServer(200);
    const { user } = await renderDialog();

    await user.click(screen.getByRole('button', { name: 'Create pairing code' }));

    const pairingField = await screen.findByLabelText('Pairing string');
    expect(parseConnectorPairLink((pairingField as HTMLInputElement).value)).not.toBeNull();

    await waitFor(() => {
      expect(String((screen.getByLabelText('Connector commands') as HTMLTextAreaElement).value))
        .toContain('npx -y @overdeck/core@0.60.0 mcp connector pair');
    });
  });

  it('explains a 403 from a browser that is not on this machine', async () => {
    mockServer(403);
    const { user } = await renderDialog();

    await user.click(screen.getByRole('button', { name: 'Create pairing code' }));

    expect(await screen.findByText('Only a browser on this machine can connect bots.')).toBeInTheDocument();
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionVaultJoinForm } from '../SessionVaultJoinForm';

vi.mock('../../../../lib/wsTransport', () => ({
  ensureDashboardSession: vi.fn().mockResolvedValue(undefined),
  dashboardMutationJsonHeaders: vi.fn().mockResolvedValue({ 'Content-Type': 'application/json' }),
}));

const REMOTE = 'git@github.com:me/overdeck-vault.git';
const JOINED = { status: 'joined', backend: REMOTE, machine: { label: 'laptop', environmentId: 'e' }, records: 3, offline: false, via: 'passphrase' };

function mockJoin(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function postedBody(fetchMock: ReturnType<typeof mockJoin>): { url: string; secret: { kind: string; value: string } } {
  const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(path).toBe('/api/vault/join');
  return JSON.parse(String(init.body));
}

describe('SessionVaultJoinForm (PAN-4446 WI-8)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ac1: passphrase mode posts secret.kind passphrase and reports the join', async () => {
    const fetchMock = mockJoin(200, JOINED);
    const onDone = vi.fn();
    render(<SessionVaultJoinForm mode="join" backend={null} onDone={onDone} />);
    expect(screen.getByText('Join an existing vault')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Git URL'), { target: { value: REMOTE } });
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'quiet harbor lantern 42 mosaic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Joined as laptop. 3 saved conversation(s) listed.'));
    expect(postedBody(fetchMock)).toEqual({ url: REMOTE, secret: { kind: 'passphrase', value: 'quiet harbor lantern 42 mosaic' } });
    expect((screen.getByLabelText('Passphrase') as HTMLInputElement).value).toBe('');
  });

  it('ac2: after "Use the recovery phrase instead" it posts secret.kind phrase', async () => {
    const fetchMock = mockJoin(200, { ...JOINED, via: 'phrase' });
    render(<SessionVaultJoinForm mode="join" backend={null} onDone={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Git URL'), { target: { value: REMOTE } });
    fireEvent.click(screen.getByRole('button', { name: 'Use the recovery phrase instead' }));
    expect(screen.queryByLabelText('Passphrase')).toBeNull();
    fireEvent.change(screen.getByLabelText('Recovery phrase (24 words)'), { target: { value: 'abandon ability able' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(postedBody(fetchMock).secret).toEqual({ kind: 'phrase', value: 'abandon ability able' });
    expect(screen.getByRole('button', { name: 'Use the passphrase instead' })).toBeTruthy();
  });

  it('ac3: unlock mode shows the backend read-only under "Unlock this machine"', () => {
    render(<SessionVaultJoinForm mode="unlock" backend="dir:/v" onDone={vi.fn()} />);
    expect(screen.getByText('Unlock this machine')).toBeTruthy();
    const url = screen.getByLabelText('Git URL') as HTMLInputElement;
    expect(url.value).toBe('dir:/v');
    expect(url.readOnly).toBe(true);
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeTruthy();
  });

  it('a 422 not-a-vault response points at the setup form instead of the CLI', async () => {
    mockJoin(422, { status: 'error', code: 'not-a-vault', message: `${REMOTE} is not a Session Vault yet. Run: pan vault setup ${REMOTE}` });
    const onDone = vi.fn();
    render(<SessionVaultJoinForm mode="join" backend={null} onDone={onDone} />);
    fireEvent.change(screen.getByLabelText('Git URL'), { target: { value: REMOTE } });
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    await waitFor(() => expect(screen.getByText('This remote is not a Session Vault yet. Use “Set up a new vault” above.')).toBeTruthy());
    expect(screen.queryByText(/Run: pan vault setup/)).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
  });
});

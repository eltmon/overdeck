import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecoveryDialog, SessionVaultSetupForm } from '../SessionVaultSetupForm';

vi.mock('../../../../lib/wsTransport', () => ({
  ensureDashboardSession: vi.fn().mockResolvedValue(undefined),
  dashboardMutationJsonHeaders: vi.fn().mockResolvedValue({ 'Content-Type': 'application/json' }),
}));

const REMOTE = 'git@github.com:me/overdeck-vault.git';
const PHRASE = Array.from({ length: 24 }, (_, i) => `word${String.fromCharCode(97 + (i % 26))}`).join(' ');

function mockSetup(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function submit(url = REMOTE) {
  fireEvent.change(screen.getByLabelText('Git URL'), { target: { value: url } });
  fireEvent.click(screen.getByRole('button', { name: 'Set up vault' }));
}

describe('SessionVaultSetupForm (PAN-4446 WI-7)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ac1: the default form posts { url, passphrase: { mode: generate } } to /api/vault/setup', async () => {
    const fetchMock = mockSetup(200, { status: 'already-set-up', backend: REMOTE });
    const onDone = vi.fn();
    render(<SessionVaultSetupForm onDone={onDone} onCreated={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Set up vault' }) as HTMLButtonElement).disabled).toBe(true);

    submit();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/api/vault/setup');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ url: REMOTE, passphrase: { mode: 'generate' } });
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('This machine is already set up with this vault.'));
  });

  it('ac2: a created response hands the shown-once secrets to onCreated and does not call onDone', async () => {
    mockSetup(200, {
      status: 'created',
      backend: REMOTE,
      machine: { label: 'desk', environmentId: 'e' },
      recoveryPhrase: PHRASE,
      passphrase: { stored: true, generated: 'one two three four five six' },
    });
    const onDone = vi.fn();
    const onCreated = vi.fn();
    render(<SessionVaultSetupForm onDone={onDone} onCreated={onCreated} />);
    submit();

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ recoveryPhrase: PHRASE, generated: 'one two three four five six', passphraseError: null }));
    expect(onDone).not.toHaveBeenCalled();
  });

  it('ac2: the recovery dialog shows the phrase and Done stays disabled until "I wrote it down" is checked', () => {
    const onDone = vi.fn();
    render(<RecoveryDialog secrets={{ recoveryPhrase: PHRASE, generated: 'one two three four five six', passphraseError: null }} onDone={onDone} />);

    expect((screen.getByTestId('vault-recovery-phrase') as HTMLTextAreaElement).value).toBe(PHRASE);
    expect((screen.getByTestId('vault-generated-passphrase') as HTMLInputElement).value).toBe('one two three four five six');
    const done = screen.getByRole('button', { name: 'Done' }) as HTMLButtonElement;
    expect(done.disabled).toBe(true);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onDone).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('I wrote it down'));
    expect(done.disabled).toBe(false);
    fireEvent.click(done);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('ac3: a 422 foreign-vault response shows the join hint instead of the server message', async () => {
    mockSetup(422, { status: 'error', code: 'foreign-vault', message: `${REMOTE} is already a vault protected by another key. Run: pan vault join ${REMOTE}` });
    render(<SessionVaultSetupForm onDone={vi.fn()} onCreated={vi.fn()} />);
    submit();

    await waitFor(() => expect(screen.getByText('This remote already holds a vault. Use “Join an existing vault” below.')).toBeTruthy());
    expect(screen.queryByText(/Run: pan vault join/)).toBeNull();
  });

  it('a custom passphrase posts mode custom and the button waits for 16 characters', async () => {
    const fetchMock = mockSetup(200, { status: 'already-set-up', backend: REMOTE });
    render(<SessionVaultSetupForm onDone={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Git URL'), { target: { value: REMOTE } });
    fireEvent.click(screen.getByLabelText('My own'));
    const button = screen.getByRole('button', { name: 'Set up vault' }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText('Passphrase (16+ characters)'), { target: { value: 'short' } });
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Passphrase (16+ characters)'), { target: { value: 'quiet harbor lantern 42' } });
    fireEvent.click(button);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).passphrase).toEqual({ mode: 'custom', value: 'quiet harbor lantern 42' });
  });
});

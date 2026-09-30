import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DialogProvider } from '../../../DialogProvider';
import { AccessTokensSection } from '../AccessTokensSection';
import { SETTINGS_NAV_ITEMS } from '../../settingsPageConstants';
import { type SettingsConfig } from '../../types';

vi.mock('../../../../lib/wsTransport', () => ({
  ensureDashboardSession: vi.fn().mockResolvedValue(undefined),
  dashboardMutationJsonHeaders: vi.fn().mockResolvedValue({ 'Content-Type': 'application/json' }),
}));

const RECORD_A = {
  id: 'tok-a',
  name: 'ci-bot',
  scopes: ['read:events', 'tell'],
  createdAt: '2026-09-01T00:00:00.000Z',
  lastUsedAt: null,
};

const RECORD_B = {
  id: 'tok-b',
  name: 'old-script',
  scopes: ['admin'],
  createdAt: '2026-08-01T00:00:00.000Z',
  lastUsedAt: '2026-08-15T00:00:00.000Z',
  revokedAt: '2026-08-20T00:00:00.000Z',
};

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DialogProvider>
        <AccessTokensSection formData={{} as SettingsConfig} onSettingsChange={vi.fn()} />
      </DialogProvider>
    </QueryClientProvider>,
  );
}

function mockFetch(opts: {
  tokens?: unknown[];
  listStatus?: number;
  listError?: string;
  onDelete?: (id: string) => void;
  deleteStatus?: number;
  deleteError?: string;
  onCreate?: (body: { name: string; scopes: string[] }) => void;
  createStatus?: number;
  createError?: string;
} = {}) {
  const tokens = opts.tokens ?? [RECORD_A, RECORD_B];
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    if (url === '/api/access-tokens' && (!init || init.method === undefined)) {
      if (opts.listStatus && opts.listStatus !== 200) {
        return new Response(JSON.stringify({ error: opts.listError ?? 'forbidden' }), { status: opts.listStatus });
      }
      return new Response(JSON.stringify({ tokens }), { status: 200 });
    }
    if (url === '/api/access-tokens' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { name: string; scopes: string[] };
      if (opts.createStatus && opts.createStatus !== 200) {
        return new Response(JSON.stringify({ error: opts.createError ?? 'forbidden' }), { status: opts.createStatus });
      }
      opts.onCreate?.(body);
      return new Response(JSON.stringify({
        token: 'odk_plaintext_example',
        record: { id: 'tok-new', name: body.name, scopes: body.scopes, createdAt: '2026-09-06T00:00:00.000Z', lastUsedAt: null },
      }), { status: 200 });
    }
    if (url.startsWith('/api/access-tokens/') && init?.method === 'DELETE') {
      const id = decodeURIComponent(url.split('/').pop() ?? '');
      if (opts.deleteStatus && opts.deleteStatus !== 200) {
        return new Response(JSON.stringify({ error: opts.deleteError ?? 'forbidden' }), { status: opts.deleteStatus });
      }
      opts.onDelete?.(id);
      return new Response(JSON.stringify({ ok: true, token: { ...RECORD_A, id, revokedAt: '2026-09-05T00:00:00.000Z' } }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });
}

describe('AccessTokensSection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders each record with name, scopes, Never for a null lastUsedAt, and the revoked time for a revoked one', async () => {
    mockFetch();
    renderSection();

    expect(await screen.findByText('ci-bot')).toBeInTheDocument();
    expect(screen.getByText('read:events, tell')).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument();

    expect(screen.getByText('old-script')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText(new Date(RECORD_B.revokedAt).toLocaleString())).toBeInTheDocument();
  });

  it('has no Revoke button on a revoked row', async () => {
    mockFetch();
    renderSection();

    await screen.findByText('old-script');
    expect(screen.queryByTestId(`access-token-revoke-${RECORD_B.id}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`access-token-revoke-${RECORD_A.id}`)).toBeInTheDocument();
  });

  it('sends DELETE and re-fetches the list when Revoke is clicked and confirmed', async () => {
    const onDelete = vi.fn();
    mockFetch({ onDelete });
    renderSection();

    fireEvent.click(await screen.findByTestId(`access-token-revoke-${RECORD_A.id}`));

    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(RECORD_A.id));
  });

  it('renders access-tokens-forbidden with the server error and the D-8 sentence on a 403 from the list', async () => {
    mockFetch({ listStatus: 403, listError: 'scoped tokens may not list access tokens' });
    renderSection();

    const notice = await screen.findByTestId('access-tokens-forbidden');
    expect(notice.textContent).toContain('scoped tokens may not list access tokens');
    expect(notice.textContent).toContain("Only this machine's own dashboard session");
  });

  it('renders the same notice, with the table still rendered, on a 403 from revoke', async () => {
    mockFetch({ deleteStatus: 403, deleteError: 'scoped tokens may not revoke access tokens' });
    renderSection();

    fireEvent.click(await screen.findByTestId(`access-token-revoke-${RECORD_A.id}`));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));

    const notice = await screen.findByTestId('access-tokens-forbidden');
    expect(notice.textContent).toContain('scoped tokens may not revoke access tokens');
    expect(screen.getByText('ci-bot')).toBeInTheDocument();
  });

  it('renders "No access tokens yet." when the list is empty', async () => {
    mockFetch({ tokens: [] });
    renderSection();

    expect(await screen.findByText('No access tokens yet.')).toBeInTheDocument();
  });

  it('places an access-tokens nav entry right after remote', () => {
    const ids = SETTINGS_NAV_ITEMS.map((item) => item.id);
    const remoteIndex = ids.indexOf('remote');
    expect(remoteIndex).toBeGreaterThanOrEqual(0);
    expect(ids[remoteIndex + 1]).toBe('access-tokens');
  });
});

describe('AccessTokensSection — create-token dialog (PAN-4435 WI-5)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function openDialog() {
    fireEvent.click(screen.getByTestId('access-token-create'));
    return screen.getByRole('dialog');
  }

  it('keeps Create disabled with a blank name or no scope checked', async () => {
    mockFetch();
    renderSection();
    await screen.findByText('ci-bot');

    const dialog = openDialog();
    const createButton = within(dialog).getByRole('button', { name: 'Create' });
    expect(createButton).toBeDisabled();

    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'my-script' } });
    expect(createButton).toBeDisabled();

    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'tell' }));
    expect(createButton).not.toBeDisabled();
  });

  it('posts { name, scopes } and shows the returned plaintext token', async () => {
    const onCreate = vi.fn();
    mockFetch({ onCreate });
    renderSection();
    await screen.findByText('ci-bot');

    const dialog = openDialog();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'my-script' } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'tell' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ name: 'my-script', scopes: ['tell'] }));
    expect(await within(dialog).findByTestId('access-token-plaintext')).toHaveValue('odk_plaintext_example');
  });

  it('copies the plaintext token to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    mockFetch();
    renderSection();
    await screen.findByText('ci-bot');

    const dialog = openDialog();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'my-script' } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'tell' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await within(dialog).findByTestId('access-token-plaintext');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('odk_plaintext_example'));
    expect(await within(dialog).findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('clears the plaintext and the name field after Close and reopening', async () => {
    mockFetch();
    renderSection();
    await screen.findByText('ci-bot');

    let dialog = openDialog();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'my-script' } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'tell' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await within(dialog).findByTestId('access-token-plaintext');

    // Close via the header's X button (the only button while the plaintext view is shown).
    fireEvent.click(within(dialog).getAllByRole('button')[0]);

    dialog = openDialog();
    expect(within(dialog).queryByTestId('access-token-plaintext')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('textbox')).toHaveValue('');
  });

  it('shows the forbidden notice inside the dialog on a 403 from create', async () => {
    mockFetch({ createStatus: 403, createError: 'scoped tokens may not create access tokens' });
    renderSection();
    await screen.findByText('ci-bot');

    const dialog = openDialog();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'my-script' } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'tell' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    const notice = await within(dialog).findByTestId('access-tokens-forbidden');
    expect(notice.textContent).toContain('scoped tokens may not create access tokens');
    expect(notice.textContent).toContain("Only this machine's own dashboard session");
  });
});

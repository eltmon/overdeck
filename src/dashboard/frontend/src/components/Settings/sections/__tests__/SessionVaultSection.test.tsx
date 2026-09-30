import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionVaultSection } from '../SessionVaultSection';

vi.mock('../../../../lib/wsTransport', () => ({
  ensureDashboardSession: vi.fn().mockResolvedValue(undefined),
  dashboardMutationJsonHeaders: vi.fn().mockResolvedValue({ 'Content-Type': 'application/json' }),
}));

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: toastMocks }));

const READY_STATUS = {
  state: 'ready' as const,
  running: true,
  backend: 'dir:/tmp/vault',
  evict: true,
  lastSync: {
    at: '2026-09-30T00:00:00.000Z',
    offline: false,
    records: 2,
    appended: 1,
    errors: [],
    blocked: [],
  },
  machines: [
    { label: 'this-host', isThisMachine: true, lastSyncedAt: '2026-09-30T00:00:00.000Z' },
    { label: 'other-host', isThisMachine: false, lastSyncedAt: '2026-09-29T00:00:00.000Z' },
  ],
};

const OFF_STATUS = {
  state: 'off' as const,
  running: false,
  backend: null,
  evict: false,
  lastSync: null,
  machines: [],
};

const MIXED_BATCH = {
  evict: true,
  fingerprint: 'fp-1',
  entries: [
    { vaultId: 'v1', title: 'ok session', harness: 'claude-code', nativePath: '/a.jsonl', sizeBytes: 1024, verification: 'verified' as const, checkedAt: 't' },
    { vaultId: 'v2', title: 'bad session', harness: 'codex', nativePath: '/b.jsonl', sizeBytes: 2048, verification: 'failed' as const, reason: 'file has bytes not yet settled', checkedAt: 't' },
  ],
  declined: [],
  totalBytes: 3072,
  deletableCount: 1,
  deletableBytes: 1024,
};

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SessionVaultSection />
    </QueryClientProvider>,
  );
}

function mockFetch(options: {
  status?: typeof READY_STATUS | typeof OFF_STATUS;
  batch?: typeof MIXED_BATCH;
  onConfirm?: (body: unknown) => { status: number; body: unknown };
  onDecline?: (body: unknown) => unknown;
}) {
  const status = options.status ?? READY_STATUS;
  const batch = options.batch ?? MIXED_BATCH;
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    if (url === '/api/vault/status' && (!init || init.method === undefined)) {
      return new Response(JSON.stringify(status), { status: 200 });
    }
    if (url === '/api/vault/eviction-batch' && (!init || init.method === undefined)) {
      return new Response(JSON.stringify(batch), { status: 200 });
    }
    if (url === '/api/vault/eviction-batch/confirm' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      const result = options.onConfirm?.(body) ?? { status: 200, body: { deleted: ['/a.jsonl'], skipped: [], bytesFreed: 1024, fingerprint: 'fp-2' } };
      return new Response(JSON.stringify(result.body), { status: result.status });
    }
    if (url === '/api/vault/eviction-batch/decline' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      const refreshed = options.onDecline?.(body) ?? { ...batch, entries: batch.entries.filter((e) => e.vaultId !== (body as { vaultId: string }).vaultId) };
      return new Response(JSON.stringify(refreshed), { status: 200 });
    }
    if (url === '/api/vault/eviction-batch/clear' && init?.method === 'POST') {
      return new Response(JSON.stringify({ ...batch, entries: [] }), { status: 200 });
    }
    if (url === '/api/vault/eviction-batch/reoffer' && init?.method === 'POST') {
      return new Response(JSON.stringify(batch), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });
}

describe('SessionVaultSection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    toastMocks.success.mockClear();
    toastMocks.warning.mockClear();
    toastMocks.error.mockClear();
  });

  it('shows the off-state text and nothing else when the vault is off', async () => {
    mockFetch({ status: OFF_STATUS });
    renderSection();

    await waitFor(() => expect(screen.getByText('Session Vault is off. Run: pan vault setup <git-url>')).toBeTruthy());
    expect(screen.queryByText('Machines')).toBeNull();
    expect(screen.queryByText('Pending deletion')).toBeNull();
  });

  it('renders a verified and a failed entry with their status', async () => {
    mockFetch({});
    renderSection();

    await waitFor(() => expect(screen.getByText('ok session')).toBeTruthy());
    expect(screen.getByText('verified', { selector: 'span' })).toBeTruthy();
    expect(screen.getByText('failed: file has bytes not yet settled', { selector: 'span' })).toBeTruthy();
  });

  it('the delete button counts only the verified entry and POSTs the displayed fingerprint', async () => {
    let confirmedFingerprint: string | null = null;
    mockFetch({
      onConfirm: (body) => {
        confirmedFingerprint = (body as { fingerprint: string }).fingerprint;
        return { status: 200, body: { deleted: ['/a.jsonl'], skipped: [], bytesFreed: 1024, fingerprint: 'fp-2' } };
      },
    });
    renderSection();

    const deleteButton = await screen.findByRole('button', { name: /Yes, delete these \(1 files, 1\.0 KB\)/ });
    fireEvent.click(deleteButton);

    await waitFor(() => expect(confirmedFingerprint).toBe('fp-1'));
    expect(toastMocks.success).toHaveBeenCalled();
  });

  it('the delete button POSTs the displayed verified vaultIds alongside the fingerprint', async () => {
    let confirmedIds: string[] | null = null;
    mockFetch({
      onConfirm: (body) => {
        confirmedIds = (body as { deletableVaultIds: string[] }).deletableVaultIds;
        return { status: 200, body: { deleted: ['/a.jsonl'], skipped: [], bytesFreed: 1024, fingerprint: 'fp-2' } };
      },
    });
    renderSection();

    const deleteButton = await screen.findByRole('button', { name: /Yes, delete these/ });
    fireEvent.click(deleteButton);

    await waitFor(() => expect(confirmedIds).toEqual(['v1']));
  });

  it('a 403/500 response to decline shows an error toast and never overwrites the batch cache with the error body', async () => {
    mockFetch({});
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/vault/status') return new Response(JSON.stringify(READY_STATUS), { status: 200 });
      if (url === '/api/vault/eviction-batch' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify(MIXED_BATCH), { status: 200 });
      }
      if (url === '/api/vault/eviction-batch/decline') {
        return new Response(JSON.stringify({ error: 'session expired' }), { status: 403 });
      }
      return new Response('not found', { status: 404 });
    });
    renderSection();

    await waitFor(() => expect(screen.getByText('ok session')).toBeTruthy());
    const declineButtons = screen.getAllByText('Decline');
    fireEvent.click(declineButtons[0]!);

    await waitFor(() => expect(toastMocks.error).toHaveBeenCalledWith('Failed to decline the transcript.'));
    // The cache must still show the real batch, never the { error } body swapped in for it.
    expect(screen.getByText('ok session')).toBeTruthy();
    expect(screen.queryByText('Eviction is off. Set "evict": true in ~/.overdeck/vault/config.json to review transcripts the vault holds.')).toBeNull();
  });

  it('a 409 batch-changed response triggers a refetch and shows no success toast', async () => {
    let confirmCalls = 0;
    mockFetch({
      onConfirm: () => {
        confirmCalls += 1;
        return { status: 409, body: { error: 'The pending-deletion batch changed since it was displayed.', code: 'batch-changed', fingerprint: 'fp-3' } };
      },
    });
    renderSection();

    const deleteButton = await screen.findByRole('button', { name: /Yes, delete these/ });
    const batchFetchesBefore = vi.mocked(global.fetch).mock.calls.filter(([input]) => input.toString() === '/api/vault/eviction-batch').length;

    fireEvent.click(deleteButton);

    await waitFor(() => expect(confirmCalls).toBe(1));
    await waitFor(() => expect(toastMocks.warning).toHaveBeenCalledWith('The batch changed since it was shown. Review it again.'));
    expect(toastMocks.success).not.toHaveBeenCalled();
    await waitFor(() => {
      const batchFetchesAfter = vi.mocked(global.fetch).mock.calls.filter(([input]) => input.toString() === '/api/vault/eviction-batch').length;
      expect(batchFetchesAfter).toBeGreaterThan(batchFetchesBefore);
    });
  });

  it('Decline POSTs the entry\'s vaultId', async () => {
    let declinedVaultId: string | null = null;
    mockFetch({
      onDecline: (body) => {
        declinedVaultId = (body as { vaultId: string }).vaultId;
        return { ...MIXED_BATCH, entries: MIXED_BATCH.entries.filter((e) => e.vaultId !== declinedVaultId) };
      },
    });
    renderSection();

    await waitFor(() => expect(screen.getByText('ok session')).toBeTruthy());
    const declineButtons = screen.getAllByText('Decline');
    fireEvent.click(declineButtons[0]!);

    await waitFor(() => expect(declinedVaultId).toBe('v1'));
  });

  it('a network failure on decline shows an error toast instead of an unhandled rejection', async () => {
    mockFetch({});
    const realFetch = global.fetch;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input.toString() === '/api/vault/eviction-batch/decline') throw new Error('network down');
      return realFetch(input, init);
    });
    renderSection();

    await waitFor(() => expect(screen.getByText('ok session')).toBeTruthy());
    const declineButtons = screen.getAllByText('Decline');
    fireEvent.click(declineButtons[0]!);

    await waitFor(() => expect(toastMocks.error).toHaveBeenCalledWith(expect.stringContaining('network down')));
    expect(screen.getByText('ok session')).toBeTruthy();
  });

  it('the machines table marks this machine', async () => {
    mockFetch({});
    renderSection();

    await waitFor(() => expect(screen.getAllByRole('row').length).toBeGreaterThan(0));
    const rows = screen.getAllByRole('row');
    const thisHostRow = rows.find((row) => row.textContent?.includes('this-host'));
    const otherHostRow = rows.find((row) => row.textContent?.includes('other-host'));
    expect(thisHostRow?.textContent).toContain('(this machine)');
    expect(otherHostRow?.textContent).not.toContain('(this machine)');
  });
});

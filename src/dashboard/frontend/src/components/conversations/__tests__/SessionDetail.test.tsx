/**
 * Real component tests for SessionDetail (PAN-457).
 *
 * These tests exercise the actual component — no mocks of SessionDetail itself —
 * to verify that enrichment controls are rendered, retry is accessible after
 * failure, and the close button works.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionDetail } from '../SessionDetail';

const rpcMocks = vi.hoisted(() => ({
  get: vi.fn(),
  enrich: vi.fn().mockResolvedValue({ processed: 1, totalCost: 0, failures: 0 }),
  embed: vi.fn().mockResolvedValue({ total: 1, embedded: 1, model: 'text-embedding-3-small' }),
  request: vi.fn((fn: (client: Record<string, unknown>) => unknown) => fn({
    'pan.getDiscoveredSession': rpcMocks.get,
    'pan.enrichSessions': rpcMocks.enrich,
    'pan.embedSessions': rpcMocks.embed,
  })),
}));

vi.mock('../../../lib/wsTransport', () => ({
  getTransport: () => ({ request: rpcMocks.request }),
}));

type Session = ComponentProps<typeof SessionDetail>['session'];

const BASE_SESSION: Session = {
  id: 42,
  jsonlPath: '/fake/42.jsonl',
  workspacePath: '/home/user/Projects/alpha',
  primaryModel: 'claude-sonnet-4-6',
  messageCount: 10,
  firstTs: '2025-01-01T00:00:00Z',
  lastTs: '2025-01-01T01:00:00Z',
  estimatedCost: 0.015,
  tokenInput: 300,
  tokenOutput: 150,
  toolsUsed: ['Read', 'Write'],
  filesTouched: ['/home/user/Projects/alpha/src/auth.ts', '/home/user/Projects/alpha/README.md'],
  tags: ['auth', 'bugfix'],
  summary: 'Fixed the authentication bug',
  summaryDetailed: null,
  enrichmentLevel: 0 as const,
  enrichmentFailed: false,
  panopticonManaged: false,
  panIssueId: null,
};

const ARCHIVED_SESSION: Session = {
  ...BASE_SESSION,
  id: 7,
  source: 'managed-archived',
  conversationName: 'archived session',
  archivedAt: '2025-01-02T00:00:00Z',
  panopticonManaged: true,
  panIssueId: 'PAN-1391',
};

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderDetail(
  session: Session,
  onClose = vi.fn(),
  fetchMock?: ReturnType<typeof vi.fn>,
) {
  const mock = fetchMock ?? vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(session),
  });
  vi.stubGlobal('fetch', mock);
  const client = makeClient();
  return {
    client,
    mock,
    onClose,
    ...render(
      <QueryClientProvider client={client}>
        <SessionDetail session={session} onClose={onClose} />
      </QueryClientProvider>,
    ),
  };
}

describe('SessionDetail', () => {
  beforeEach(() => {
    rpcMocks.get.mockResolvedValue(BASE_SESSION);
    rpcMocks.enrich.mockResolvedValue({ processed: 1, totalCost: 0, failures: 0 });
    rpcMocks.embed.mockResolvedValue({ total: 1, embedded: 1, model: 'text-embedding-3-small' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders session ID in the header', () => {
    renderDetail(BASE_SESSION);
    expect(screen.getByText('Session #42')).toBeInTheDocument();
  });

  it('shows summary when present', () => {
    renderDetail(BASE_SESSION);
    expect(screen.getByText('Fixed the authentication bug')).toBeInTheDocument();
  });

  it('shows ad-hoc and managed badges in the header', () => {
    const { rerender } = renderDetail(BASE_SESSION);
    expect(screen.getByText('Ad-hoc')).toBeInTheDocument();

    rerender(
      <QueryClientProvider client={makeClient()}>
        <SessionDetail session={{ ...BASE_SESSION, panopticonManaged: true, panIssueId: 'PAN-457' }} onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Managed · PAN-457')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    renderDetail(BASE_SESSION, onClose);
    const closeBtn = screen.getByRole('button', { name: '' }); // X icon button
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows Quick, Detailed, Deep, and Embed controls when enrichmentLevel is 0', () => {
    renderDetail(BASE_SESSION);
    expect(screen.getByText('Quick (L1)')).toBeInTheDocument();
    expect(screen.getByText('Detailed (L2)')).toBeInTheDocument();
    expect(screen.getByText('Deep (L3)')).toBeInTheDocument();
    expect(screen.getByText('Embed')).toBeInTheDocument();
  });

  it('hides Quick (L1) button when enrichmentLevel is 1', () => {
    renderDetail({ ...BASE_SESSION, enrichmentLevel: 1 as const });
    expect(screen.queryByText('Quick (L1)')).not.toBeInTheDocument();
    expect(screen.getByText('Detailed (L2)')).toBeInTheDocument();
    expect(screen.getByText('Deep (L3)')).toBeInTheDocument();
  });

  it('shows only Deep (L3) enrichment when enrichmentLevel is 2', () => {
    renderDetail({ ...BASE_SESSION, enrichmentLevel: 2 as const });
    expect(screen.queryByText('Quick (L1)')).not.toBeInTheDocument();
    expect(screen.queryByText('Detailed (L2)')).not.toBeInTheDocument();
    expect(screen.getByText('Deep (L3)')).toBeInTheDocument();
    expect(screen.getByText('Embed')).toBeInTheDocument();
  });

  it('hides enrichment actions after L3 but keeps embedding available', () => {
    renderDetail({ ...BASE_SESSION, enrichmentLevel: 3 as const });
    expect(screen.queryByText('Quick (L1)')).not.toBeInTheDocument();
    expect(screen.queryByText('Detailed (L2)')).not.toBeInTheDocument();
    expect(screen.queryByText('Deep (L3)')).not.toBeInTheDocument();
    expect(screen.getByText('Embed')).toBeInTheDocument();
  });

  it('still shows enrichment controls when enrichmentFailed is true (retry path)', () => {
    renderDetail({ ...BASE_SESSION, enrichmentLevel: 0 as const, enrichmentFailed: true });
    // Controls must still be present so user can retry
    expect(screen.getByText('Detailed (L2)')).toBeInTheDocument();
  });

  it('shows failed-retry label when enrichmentFailed is true', () => {
    renderDetail({ ...BASE_SESSION, enrichmentLevel: 0 as const, enrichmentFailed: true });
    expect(screen.getByText(/retry/i)).toBeInTheDocument();
  });

  it('shows enrichment error after failed mutation', async () => {
    rpcMocks.enrich.mockRejectedValueOnce(new Error('fail'));
    renderDetail(BASE_SESSION);

    fireEvent.click(screen.getByText('Quick (L1)'));
    await waitFor(() => expect(screen.getByText('Enrichment failed')).toBeInTheDocument());
  });

  it('dispatches L3 enrichment from the Deep control', async () => {
    renderDetail({ ...BASE_SESSION, enrichmentLevel: 2 as const });

    fireEvent.click(screen.getByText('Deep (L3)'));

    await waitFor(() => expect(rpcMocks.enrich).toHaveBeenCalledWith({
      ids: [42],
      level: 3,
      confirmed: undefined,
    }));
  });

  it('dispatches enrichment with a custom model override', async () => {
    renderDetail(BASE_SESSION);

    fireEvent.change(screen.getByPlaceholderText('Use default provider model'), {
      target: { value: 'claude-opus-4-7' },
    });
    fireEvent.click(screen.getByText('Quick (L1)'));

    await waitFor(() => expect(rpcMocks.enrich).toHaveBeenCalledWith({
      ids: [42],
      level: 1,
      confirmed: undefined,
      model: 'claude-opus-4-7',
    }));
  });

  it('dispatches embedding generation from the Embed control', async () => {
    renderDetail(BASE_SESSION);

    fireEvent.click(screen.getByText('Embed'));

    await waitFor(() => expect(rpcMocks.embed).toHaveBeenCalledWith({ ids: [42] }));
  });

  it('renders tags when present', () => {
    renderDetail(BASE_SESSION);
    expect(screen.getByText('auth')).toBeInTheDocument();
    expect(screen.getByText('bugfix')).toBeInTheDocument();
  });

  it('renders files touched when present', () => {
    renderDetail(BASE_SESSION);
    expect(screen.getByText('Files Touched')).toBeInTheDocument();
    expect(screen.getByText('/home/user/Projects/alpha/src/auth.ts')).toBeInTheDocument();
  });

  it('renders file path', () => {
    renderDetail(BASE_SESSION);
    expect(screen.getByText('/fake/42.jsonl')).toBeInTheDocument();
  });

  it('does not show Unarchive for discovered rows', () => {
    renderDetail(BASE_SESSION);
    expect(screen.queryByRole('button', { name: 'Unarchive' })).not.toBeInTheDocument();
  });

  it('shows an enabled Unarchive button for managed-archived rows', () => {
    renderDetail(ARCHIVED_SESSION);
    expect(screen.getByText('Archived at')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unarchive' })).toBeEnabled();
    expect(screen.queryByText('Quick (L1)')).not.toBeInTheDocument();
    expect(screen.queryByText('Embed')).not.toBeInTheDocument();
  });

  it('posts to the unarchive endpoint and invalidates archived conversations on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    const { client } = renderDetail(ARCHIVED_SESSION, vi.fn(), fetchMock);
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    fireEvent.click(screen.getByRole('button', { name: 'Unarchive' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/conversations/archived%20session/unarchive', {
      method: 'POST',
    }));
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['archived-conversations'] }));
    expect(screen.getByText('Conversation restored')).toBeInTheDocument();
  });

  it('shows an inline error and re-enables Unarchive after non-2xx responses', async () => {
    renderDetail(ARCHIVED_SESSION, vi.fn(), vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    fireEvent.click(screen.getByRole('button', { name: 'Unarchive' }));

    await waitFor(() => expect(screen.getByText('Unarchive failed: 500')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Unarchive' })).toBeEnabled();
  });
});

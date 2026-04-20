/**
 * Real component tests for SessionDetail (PAN-457).
 *
 * These tests exercise the actual component — no mocks of SessionDetail itself —
 * to verify that enrichment controls are rendered, retry is accessible after
 * failure, and the close button works.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionDetail } from '../SessionDetail';

const BASE_SESSION = {
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
  tags: ['auth', 'bugfix'],
  summary: 'Fixed the authentication bug',
  summaryDetailed: null,
  enrichmentLevel: 0 as const,
  enrichmentFailed: false,
  panopticonManaged: false,
  panIssueId: null,
};

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderDetail(
  session: typeof BASE_SESSION,
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

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    renderDetail(BASE_SESSION, onClose);
    const closeBtn = screen.getByRole('button', { name: '' }); // X icon button
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows both Quick and Detailed enrich buttons when enrichmentLevel is 0', () => {
    renderDetail(BASE_SESSION);
    expect(screen.getByText('Quick (L1)')).toBeInTheDocument();
    expect(screen.getByText('Detailed (L2)')).toBeInTheDocument();
  });

  it('hides Quick (L1) button when enrichmentLevel is 1', () => {
    renderDetail({ ...BASE_SESSION, enrichmentLevel: 1 as const });
    expect(screen.queryByText('Quick (L1)')).not.toBeInTheDocument();
    expect(screen.getByText('Detailed (L2)')).toBeInTheDocument();
  });

  it('hides enrichment controls entirely when enrichmentLevel is 2', () => {
    renderDetail({ ...BASE_SESSION, enrichmentLevel: 2 as const });
    expect(screen.queryByText('Quick (L1)')).not.toBeInTheDocument();
    expect(screen.queryByText('Detailed (L2)')).not.toBeInTheDocument();
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
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/enrich')) {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'fail' }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(BASE_SESSION) });
    });
    renderDetail(BASE_SESSION, vi.fn(), fetchMock);

    fireEvent.click(screen.getByText('Quick (L1)'));
    await waitFor(() => expect(screen.getByText('Enrichment failed')).toBeInTheDocument());
  });

  it('renders tags when present', () => {
    renderDetail(BASE_SESSION);
    expect(screen.getByText('auth')).toBeInTheDocument();
    expect(screen.getByText('bugfix')).toBeInTheDocument();
  });

  it('renders file path', () => {
    renderDetail(BASE_SESSION);
    expect(screen.getByText('/fake/42.jsonl')).toBeInTheDocument();
  });
});

/**
 * Smoke tests for FlywheelChangesTab component (PAN-709)
 */
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../lib/store', () => ({
  useDashboardStore: vi.fn(),
  selectAwaitingMerge: (s: unknown) => s,
  selectIssues: (s: unknown) => s,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { useDashboardStore } from '../../lib/store';
import { FlywheelChangesTab } from '../FlywheelChangesTab';

const mockUseDashboardStore = vi.mocked(useDashboardStore);

const mockFetch = vi.fn();
global.fetch = mockFetch;

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ retros: [], signalCount: 0, skillName: 'test' }),
  } as unknown as Response);
});

describe('FlywheelChangesTab', () => {
  it('shows empty state when there are no awaiting issues', () => {
    // Both calls to useDashboardStore return empty arrays
    mockUseDashboardStore.mockReturnValue([]);
    render(<FlywheelChangesTab />, { wrapper: makeWrapper() });
    expect(screen.getByText(/No flywheel changes awaiting merge/)).toBeInTheDocument();
  });

  it('shows empty state when awaiting issues exist but none have the flywheel-change label', () => {
    const awaitingItem = { issueId: 'PAN-001', mergeStatus: 'ready' };
    const issueWithoutLabel = { id: 'PAN-001', identifier: 'PAN-001', title: 'Some issue', labels: ['bug'] };

    mockUseDashboardStore
      .mockReturnValueOnce([awaitingItem]) // selectAwaitingMerge
      .mockReturnValueOnce([issueWithoutLabel]); // selectIssues

    render(<FlywheelChangesTab />, { wrapper: makeWrapper() });
    expect(screen.getByText(/No flywheel changes awaiting merge/)).toBeInTheDocument();
  });

  it('renders a change card when a flywheel-change issue is awaiting merge', () => {
    const awaitingItem = { issueId: 'PAN-001', mergeStatus: 'ready' };
    const flywheelIssue = {
      id: 'PAN-001',
      identifier: 'PAN-001',
      title: 'Improve pan-review skill',
      labels: ['flywheel-change'],
      url: 'https://github.com/example/issues/1',
    };

    mockUseDashboardStore
      .mockReturnValueOnce([awaitingItem])
      .mockReturnValueOnce([flywheelIssue]);

    render(<FlywheelChangesTab />, { wrapper: makeWrapper() });
    expect(screen.getByText('Improve pan-review skill')).toBeInTheDocument();
    // Merge button confirms the card rendered
    expect(screen.getByRole('button', { name: /Merge/i })).toBeInTheDocument();
  });
});

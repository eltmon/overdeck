/**
 * Smoke tests for FlywheelPage component (PAN-709)
 */
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FlywheelPage } from '../FlywheelPage';

// Stub out the child that has heavy store + query dependencies
vi.mock('../FlywheelChangesTab', () => ({
  FlywheelChangesTab: () => <div data-testid="flywheel-changes-stub" />,
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ retrosProcessed: 5, retrosNoOp: 3, topPatterns: [], isRunning: false, lastSynthesisAt: null }),
  } as unknown as Response);
});

describe('FlywheelPage', () => {
  it('renders the page heading', () => {
    render(<FlywheelPage />, { wrapper: makeWrapper() });
    expect(screen.getByText('Flywheel')).toBeInTheDocument();
  });

  it('renders the flywheel changes section heading', () => {
    render(<FlywheelPage />, { wrapper: makeWrapper() });
    expect(screen.getByText('Flywheel Changes Awaiting Merge')).toBeInTheDocument();
  });

  it('renders the FlywheelChangesTab stub', () => {
    render(<FlywheelPage />, { wrapper: makeWrapper() });
    expect(screen.getByTestId('flywheel-changes-stub')).toBeInTheDocument();
  });

  it('does not render Skills Added or Skills Refined tile labels', () => {
    render(<FlywheelPage />, { wrapper: makeWrapper() });
    // MetricTile labels appear as spans with exact text (CSS uppercase is visual-only)
    expect(screen.queryByText('Skills Added')).not.toBeInTheDocument();
    expect(screen.queryByText('Skills Refined')).not.toBeInTheDocument();
  });

  it('renders the Retros Processed tile label', () => {
    render(<FlywheelPage />, { wrapper: makeWrapper() });
    expect(screen.getByText('Retros Processed')).toBeInTheDocument();
  });
});

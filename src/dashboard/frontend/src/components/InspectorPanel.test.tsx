import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { InspectorPanel } from './InspectorPanel';
import { Agent, Issue } from '../types';

// Mock BeadsDialog to avoid its own fetch requirements
vi.mock('./BeadsDialog', () => ({
  BeadsDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="beads-dialog">
      <button onClick={onClose}>Close Beads</button>
    </div>
  ),
}));

// Mock react-markdown to avoid MDX/rehype dependencies in tests
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock('rehype-sanitize', () => ({ default: {} }));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const mockAgent: Agent = {
  id: 'agent-123',
  status: 'healthy',
  issueId: 'PAN-999',
  model: 'claude-sonnet-4-6',
  startedAt: new Date().toISOString(),
  consecutiveFailures: 0,
  killCount: 0,
  runtime: 'claude-code',
};

const mockIssue: Issue = {
  id: 'issue-1',
  identifier: 'PAN-999',
  title: 'Add dark mode support',
  status: 'In Progress',
  priority: 1,
  labels: ['frontend', 'ui'],
  url: 'https://github.com/test/repo/issues/1',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockWorkspace = {
  exists: true,
  issueId: 'PAN-999',
  path: '/workspaces/pan-999',
  containers: null,
  hasDocker: false,
  canContainerize: false,
  pendingOperation: null,
};

const mockReviewStatus = {
  issueId: 'PAN-999',
  reviewStatus: 'pending',
  testStatus: 'pending',
  readyForMerge: false,
  updatedAt: new Date().toISOString(),
};

function setupFetchMock() {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    if (url.includes('/workspaces/PAN-999/review-status')) {
      return Promise.resolve({ ok: true, json: async () => mockReviewStatus });
    }
    if (url.includes('/workspaces/PAN-999') && !url.includes('review-status') && !url.includes('planning')) {
      return Promise.resolve({ ok: true, json: async () => mockWorkspace });
    }
    if (url.includes('/api/costs/issue/PAN-999')) {
      return Promise.resolve({ ok: true, json: async () => ({ issueId: 'PAN-999', totalCost: 0.5, sessions: [], byModel: {} }) });
    }
    if (url.includes('/planning/PAN-999')) {
      return Promise.resolve({ ok: false });
    }
    return Promise.resolve({ ok: false, json: async () => ({}) });
  }));
}

describe('InspectorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupFetchMock();
  });

  it('renders the issue ID in the header', async () => {
    render(
      <InspectorPanel issueId="PAN-999" onClose={vi.fn()} />,
      { wrapper: createWrapper() }
    );
    expect(screen.getByText('PAN-999')).toBeInTheDocument();
  });

  it('renders without an agent (no-agent state)', () => {
    render(
      <InspectorPanel issueId="PAN-999" issue={mockIssue} onClose={vi.fn()} />,
      { wrapper: createWrapper() }
    );
    expect(screen.getByTestId('workspace-sidebar')).toBeInTheDocument();
  });

  it('renders the issue title when provided', () => {
    render(
      <InspectorPanel issueId="PAN-999" issue={mockIssue} onClose={vi.fn()} />,
      { wrapper: createWrapper() }
    );
    expect(screen.getByText('Add dark mode support')).toBeInTheDocument();
  });

  it('shows friendly agent model name when agent is provided', () => {
    render(
      <InspectorPanel agent={mockAgent} issueId="PAN-999" issue={mockIssue} onClose={vi.fn()} />,
      { wrapper: createWrapper() }
    );
    // claude-sonnet-4-6 → getFriendlyModelName → 'Sonnet 4.6'
    expect(screen.getAllByText('Sonnet 4.6').length).toBeGreaterThan(0);
  });

  it('shows workspace path from API', async () => {
    render(
      <InspectorPanel issueId="PAN-999" issue={mockIssue} onClose={vi.fn()} />,
      { wrapper: createWrapper() }
    );
    await waitFor(() => {
      expect(screen.getByText('/workspaces/pan-999')).toBeInTheDocument();
    });
  });

  it('calls onClose when X button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <InspectorPanel issueId="PAN-999" issue={mockIssue} onClose={onClose} />,
      { wrapper: createWrapper() }
    );
    const closeButton = screen.getByTitle('Close inspector');
    await user.click(closeButton);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows open terminal button when onOpenTerminal is provided', () => {
    render(
      <InspectorPanel
        agent={mockAgent}
        issueId="PAN-999"
        issue={mockIssue}
        onClose={vi.fn()}
        onOpenTerminal={vi.fn()}
      />,
      { wrapper: createWrapper() }
    );
    expect(screen.getByTitle('Open terminal')).toBeInTheDocument();
  });

  it('calls onOpenTerminal when terminal button is clicked', async () => {
    const user = userEvent.setup();
    const onOpenTerminal = vi.fn();
    render(
      <InspectorPanel
        agent={mockAgent}
        issueId="PAN-999"
        issue={mockIssue}
        onClose={vi.fn()}
        onOpenTerminal={onOpenTerminal}
      />,
      { wrapper: createWrapper() }
    );
    await user.click(screen.getByTitle('Open terminal'));
    expect(onOpenTerminal).toHaveBeenCalled();
  });

  it('renders issue labels', () => {
    render(
      <InspectorPanel issueId="PAN-999" issue={mockIssue} onClose={vi.fn()} />,
      { wrapper: createWrapper() }
    );
    expect(screen.getByText('frontend')).toBeInTheDocument();
    expect(screen.getByText('ui')).toBeInTheDocument();
  });
});

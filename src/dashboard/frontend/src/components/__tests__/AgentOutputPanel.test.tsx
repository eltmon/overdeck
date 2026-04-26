/**
 * Tests for PAN-503: deriveAgentIssueId covers both work agents and planning agents,
 * and AgentOutputPanel renders XTerminal fallback for planning agents with non-derivable issueId.
 *
 * deriveAgentIssueId was renamed from deriveWorkAgentIssueId and its regex extended
 * to match the planning- prefix in addition to agent-.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { deriveAgentIssueId } from '../AgentOutputPanel';

// Lightweight stubs with data-testids
vi.mock('../XTerminal', () => ({
  XTerminal: ({ sessionName }: { sessionName: string }) => (
    <div data-testid="xterm" data-session={sessionName} />
  ),
}));

vi.mock('../CommandDeck/ActivityView', () => ({
  ActivityView: ({ issueId }: { issueId: string }) => (
    <div data-testid="activity-view" data-issue={issueId} />
  ),
}));

vi.mock('../chat/ConversationPanel', () => ({
  ConversationPanel: () => <div data-testid="conversation-panel" />,
}));

// Mock the store — tests override the return value per-test via mockReturnValue
vi.mock('../../lib/store', () => ({
  useDashboardStore: vi.fn(),
  selectAgentById: vi.fn(() => vi.fn()),
}));

import { useDashboardStore } from '../../lib/store';

function renderPanel(agentId: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {/* AgentOutputPanel is imported below to pick up the mocks */}
      <AgentOutputPanelUnderTest agentId={agentId} />
    </QueryClientProvider>
  );
}

// Deferred import so mocks are set up first
import { AgentOutputPanel as AgentOutputPanelUnderTest } from '../AgentOutputPanel';

describe('deriveAgentIssueId', () => {
  // Work agents (existing behavior must be preserved)
  it('derives issueId from work agent id: agent-pan-505 → PAN-505', () => {
    expect(deriveAgentIssueId('agent-pan-505')).toBe('PAN-505');
  });

  it('derives issueId from work agent id with uppercase prefix', () => {
    expect(deriveAgentIssueId('agent-PAN-123')).toBe('PAN-123');
  });

  it('returns agentIssueId directly when provided (work agent)', () => {
    expect(deriveAgentIssueId('agent-pan-505', 'PAN-505')).toBe('PAN-505');
  });

  // Planning agents (new behavior)
  it('derives issueId from planning agent id: planning-pan-503 → PAN-503', () => {
    expect(deriveAgentIssueId('planning-pan-503')).toBe('PAN-503');
  });

  it('derives issueId from planning agent id with multi-letter prefix', () => {
    expect(deriveAgentIssueId('planning-min-42')).toBe('MIN-42');
  });

  it('returns agentIssueId directly when provided (planning agent)', () => {
    expect(deriveAgentIssueId('planning-pan-503', 'PAN-503')).toBe('PAN-503');
  });

  // Non-matching ids
  it('returns null for specialist session names', () => {
    expect(deriveAgentIssueId('specialist-pan-review-agent')).toBeNull();
    expect(deriveAgentIssueId('specialist-panopticon-PAN-509-review-agent')).toBeNull();
  });

  it('returns null for unrecognized id formats', () => {
    expect(deriveAgentIssueId('unknown-session')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(deriveAgentIssueId('')).toBeNull();
  });
});

describe('AgentOutputPanel — planning agent rendering (AC4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ isRunning: true }) })));
    // Default: store returns null (no agent in store, fall back to id-based derivation)
    (useDashboardStore as ReturnType<typeof vi.fn>).mockReturnValue(null);
  });

  it('renders ActivityView for planning agent with derivable issueId', () => {
    renderPanel('planning-pan-503');

    expect(screen.getByTestId('activity-view')).toBeInTheDocument();
    expect(screen.getByTestId('activity-view')).toHaveAttribute('data-issue', 'PAN-503');
    expect(screen.queryByTestId('xterm')).not.toBeInTheDocument();
  });

  it('falls back to XTerminal (not placeholder) for planning agent with non-derivable issueId', () => {
    // 'planning-orphan' does not match /^(?:agent|planning)-([a-z]+)-(\d+)$/i
    renderPanel('planning-orphan');

    expect(screen.queryByTestId('activity-view')).not.toBeInTheDocument();
    expect(screen.queryByText(/No issue associated/)).not.toBeInTheDocument();
    expect(screen.getByTestId('xterm')).toBeInTheDocument();
    expect(screen.getByTestId('xterm')).toHaveAttribute('data-session', 'planning-orphan');
  });

  it('shows No issue associated placeholder for non-planning agent with non-derivable id', () => {
    renderPanel('unknown-session');

    expect(screen.queryByTestId('activity-view')).not.toBeInTheDocument();
    expect(screen.queryByTestId('xterm')).not.toBeInTheDocument();
    expect(screen.getByText(/No issue associated/)).toBeInTheDocument();
  });

  it('fetches specialist status with project and issue scoped route', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ isRunning: true }) }));
    vi.stubGlobal('fetch', fetchMock);

    renderPanel('specialist-panopticon-PAN-509-review-agent');

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/specialists/panopticon/PAN-509/review-agent/status');
    });
  });
});

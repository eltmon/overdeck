import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Agent } from '../../types';
import type { PipelinePhase, TerminalTab } from '../inspector/TerminalTabs';
import type { PipelinePhaseResult } from '../inspector/usePipelinePhase';

// ─── Module mocks ─────────────────────────────────────────────────────────────

// Hoist savePinState mock so the vi.mock factory below can reference it
const mockSavePinState = vi.hoisted(() => vi.fn());

vi.mock('react-resizable-panels', () => ({
  Group: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="panel-group">{children}</div>
  ),
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Separator: () => <div />,
}));

vi.mock('../InspectorPanel', () => ({
  InspectorPanel: () => <div data-testid="inspector-panel" />,
}));

vi.mock('../TerminalPanel', () => ({
  TerminalPanel: ({ sessionName }: { sessionName?: string; agent?: unknown }) => (
    <div data-testid="terminal-panel" data-session={sessionName ?? '__default__'} />
  ),
}));

vi.mock('../inspector/TerminalTabs', () => ({
  // Expose onTogglePin as a button so integration tests can fire the real handler
  TerminalTabs: ({ onTogglePin }: { onTogglePin?: () => void; [k: string]: unknown }) => (
    <div data-testid="terminal-tabs">
      <button data-testid="pin-button" onClick={onTogglePin}>Pin</button>
    </div>
  ),
  // Use the real localStorage key so tests can pre-populate state
  loadPinState: (issueId: string) => localStorage.getItem(`pan-terminal-pin-${issueId}`),
  savePinState: mockSavePinState,
}));

vi.mock('../inspector/MergedSummaryCard', () => ({
  MergedSummaryCard: ({
    onViewLastLog,
  }: {
    mergedAt: string;
    onViewLastLog?: (() => void) | null;
  }) => (
    <div data-testid="merged-summary-card">
      {onViewLastLog != null && (
        <button onClick={onViewLastLog}>View last specialist log</button>
      )}
    </div>
  ),
}));

// Mutable pipeline result — each test sets it before rendering.
let mockPipelineResult: PipelinePhaseResult & { markSessionDead: ReturnType<typeof vi.fn> } = {
  phase: 'working' as PipelinePhase,
  activeSession: 'agent-123',
  availableTerminals: [],
  markSessionDead: vi.fn(),
};

vi.mock('../inspector/usePipelinePhase', () => ({
  usePipelinePhase: () => mockPipelineResult,
}));

// ─── Import under test ────────────────────────────────────────────────────────

import { DetailPanelLayout } from '../DetailPanelLayout';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return { id: 'agent-123', issueId: 'PAN-509', status: 'stopped', ...overrides } as Agent;
}

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

type ReviewStatusOverrides = {
  reviewStatus?: string;
  mergeStatus?: string;
  testStatus?: string;
  updatedAt?: string;
};

function makeFetch(reviewStatusOverrides: ReviewStatusOverrides = {}): typeof global.fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/review-status')) {
      return new Response(
        JSON.stringify({
          reviewStatus: 'pending',
          mergeStatus: 'pending',
          testStatus: 'pending',
          updatedAt: '2026-04-13T00:00:00Z',
          ...reviewStatusOverrides,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof global.fetch;
}

function renderLayout(
  agent: Agent,
  fetchImpl: typeof global.fetch = makeFetch(),
  issueId = 'PAN-509',
) {
  global.fetch = fetchImpl;
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <DetailPanelLayout agent={agent} issueId={issueId} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DetailPanelLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Default panel state so the terminal section is shown
    localStorage.setItem(
      'pan-panel-state-PAN-509',
      JSON.stringify({ panelMode: 'inspector+terminal', inspectorDefaultSize: '35%' }),
    );
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('Issue 1 — specialist tab streaming with dead work agent', () => {
    it('renders TerminalPanel keyed to the review specialist session when the review phase is active, even when the work agent is stopped', async () => {
      const reviewSession = 'specialist-panopticon-PAN-509-review-agent';
      mockPipelineResult = {
        phase: 'reviewing',
        activeSession: reviewSession,
        availableTerminals: [
          {
            id: 'working',
            label: 'Work',
            sessionName: 'agent-123',
            isActive: false,
            disabled: true, // work agent is dead
          } satisfies TerminalTab,
          {
            id: 'reviewing',
            label: 'Review',
            sessionName: reviewSession,
            isActive: true,
            disabled: false,
          } satisfies TerminalTab,
        ],
        markSessionDead: vi.fn(),
      };

      renderLayout(
        makeAgent({ status: 'stopped' }),
        makeFetch({ reviewStatus: 'reviewing' }),
      );

      // TerminalPanel must render with the review specialist session, not the work agent session
      await waitFor(() => {
        const panel = screen.getByTestId('terminal-panel');
        expect(panel).toHaveAttribute('data-session', reviewSession);
      });

      // Not the work agent session
      expect(screen.getByTestId('terminal-panel')).not.toHaveAttribute('data-session', 'agent-123');
    });
  });

  describe('Issue 3 — pin state resets when issueId changes', () => {
    it('re-reads pin state from localStorage when issueId prop changes', async () => {
      const sessionA = 'specialist-session-for-issue-a';
      const sessionB = 'specialist-session-for-issue-b';

      // Pre-populate pin state for both issues
      localStorage.setItem('pan-terminal-pin-PAN-509', sessionA);
      localStorage.setItem('pan-terminal-pin-PAN-510', sessionB);
      // Panel state so the terminal section renders
      localStorage.setItem(
        'pan-panel-state-PAN-510',
        JSON.stringify({ panelMode: 'inspector+terminal', inspectorDefaultSize: '35%' }),
      );

      mockPipelineResult = {
        phase: 'working' as PipelinePhase,
        activeSession: 'fallback-active-session',
        availableTerminals: [],
        markSessionDead: vi.fn(),
      };

      const { rerender } = renderLayout(makeAgent({ issueId: 'PAN-509' }));

      // Issue A: TerminalPanel shows the pinned session for PAN-509
      await waitFor(() => {
        expect(screen.getByTestId('terminal-panel')).toHaveAttribute('data-session', sessionA);
      });

      // Switch to issue B by updating the issueId prop
      const client = makeQueryClient();
      rerender(
        <QueryClientProvider client={client}>
          <DetailPanelLayout agent={makeAgent({ issueId: 'PAN-510' })} issueId="PAN-510" onClose={vi.fn()} />
        </QueryClientProvider>,
      );

      // Issue B: TerminalPanel must show the pinned session for PAN-510, not the stale PAN-509 session
      await waitFor(() => {
        expect(screen.getByTestId('terminal-panel')).toHaveAttribute('data-session', sessionB);
      });
      expect(screen.getByTestId('terminal-panel')).not.toHaveAttribute('data-session', sessionA);
    });

    it('clears pin state when switching to an issue with no saved pin', async () => {
      const sessionA = 'specialist-session-for-issue-a';

      localStorage.setItem('pan-terminal-pin-PAN-509', sessionA);
      localStorage.setItem(
        'pan-panel-state-PAN-510',
        JSON.stringify({ panelMode: 'inspector+terminal', inspectorDefaultSize: '35%' }),
      );
      // PAN-510 has no saved pin

      const activeSessionB = 'active-work-session-b';
      mockPipelineResult = {
        phase: 'working' as PipelinePhase,
        activeSession: activeSessionB,
        availableTerminals: [],
        markSessionDead: vi.fn(),
      };

      const { rerender } = renderLayout(makeAgent({ issueId: 'PAN-509' }));

      // Issue A: shows pinned session
      await waitFor(() => {
        expect(screen.getByTestId('terminal-panel')).toHaveAttribute('data-session', sessionA);
      });

      // Switch to issue B (no saved pin)
      const client = makeQueryClient();
      rerender(
        <QueryClientProvider client={client}>
          <DetailPanelLayout agent={makeAgent({ issueId: 'PAN-510' })} issueId="PAN-510" onClose={vi.fn()} />
        </QueryClientProvider>,
      );

      // Must fall back to activeSession (not pinned), not the stale PAN-509 session
      await waitFor(() => {
        expect(screen.getByTestId('terminal-panel')).toHaveAttribute('data-session', activeSessionB);
      });
      expect(screen.getByTestId('terminal-panel')).not.toHaveAttribute('data-session', sessionA);
    });
  });

  describe('Issue 4 — Pin button in auto-mode captures active session', () => {
    it('retains the displayed session and persists pin when clicking Pin in auto-mode', async () => {
      const activeSession = 'work-agent-session-123';

      mockPipelineResult = {
        phase: 'working' as PipelinePhase,
        activeSession,
        availableTerminals: [
          {
            id: 'working',
            label: 'Work',
            sessionName: activeSession,
            isActive: true,
            disabled: false,
          } satisfies TerminalTab,
        ],
        markSessionDead: vi.fn(),
      };

      renderLayout(makeAgent({ status: 'running' }));

      // Initially in auto-follow mode: terminal shows the activeSession
      await waitFor(() => {
        expect(screen.getByTestId('terminal-panel')).toHaveAttribute('data-session', activeSession);
      });

      // Click the Pin button — fires handleTogglePin in DetailPanelLayout
      fireEvent.click(screen.getByTestId('pin-button'));

      // (a) The displayed session must survive the pin toggle
      await waitFor(() => {
        expect(screen.getByTestId('terminal-panel')).toHaveAttribute('data-session', activeSession);
      });

      // (b) savePinState must have been called with the active session
      expect(mockSavePinState).toHaveBeenCalledWith('PAN-509', activeSession);
    });

    it('is a no-op when there is no active session to pin', async () => {
      mockPipelineResult = {
        phase: 'working' as PipelinePhase,
        activeSession: null,
        availableTerminals: [
          {
            id: 'working',
            label: 'Work',
            sessionName: 'some-dead-session',
            isActive: false,
            disabled: true,
          } satisfies TerminalTab,
        ],
        markSessionDead: vi.fn(),
      };

      renderLayout(makeAgent({ status: 'stopped' }));

      await waitFor(() => {
        expect(screen.getByTestId('terminal-tabs')).toBeInTheDocument();
      });

      mockSavePinState.mockClear();

      // Click Pin button when there is no active session — must be a no-op
      fireEvent.click(screen.getByTestId('pin-button'));

      // savePinState must NOT have been called
      expect(mockSavePinState).not.toHaveBeenCalled();
    });
  });

  describe('Issue 2 — "View last specialist log" button in merged phase', () => {
    it('shows MergedSummaryCard initially in merged phase', async () => {
      mockPipelineResult = {
        phase: 'merged',
        activeSession: null,
        availableTerminals: [
          {
            id: 'merging',
            label: 'Merge',
            sessionName: 'specialist-panopticon-PAN-509-merge-agent',
            isActive: false,
            disabled: false,
          } satisfies TerminalTab,
        ],
        markSessionDead: vi.fn(),
      };

      renderLayout(makeAgent({ status: 'stopped' }), makeFetch({ mergeStatus: 'merged' }));

      await waitFor(() => {
        expect(screen.getByTestId('merged-summary-card')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('terminal-panel')).not.toBeInTheDocument();
    });

    it('clicking "View last specialist log" replaces MergedSummaryCard with TerminalPanel for the merge session', async () => {
      const mergeSession = 'specialist-panopticon-PAN-509-merge-agent';
      mockPipelineResult = {
        phase: 'merged',
        activeSession: null,
        availableTerminals: [
          {
            id: 'merging',
            label: 'Merge',
            sessionName: mergeSession,
            isActive: false,
            disabled: false,
          } satisfies TerminalTab,
        ],
        markSessionDead: vi.fn(),
      };

      renderLayout(makeAgent({ status: 'stopped' }), makeFetch({ mergeStatus: 'merged' }));

      // Wait for initial render with MergedSummaryCard
      await waitFor(() => {
        expect(screen.getByTestId('merged-summary-card')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('terminal-panel')).not.toBeInTheDocument();

      // Click the "View last specialist log" button
      fireEvent.click(screen.getByText('View last specialist log'));

      // MergedSummaryCard must be replaced by TerminalPanel showing the merge session
      await waitFor(() => {
        expect(screen.getByTestId('terminal-panel')).toBeInTheDocument();
      });
      expect(screen.getByTestId('terminal-panel')).toHaveAttribute('data-session', mergeSession);
      expect(screen.queryByTestId('merged-summary-card')).not.toBeInTheDocument();
    });
  });
});

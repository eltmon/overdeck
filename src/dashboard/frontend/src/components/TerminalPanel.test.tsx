/**
 * Tests for PAN-503: TerminalPanel planning-agent ActivityView routing.
 *
 * - Planning agents (id starts with 'planning-' or agentPhase === 'planning')
 *   must render ActivityView, not XTerminal, when an issueId is derivable.
 * - Non-planning agents must continue to render XTerminal.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Agent } from '../types';
import { TerminalPanel } from './TerminalPanel';

// XTerminal and ActivityView as lightweight stubs with data-testids
vi.mock('./XTerminal', () => ({
  XTerminal: ({ sessionName }: { sessionName: string }) => (
    <div data-testid="xterm" data-session={sessionName} />
  ),
}));

vi.mock('./MissionControl/ActivityView', () => ({
  ActivityView: ({ issueId }: { issueId: string }) => (
    <div data-testid="activity-view" data-issue={issueId} />
  ),
}));

// Mock fetch for tmux-alive probe (TerminalPanel calls /api/agents/:id/tmux-alive)
vi.stubGlobal('fetch', vi.fn((_url: string) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({ alive: true }) } as Response)
));

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-pan-503',
    runtime: 'claude-code',
    model: 'claude-sonnet-4-6',
    status: 'healthy',
    labels: [],
    ...overrides,
  } as Agent;
}

function renderTerminalPanel(agent: Agent) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TerminalPanel agent={agent} onClose={vi.fn()} />
    </QueryClientProvider>
  );
}

describe('TerminalPanel — planning agent routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders ActivityView (not XTerminal) for a planning agent matched by id prefix', () => {
    const agent = makeAgent({ id: 'planning-pan-503', issueId: 'PAN-503' });
    renderTerminalPanel(agent);

    expect(screen.getByTestId('activity-view')).toBeInTheDocument();
    expect(screen.getByTestId('activity-view')).toHaveAttribute('data-issue', 'PAN-503');
    expect(screen.queryByTestId('xterm')).not.toBeInTheDocument();
  });

  it('renders ActivityView (not XTerminal) when agentPhase is "planning"', () => {
    const agent = makeAgent({ id: 'agent-pan-503', agentPhase: 'planning', issueId: 'PAN-503' });
    renderTerminalPanel(agent);

    expect(screen.getByTestId('activity-view')).toBeInTheDocument();
    expect(screen.queryByTestId('xterm')).not.toBeInTheDocument();
  });

  it('derives issueId from id pattern when agent.issueId is absent', () => {
    // planning-pan-503 → PAN-503
    const agent = makeAgent({ id: 'planning-pan-503' });
    renderTerminalPanel(agent);

    expect(screen.getByTestId('activity-view')).toHaveAttribute('data-issue', 'PAN-503');
  });

  it('hides the popout button for planning agents showing ActivityView', () => {
    const agent = makeAgent({ id: 'planning-pan-503', issueId: 'PAN-503' });
    renderTerminalPanel(agent);

    expect(screen.queryByTitle('Pop out terminal')).not.toBeInTheDocument();
  });

  it('falls back to XTerminal for a planning agent with no derivable issueId', () => {
    // Session name that doesn't match the pattern
    const agent = makeAgent({ id: 'planning-orphan', issueId: undefined });
    renderTerminalPanel(agent);

    expect(screen.queryByTestId('activity-view')).not.toBeInTheDocument();
    // XTerminal is rendered (tmux probe returns alive:true so we show the live terminal)
    expect(screen.getByTestId('xterm')).toBeInTheDocument();
  });
});

describe('TerminalPanel — non-planning agent (unchanged behavior)', () => {
  it('renders XTerminal (not ActivityView) for a regular work agent', () => {
    const agent = makeAgent({ id: 'agent-pan-504', issueId: 'PAN-504' });
    renderTerminalPanel(agent);

    expect(screen.queryByTestId('activity-view')).not.toBeInTheDocument();
    expect(screen.getByTestId('xterm')).toBeInTheDocument();
  });

  it('renders XTerminal for a specialist agent', () => {
    const agent = makeAgent({ id: 'specialist-pan-review-agent' });
    renderTerminalPanel(agent);

    expect(screen.queryByTestId('activity-view')).not.toBeInTheDocument();
    expect(screen.getByTestId('xterm')).toBeInTheDocument();
  });
});

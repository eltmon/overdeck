import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Agent } from '../types';
import { TerminalPanel } from './TerminalPanel';

vi.mock('./XTerminal', () => ({
  XTerminal: ({ sessionName }: { sessionName: string }) => (
    <div data-testid="xterm" data-session={sessionName} />
  ),
}));

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

describe('TerminalPanel — renders XTerminal for all agent types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders XTerminal for a regular work agent', () => {
    const agent = makeAgent({ id: 'agent-pan-504', issueId: 'PAN-504' });
    renderTerminalPanel(agent);

    expect(screen.getByTestId('xterm')).toBeInTheDocument();
  });

  it('renders XTerminal for a specialist agent', () => {
    const agent = makeAgent({ id: 'specialist-pan-review-agent' });
    renderTerminalPanel(agent);

    expect(screen.getByTestId('xterm')).toBeInTheDocument();
  });

  it('renders XTerminal for a planning agent matched by id prefix', () => {
    const agent = makeAgent({ id: 'planning-pan-503', issueId: 'PAN-503' });
    renderTerminalPanel(agent);

    expect(screen.getByTestId('xterm')).toBeInTheDocument();
    expect(screen.getByTestId('xterm')).toHaveAttribute('data-session', 'planning-pan-503');
  });

  it('renders XTerminal when agentPhase is "planning"', () => {
    const agent = makeAgent({ id: 'agent-pan-503', agentPhase: 'planning', issueId: 'PAN-503' });
    renderTerminalPanel(agent);

    expect(screen.getByTestId('xterm')).toBeInTheDocument();
  });

  it('shows the popout button for live agents', () => {
    const agent = makeAgent({ id: 'planning-pan-503', issueId: 'PAN-503' });
    renderTerminalPanel(agent);

    expect(screen.getByTitle('Pop out terminal')).toBeInTheDocument();
  });
});

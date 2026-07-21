import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDashboardStore } from '../../lib/store';
import type { Agent } from '../../types';
import { StoppedAgentsBanner } from '../StoppedAgentsBanner';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

const NOW = new Date('2026-05-23T12:00:00.000Z');
const NOW_MS = NOW.getTime();
const RECENT_AT = new Date(NOW_MS - 60 * 60 * 1000).toISOString();
const OLD_AT = new Date(NOW_MS - 8 * 24 * 60 * 60 * 1000).toISOString();

function agent(overrides: Partial<Agent> & Pick<Agent, 'id' | 'issueId' | 'status'>): Agent {
  return {
    id: overrides.id,
    issueId: overrides.issueId,
    runtime: 'claude-code',
    model: 'claude-opus-4-7',
    status: overrides.status,
    role: 'work',
    startedAt: RECENT_AT,
    lastActivity: RECENT_AT,
    consecutiveFailures: 0,
    killCount: 0,
    ...overrides,
  };
}

function seedStore(agents: Agent[], issues: Array<Record<string, unknown>> = []): void {
  useDashboardStore.setState({
    agentsById: Object.fromEntries(agents.map((item) => [item.id, item])),
    issuesRaw: issues,
  } as Parameters<typeof useDashboardStore.setState>[0]);
}

function stoppedAgents(): Agent[] {
  return [
    agent({
      id: 'agent-pan-1420-stopped',
      issueId: 'PAN-1420',
      status: 'stopped',
      hasLiveTmuxSession: false,
      pausedReason: 'waiting for deploy',
    }),
    agent({
      id: 'agent-pan-1422-stopped',
      issueId: 'PAN-1422',
      status: 'stopped',
      hasLiveTmuxSession: false,
      troubled: true,
      consecutiveFailures: 2,
      role: 'review',
    }),
  ];
}

describe('StoppedAgentsBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    window.history.replaceState(null, '', '/');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'agent-pan-1420' }), { status: 200 })));
    seedStore([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    seedStore([]);
  });

  it('renders and restarts only agents classified as stopped', async () => {
    const fetchMock = vi.mocked(fetch);
    seedStore([
      agent({
        id: 'agent-pan-1419-running',
        issueId: 'PAN-1419',
        status: 'running',
        hasLiveTmuxSession: true,
      }),
      agent({
        id: 'agent-pan-1421-standby',
        issueId: 'PAN-1421',
        status: 'stopped',
        hasLiveTmuxSession: true,
      }),
      agent({
        id: 'agent-pan-1420-stopped',
        issueId: 'PAN-1420',
        status: 'stopped',
        hasLiveTmuxSession: false,
      }),
      agent({
        id: 'agent-pan-ac-1-old',
        issueId: 'PAN-AC-1',
        status: 'stopped',
        hasLiveTmuxSession: false,
        startedAt: OLD_AT,
        lastActivity: OLD_AT,
      }),
    ]);

    render(<StoppedAgentsBanner />);

    const banner = screen.getByTestId('stopped-agents-banner');
    expect(screen.getByText('1 stopped')).toBeInTheDocument();
    expect(banner).toHaveTextContent('PAN-1420');
    expect(banner).not.toHaveTextContent('PAN-1419');
    expect(banner).not.toHaveTextContent('PAN-1421');
    expect(banner).not.toHaveTextContent('PAN-AC-1');

    await act(async () => {
      fireEvent.click(screen.getByTestId('banner-restart-all'));
      await vi.runAllTimersAsync();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/agents', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ issueId: 'PAN-1420' }),
    }));
  });

  it('renders titled stop context, bare-ID fallback, scope, and issue navigation', () => {
    seedStore(stoppedAgents(), [
      { identifier: 'PAN-1420', title: 'Known stopped issue', canonicalStatus: 'in_progress' },
    ]);

    render(<StoppedAgentsBanner variant="pill" />);
    fireEvent.click(screen.getByTestId('stopped-agents-pill'));

    const popover = screen.getByTestId('stopped-agents-popover');
    expect(within(popover).getByText('2 stopped · pipeline agents, last 7 days')).toBeInTheDocument();
    expect(within(popover).getByText('Known stopped issue')).toBeInTheDocument();
    expect(within(popover).getByText('paused: waiting for deploy · 1h ago')).toBeInTheDocument();
    expect(within(popover).getByText('PAN-1422')).toBeInTheDocument();
    expect(within(popover).getByText('troubled (2 failures) · 1h ago')).toBeInTheDocument();

    fireEvent.click(within(popover).getByText('Known stopped issue'));

    expect(window.location.pathname).toBe('/issues/PAN-1420');
    expect(screen.queryByTestId('stopped-agents-popover')).not.toBeInTheDocument();
  });

  it('preserves the pill trigger, list, results summary, and one restart per agent', async () => {
    const fetchMock = vi.mocked(fetch);
    seedStore(stoppedAgents(), [
      { identifier: 'PAN-1420', title: 'Known stopped issue', canonicalStatus: 'in_progress' },
    ]);

    render(<StoppedAgentsBanner variant="pill" />);
    const trigger = screen.getByTestId('stopped-agents-pill');
    expect(trigger).toHaveTextContent('2 stopped');
    fireEvent.click(trigger);

    const popover = screen.getByTestId('stopped-agents-popover');
    expect(within(popover).getAllByRole('button')).toHaveLength(3);
    expect(within(popover).getByTestId('pill-restart-all')).toHaveTextContent('Restart all');

    await act(async () => {
      fireEvent.click(within(popover).getByTestId('pill-restart-all'));
      await vi.runAllTimersAsync();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/agents', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ issueId: 'PAN-1420' }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/agents', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ issueId: 'PAN-1422' }),
    }));
    expect(within(popover).getByText('✓ 2 restarted')).toBeInTheDocument();
    expect(within(popover).getByTestId('pill-restart-all')).toHaveTextContent('Restart all');
  });
});

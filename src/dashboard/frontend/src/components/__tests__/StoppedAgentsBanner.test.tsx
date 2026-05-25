import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const NOW_MS = Date.parse('2026-05-23T12:00:00.000Z');
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

function seedAgents(agents: Agent[]): void {
  useDashboardStore.setState({
    agentsById: Object.fromEntries(agents.map((item) => [item.id, item])),
  } as Parameters<typeof useDashboardStore.setState>[0]);
}

describe('StoppedAgentsBanner', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'agent-pan-1420' }), { status: 200 })));
    seedAgents([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    seedAgents([]);
  });

  it('renders and restarts only agents classified as stopped', async () => {
    const fetchMock = vi.mocked(fetch);
    seedAgents([
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

    fireEvent.click(screen.getByTestId('banner-restart-all'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/agents', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ issueId: 'PAN-1420' }),
    }));
  });
});

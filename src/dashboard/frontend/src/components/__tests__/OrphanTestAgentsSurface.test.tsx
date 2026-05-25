import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDashboardStore } from '../../lib/store';
import type { Agent } from '../../types';
import { OrphanTestAgentsSurface } from '../OrphanTestAgentsSurface';

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

describe('OrphanTestAgentsSurface', () => {
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
    vi.stubGlobal('fetch', vi.fn());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    seedAgents([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
    seedAgents([]);
  });

  it('lists orphan_test agents and only copies pan wipe commands', () => {
    seedAgents([
      agent({
        id: 'agent-pan-ac22-old',
        issueId: 'PAN-AC22',
        status: 'stopped',
        hasLiveTmuxSession: false,
        startedAt: OLD_AT,
        lastActivity: OLD_AT,
      }),
      agent({
        id: 'agent-pan-test-1-old',
        issueId: 'PAN-TEST-1',
        status: 'stopped',
        hasLiveTmuxSession: false,
        startedAt: OLD_AT,
        lastActivity: OLD_AT,
      }),
      agent({
        id: 'agent-pan-1420-stopped',
        issueId: 'PAN-1420',
        status: 'stopped',
        hasLiveTmuxSession: false,
      }),
    ]);

    render(<OrphanTestAgentsSurface />);

    const surface = screen.getByTestId('orphan-test-agents-surface');
    expect(surface).toHaveTextContent('2 residual test agents');
    expect(screen.queryByTestId('orphan-test-agent-list')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('orphan-test-toggle'));

    expect(within(surface).getByText('PAN-AC22')).toBeInTheDocument();
    expect(within(surface).getByText('PAN-TEST-1')).toBeInTheDocument();
    expect(within(surface).queryByText('PAN-1420')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy `pan wipe PAN-AC22`' }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('pan wipe PAN-AC22');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stays hidden when only genuinely stopped pipeline agents exist', () => {
    seedAgents([
      agent({
        id: 'agent-pan-1420-stopped',
        issueId: 'PAN-1420',
        status: 'stopped',
        hasLiveTmuxSession: false,
      }),
    ]);

    render(<OrphanTestAgentsSurface />);

    expect(screen.queryByTestId('orphan-test-agents-surface')).not.toBeInTheDocument();
  });
});

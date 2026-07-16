import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SessionNode } from '@overdeck/contracts';
import type { ReactNode } from 'react';

import { MissionConversationTab } from './MissionConversationTab';

vi.mock('../../issue-view/ActiveAgentPanel', () => ({
  ActiveAgentPanel: ({ agentId }: { agentId: string }) => <div data-testid="active-agent-id">{agentId}</div>,
}));

vi.mock('./CockpitCard', () => ({
  CockpitCard: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));

function session(overrides: Partial<SessionNode> & { sessionId: string }): SessionNode {
  return {
    type: 'work',
    sessionId: overrides.sessionId,
    model: 'claude-sonnet-5',
    status: 'stopped',
    presence: 'ended',
    startedAt: '2026-07-15T20:00:00.000Z',
    duration: 1,
    ...overrides,
  } as SessionNode;
}

describe('MissionConversationTab', () => {
  const shell = { launcher: null, agentDock: null, actionDock: null, timeline: null };

  it('prefers the active work session over historical entries', () => {
    render(<MissionConversationTab {...shell} sessions={[
      session({ sessionId: 'historical' }),
      session({ sessionId: 'active', status: 'running', presence: 'active' }),
    ]} />);
    expect(screen.getByTestId('active-agent-id')).toHaveTextContent('active');
  });

  it('falls back to the most recently started work session', () => {
    render(<MissionConversationTab {...shell} sessions={[
      session({ sessionId: 'older', startedAt: '2026-07-15T19:00:00.000Z' }),
      session({ sessionId: 'newer', startedAt: '2026-07-15T21:00:00.000Z' }),
    ]} />);
    expect(screen.getByTestId('active-agent-id')).toHaveTextContent('newer');
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../types';
import { DrawerAgentSession, pickDefaultDrawerAgent } from './DrawerAgentSession';

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: null }),
}));

vi.mock('../chat/ConversationPanel', () => ({
  ConversationPanel: ({ agentId }: { agentId: string }) => (
    <div data-testid="conversation-panel">{agentId}</div>
  ),
}));

vi.mock('../XTerminal', () => ({
  XTerminal: ({ sessionName }: { sessionName: string }) => (
    <div data-testid="xterminal">{sessionName}</div>
  ),
}));

vi.mock('../issue-view/StartAgentCta', () => ({
  StartAgentCta: () => <button type="button">Start agent</button>,
}));

vi.mock('../../hooks/useConversationUiState', () => ({
  useConversationUiState: () => ({ hideToolCalls: false, toggleHideToolCalls: vi.fn() }),
}));

vi.mock('../CommandDeck/styles/command-deck.module.css', () => ({
  default: {
    conversationAboutToggle: 'conversationAboutToggle',
    conversationAboutToggleActive: 'conversationAboutToggleActive',
    terminalBranchBar: 'terminalBranchBar',
    terminalBranchBarMissing: 'terminalBranchBarMissing',
    terminalBranchBarDrift: 'terminalBranchBarDrift',
    terminalBranchBarMode: 'terminalBranchBarMode',
    terminalBranchBarText: 'terminalBranchBarText',
    viewToggle: 'viewToggle',
    viewToggleBtn: 'viewToggleBtn',
    viewToggleBtnActive: 'viewToggleBtnActive',
  },
}));

function agent(overrides: Partial<Agent> & { id: string }): Agent {
  return {
    runtime: 'claude-code',
    model: 'claude-sonnet-4-6',
    status: 'running',
    startedAt: '2026-05-22T00:00:00.000Z',
    consecutiveFailures: 0,
    killCount: 0,
    ...overrides,
  };
}

describe('pickDefaultDrawerAgent', () => {
  it('returns null when there are no agents', () => {
    expect(pickDefaultDrawerAgent([])).toBeNull();
  });

  it('prefers a live work agent over other live agents', () => {
    const agents = [
      agent({ id: 'agent-review', role: 'review', status: 'running' }),
      agent({ id: 'agent-work', role: 'work', status: 'running' }),
    ];
    expect(pickDefaultDrawerAgent(agents)?.id).toBe('agent-work');
  });

  it('falls back to an ended work agent when no work agent is live', () => {
    const agents = [
      agent({ id: 'agent-review', role: 'review', status: 'running' }),
      agent({ id: 'agent-work', role: 'work', status: 'stopped' }),
    ];
    expect(pickDefaultDrawerAgent(agents)?.id).toBe('agent-work');
  });

  it('falls back to any live agent when there is no work agent', () => {
    const agents = [
      agent({ id: 'agent-plan-dead', role: 'plan', status: 'dead' }),
      agent({ id: 'agent-review-live', role: 'review', status: 'running' }),
    ];
    expect(pickDefaultDrawerAgent(agents)?.id).toBe('agent-review-live');
  });

  it('falls back to the first agent when every agent has ended', () => {
    const agents = [
      agent({ id: 'agent-a', role: 'review', status: 'failed' }),
      agent({ id: 'agent-b', role: 'plan', status: 'stopped' }),
    ];
    expect(pickDefaultDrawerAgent(agents)?.id).toBe('agent-a');
  });
});

describe('DrawerAgentSession view selector', () => {
  it('renders the selector only when onChangeView is provided', () => {
    const liveAgent = agent({ id: 'agent-work', role: 'work' });
    const { rerender } = render(
      <DrawerAgentSession
        view="conversation"
        agents={[liveAgent]}
        agentId={liveAgent.id}
        onSelectAgent={vi.fn()}
      />,
    );

    expect(screen.queryByRole('tablist', { name: 'Agent session view' })).not.toBeInTheDocument();

    rerender(
      <DrawerAgentSession
        view="conversation"
        agents={[liveAgent]}
        agentId={liveAgent.id}
        onSelectAgent={vi.fn()}
        onChangeView={vi.fn()}
      />,
    );

    expect(screen.getByRole('tablist', { name: 'Agent session view' })).toBeInTheDocument();
  });

  it('disables Terminal with the ended-session reason for a stopped agent', () => {
    const endedAgent = agent({ id: 'agent-work', role: 'work', status: 'stopped' });
    render(
      <DrawerAgentSession
        view="conversation"
        agents={[endedAgent]}
        agentId={endedAgent.id}
        onSelectAgent={vi.fn()}
        onChangeView={vi.fn()}
      />,
    );

    const terminal = screen.getByRole('tab', {
      name: 'Terminal — Session ended — no live terminal to attach',
    });
    expect(terminal).toBeDisabled();
    expect(terminal).toHaveAttribute('title', 'Session ended — no live terminal to attach');
    expect(screen.getByRole('tab', { name: 'Conversation' })).toBeEnabled();
  });

  it('disables Terminal with the no-agent reason when no agent is selected', () => {
    render(
      <DrawerAgentSession
        view="conversation"
        agents={[]}
        agentId={null}
        onSelectAgent={vi.fn()}
        onChangeView={vi.fn()}
      />,
    );

    expect(screen.getByRole('tab', {
      name: 'Terminal — No agent selected — start work to attach a terminal',
    })).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Conversation' })).toBeEnabled();
  });

  it('emits view changes without changing the selected agent', () => {
    const agents = [
      agent({ id: 'agent-work', role: 'work' }),
      agent({ id: 'agent-specialist', role: 'review' }),
    ];
    const onChangeView = vi.fn();
    render(
      <DrawerAgentSession
        view="conversation"
        agents={agents}
        agentId="agent-specialist"
        onSelectAgent={vi.fn()}
        onChangeView={onChangeView}
      />,
    );

    const picker = screen.getByRole('combobox', { name: 'Select agent session' });
    expect(picker).toHaveValue('agent-specialist');

    fireEvent.click(screen.getByRole('tab', { name: 'Terminal' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Conversation' }));

    expect(onChangeView).toHaveBeenNthCalledWith(1, 'terminal');
    expect(onChangeView).toHaveBeenNthCalledWith(2, 'conversation');
    expect(picker).toHaveValue('agent-specialist');
  });
});

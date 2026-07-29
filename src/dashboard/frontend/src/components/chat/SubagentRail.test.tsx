import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Conversation } from '../CommandDeck/ConversationList';
import type { SubagentSummary } from './chat-types';

import { SubagentRail } from './SubagentRail';

const conversation: Conversation = {
  id: 42,
  name: 'conv-parent',
  tmuxSession: 'conv-parent',
  status: 'active',
  cwd: '/workspace',
  issueId: 'PAN-2876',
  createdAt: '2026-07-18T00:00:00Z',
  endedAt: null,
  lastAttachedAt: null,
  sessionAlive: true,
  harness: 'claude-code',
  title: 'xBrief context costs',
};

const subagents: SubagentSummary[] = [
  {
    agentId: 'alpha',
    agentType: 'Explore',
    description: 'Trace the conversation parser',
    toolUseId: 'toolu_alpha',
    spawnDepth: 1,
    status: 'running',
  },
  {
    agentId: 'deep',
    agentType: 'general-purpose',
    description: 'Inspect nested behavior',
    toolUseId: 'toolu_deep',
    spawnDepth: 2,
    status: 'done',
  },
];

describe('SubagentRail', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/conv/42');
  });

  it('renders nothing when no subagents exist', () => {
    const { container } = render(
      <SubagentRail conversation={conversation} subagents={[]} selectedAgentId={null} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('lists the main agent above flat subagent rows with status and depth markers', () => {
    render(<SubagentRail conversation={conversation} subagents={subagents} selectedAgentId={null} />);

    expect(screen.getByText('Main agent')).toBeInTheDocument();
    expect(screen.getByText('xBrief context costs')).toBeInTheDocument();
    expect(screen.getByText('Explore')).toBeInTheDocument();
    expect(screen.getByText('Trace the conversation parser')).toBeInTheDocument();
    expect(screen.getByText('general-purpose')).toBeInTheDocument();
    expect(screen.getByText('depth 2')).toBeInTheDocument();
    expect(screen.getAllByLabelText('running')).toHaveLength(2); // main agent + Explore
    expect(screen.getByLabelText('done')).toHaveClass('bg-muted-foreground/40');
    expect(screen.getByRole('complementary', { name: 'Conversation agents' })).toHaveClass('min-w-0');
  });

  it('marks the main agent row current while no subagent is selected', () => {
    render(<SubagentRail conversation={conversation} subagents={subagents} selectedAgentId={null} />);

    expect(screen.getByRole('button', { name: /Main agent/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /Explore/ })).not.toHaveAttribute('aria-current');
  });

  it('marks the selected subagent row current', () => {
    render(<SubagentRail conversation={conversation} subagents={subagents} selectedAgentId="deep" />);

    expect(screen.getByRole('button', { name: /general-purpose/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /Main agent/ })).not.toHaveAttribute('aria-current');
  });

  it('writes the clicked subagent into the URL and clears it from the main agent row', async () => {
    const user = userEvent.setup();
    render(<SubagentRail conversation={conversation} subagents={subagents} selectedAgentId={null} />);

    await user.click(screen.getByRole('button', { name: /Explore/ }));
    expect(new URLSearchParams(window.location.search).get('subagent')).toBe('alpha');

    await user.click(screen.getByRole('button', { name: /Main agent/ }));
    expect(new URLSearchParams(window.location.search).has('subagent')).toBe(false);
  });
});

describe('SubagentRail collapse (Awareness-rail pattern)', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/conv/42');
    localStorage.removeItem('overdeck.ui.agentsRailCollapsed');
  });

  it('collapses to a slim vertical tab and expands back', async () => {
    const user = userEvent.setup();
    render(<SubagentRail conversation={conversation} subagents={subagents} selectedAgentId={null} />);

    await user.click(screen.getByRole('button', { name: 'Collapse agents rail' }));

    expect(screen.queryByRole('complementary', { name: 'Conversation agents' })).not.toBeInTheDocument();
    const expandTab = screen.getByRole('button', { name: 'Show agents rail' });
    expect(expandTab).toHaveTextContent('Agents');
    expect(localStorage.getItem('overdeck.ui.agentsRailCollapsed')).toBe('true');

    await user.click(expandTab);

    expect(screen.getByRole('complementary', { name: 'Conversation agents' })).toBeInTheDocument();
    expect(screen.getByText('Main agent')).toBeInTheDocument();
    expect(localStorage.getItem('overdeck.ui.agentsRailCollapsed')).toBe('false');
  });

  it('restores the persisted collapsed state on mount', () => {
    localStorage.setItem('overdeck.ui.agentsRailCollapsed', 'true');

    render(<SubagentRail conversation={conversation} subagents={subagents} selectedAgentId={null} />);

    expect(screen.queryByRole('complementary', { name: 'Conversation agents' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show agents rail' })).toBeInTheDocument();
  });

  it('renders nothing while collapsed with no subagents', () => {
    localStorage.setItem('overdeck.ui.agentsRailCollapsed', 'true');

    const { container } = render(
      <SubagentRail conversation={conversation} subagents={[]} selectedAgentId={null} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

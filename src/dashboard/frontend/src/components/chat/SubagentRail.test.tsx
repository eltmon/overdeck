import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Conversation } from '../CommandDeck/ConversationList';
import type { SubagentSummary } from './chat-types';

const hookMocks = vi.hoisted(() => ({ useSubagentTranscript: vi.fn() }));

vi.mock('./useConversationMessagesStream', () => ({
  useSubagentTranscript: hookMocks.useSubagentTranscript,
}));
vi.mock('./MessagesTimeline', () => ({
  MessagesTimeline: ({ messages }: { messages: Array<{ text: string }> }) => (
    <div data-testid="subagent-timeline">{messages.map((message) => message.text).join(' ')}</div>
  ),
}));

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
    hookMocks.useSubagentTranscript.mockReset().mockReturnValue({
      data: {
        messages: [{ id: 'sub-msg', role: 'assistant', text: 'Subagent transcript', createdAt: '2026-07-18T00:01:00Z' }],
        workLog: [],
        streaming: false,
      },
      isLoading: false,
      isError: false,
    });
  });

  it('renders nothing when no subagents exist', () => {
    const { container } = render(<SubagentRail conversation={conversation} subagents={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders flat rows with status and nested-depth markers', () => {
    render(<SubagentRail conversation={conversation} subagents={subagents} />);

    expect(screen.getByText('Explore')).toBeInTheDocument();
    expect(screen.getByText('Trace the conversation parser')).toBeInTheDocument();
    expect(screen.getByText('general-purpose')).toBeInTheDocument();
    expect(screen.getByText('depth 2')).toBeInTheDocument();
    expect(screen.getByLabelText('running')).toHaveClass('bg-primary');
    expect(screen.getByLabelText('done')).toHaveClass('bg-muted-foreground/40');
    expect(screen.getByRole('complementary', { name: 'Conversation subagents' })).toHaveClass('min-w-0');
  });

  it('selects a subagent in the URL and renders its transcript without a composer', async () => {
    const user = userEvent.setup();
    render(<SubagentRail conversation={conversation} subagents={subagents} />);

    await user.click(screen.getByRole('button', { name: /Explore/i }));

    expect(new URLSearchParams(window.location.search).get('subagent')).toBe('alpha');
    expect(screen.getByText(/Explore/)).toHaveTextContent('Explore · Trace the conversation parser');
    expect(screen.getByTestId('subagent-timeline')).toHaveTextContent('Subagent transcript');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(hookMocks.useSubagentTranscript).toHaveBeenLastCalledWith(conversation, 'alpha');

    await user.click(screen.getByRole('button', { name: 'Close subagent transcript' }));
    expect(new URLSearchParams(window.location.search).has('subagent')).toBe(false);
    expect(screen.getByText('Subagents')).toBeInTheDocument();
  });

  it('opens a matching subagent directly from the URL', () => {
    window.history.replaceState({}, '', '/conv/42?subagent=deep');

    render(<SubagentRail conversation={conversation} subagents={subagents} />);

    expect(screen.getByText(/general-purpose/)).toHaveTextContent('general-purpose · Inspect nested behavior');
    expect(screen.getByTestId('subagent-timeline')).toBeInTheDocument();
    expect(hookMocks.useSubagentTranscript).toHaveBeenLastCalledWith(conversation, 'deep');
  });
});

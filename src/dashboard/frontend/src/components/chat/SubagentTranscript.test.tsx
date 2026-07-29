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

import { SubagentTranscript } from './SubagentTranscript';

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

const subagent: SubagentSummary = {
  agentId: 'alpha',
  agentType: 'Explore',
  description: 'Trace the conversation parser',
  toolUseId: 'toolu_alpha',
  spawnDepth: 1,
  status: 'running',
};

describe('SubagentTranscript', () => {
  beforeEach(() => {
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

  it('renders the selected subagent transcript without a composer', () => {
    render(<SubagentTranscript conversation={conversation} subagent={subagent} onBack={vi.fn()} />);

    expect(screen.getByText(/Explore/)).toHaveTextContent('Explore · Trace the conversation parser');
    expect(screen.getByTestId('subagent-timeline')).toHaveTextContent('Subagent transcript');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(hookMocks.useSubagentTranscript).toHaveBeenLastCalledWith(conversation, 'alpha');
  });

  it('gives the timeline a flex-column parent so it can scroll', () => {
    render(<SubagentTranscript conversation={conversation} subagent={subagent} onBack={vi.fn()} />);

    // jsdom has no layout, so assert the contract instead: MessagesTimeline sizes
    // itself with `flex: 1`, which resolves to nothing under a plain block parent —
    // the transcript then renders clipped with no scrolling and no Bottom button.
    const parent = screen.getByTestId('subagent-timeline').parentElement;
    expect(parent?.className).toContain('flex-col');
    expect(parent?.className).toContain('flex-1');
  });

  it('returns to the main agent from the back button', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<SubagentTranscript conversation={conversation} subagent={subagent} onBack={onBack} />);

    await user.click(screen.getByRole('button', { name: 'Back to main agent' }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('surfaces load failures instead of an empty transcript', () => {
    hookMocks.useSubagentTranscript.mockReturnValue({ data: undefined, isLoading: false, isError: true });

    render(<SubagentTranscript conversation={conversation} subagent={subagent} onBack={vi.fn()} />);

    expect(screen.getByText(/Couldn’t load|Couldn't load/)).toBeInTheDocument();
    expect(screen.queryByTestId('subagent-timeline')).not.toBeInTheDocument();
  });
});

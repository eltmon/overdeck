/**
 * PAN-2908 · C-VERB §3.9 gate — the wordy-transcript contract AS AMENDED by
 * the operator (2026-07-20): turns render in FULL (the per-turn line-budget
 * collapse was shipped then rejected), completion messages become structured
 * verdict cards, and the pre-existing work-log group collapse stays.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AssistantMessageRow, TurnBody, UserMessageRow } from './messageRows';
import { WorkLogGroup } from './workLogRows';
import type { ChatMessage, SubagentSummary, WorkLogEntry } from '../chat-types';
import { addCitation, consumeCitations, resetCitationStore } from '../../../lib/composerCitations.js';

// ChatMarkdown pulls in the syntax-highlight chain; the gate asserts budget
// behavior, not markdown fidelity.
vi.mock('../ChatMarkdown', () => ({
  ChatMarkdown: ({ text }: { text: string }) => <div data-testid="md">{text}</div>,
}));

function paragraphs(n: number, prefix = 'Paragraph'): string {
  return Array.from({ length: n }, (_, i) => `${prefix} ${i + 1} — the agent explains at length.`).join('\n\n');
}

describe('C-VERB gate: turns render in full (collapse rejected by operator)', () => {
  it('renders a 10-paragraph turn completely, with no budget toggle', () => {
    render(<TurnBody text={paragraphs(10)} streaming={false} />);
    expect(screen.getByText(/Paragraph 1 —/)).toBeInTheDocument();
    expect(screen.getByText(/Paragraph 10 —/)).toBeInTheDocument();
    expect(screen.queryByTestId('turn-budget-toggle')).not.toBeInTheDocument();
  });

  it('renders the full body after a verdict card too', () => {
    render(<TurnBody text={'ALL CHECKS PASSED for PAN-2377.\n\n' + paragraphs(8, 'Detail')} streaming={false} />);
    expect(screen.getByTestId('turn-verdict-card')).toBeInTheDocument();
    expect(screen.getByText(/Detail 8 —/)).toBeInTheDocument();
    expect(screen.queryByTestId('turn-budget-toggle')).not.toBeInTheDocument();
  });
});

describe('C-VERB gate: verdict extraction', () => {
  it('renders a pass verdict card for completion messages', () => {
    render(<TurnBody text={'ALL CHECKS PASSED for PAN-2377. Review: passed. Tests: passed.\n\nFull write-up follows here.'} streaming={false} />);
    const card = screen.getByTestId('turn-verdict-card');
    expect(card).toHaveAttribute('data-tone', 'pass');
    expect(card).toHaveTextContent('✓');
    expect(card).toHaveTextContent('ALL CHECKS PASSED for PAN-2377');
  });

  it('renders a fail verdict card for changes-requested messages', () => {
    render(<TurnBody text={'Changes requested: 2 findings need attention before merge.'} streaming={false} />);
    const card = screen.getByTestId('turn-verdict-card');
    expect(card).toHaveAttribute('data-tone', 'fail');
    expect(card).toHaveTextContent('✗');
  });

  it('renders a glyph-led verdict from the leading check mark', () => {
    render(<TurnBody text={'✓ Ship it — everything is green.'} streaming={false} />);
    expect(screen.getByTestId('turn-verdict-card')).toHaveAttribute('data-tone', 'pass');
  });

  it('does not card an ordinary turn', () => {
    render(<TurnBody text={paragraphs(2)} streaming={false} />);
    expect(screen.queryByTestId('turn-verdict-card')).not.toBeInTheDocument();
  });

  it('does not card neutral mentions of "blocked" (over-fire guard)', () => {
    render(<TurnBody text={'Work is blocked by the upstream task finishing first.'} streaming={false} />);
    expect(screen.queryByTestId('turn-verdict-card')).not.toBeInTheDocument();
  });
});

describe('C-VERB gate: command groups collapse (pre-existing)', () => {
  function entries(n: number): WorkLogEntry[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `e-${i}`,
      createdAt: '2026-07-20T00:00:00Z',
      label: i % 2 === 0 ? 'Bash' : 'wait',
      detail: `payload-${i}`,
      tone: 'tool' as const,
    }));
  }

  it('keeps only the newest entries visible with an overflow expander', () => {
    render(<WorkLogGroup entries={entries(60)} />);
    // Newest 6 visible; the earlier 54 collapse behind the expander.
    expect(screen.getByText(/payload-59/)).toBeInTheDocument();
    expect(screen.queryByText(/payload-10/)).not.toBeInTheDocument();
    const expander = screen.getByRole('button', { name: /Show 54 earlier/ });
    fireEvent.click(expander);
    expect(screen.getByText(/payload-10/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Collapse/ }));
    expect(screen.queryByText(/payload-10/)).not.toBeInTheDocument();
  });
});

describe('subagent transcript action', () => {
  const entry: WorkLogEntry = {
    id: 'toolu-subagent',
    createdAt: '2026-07-20T00:00:00Z',
    label: 'Task',
    toolTitle: 'Task',
    tone: 'tool',
    toolInput: {
      subagent_type: 'Explore',
      description: 'Trace the parser',
      prompt: 'Find the relevant message path.',
    },
  };
  const subagent: SubagentSummary = {
    agentId: 'subagent-1',
    agentType: 'Explore',
    description: 'Trace the parser',
    toolUseId: entry.id,
    spawnDepth: 1,
    status: 'done',
  };

  it.each(['Agent', 'Task'])('opens the matching subagent from an expanded %s row', (tool) => {
    const agentEntry = { ...entry, label: tool, toolTitle: tool };
    const onOpenSubagent = vi.fn();
    render(
      <WorkLogGroup
        entries={[agentEntry]}
        subagentByToolUseId={new Map([[entry.id, subagent]])}
        onOpenSubagent={onOpenSubagent}
      />,
    );

    fireEvent.click(screen.getByText(tool));
    expect(screen.getByText('Explore')).toBeInTheDocument();
    expect(screen.getByTestId('md')).toHaveTextContent('Find the relevant message path.');
    expect(screen.queryByText(/"subagent_type"/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open subagent transcript' }));
    expect(onOpenSubagent).toHaveBeenCalledWith(entry.id);
  });

  it('opens a Codex child while preserving every spawn argument and the tool result', () => {
    const toolInput = { task_name: 'reader', message: 'Inspect the parser', fork_turns: 'all', agent_type: 'explorer' };
    const result = '{"task_name":"/root/reader"}';
    const onOpenSubagent = vi.fn();
    render(<WorkLogGroup entries={[{ ...entry, label: 'spawn_agent', toolTitle: 'spawn_agent', toolInput, result }]}
      subagentByToolUseId={new Map([[entry.id, subagent]])} onOpenSubagent={onOpenSubagent} />);
    fireEvent.click(screen.getByText('spawn_agent'));
    expect(screen.getByText((_, element) => element?.tagName === 'CODE' && element.textContent === JSON.stringify(toolInput, null, 2))).toBeInTheDocument();
    expect(screen.getByText(result)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open subagent transcript' }));
    expect(onOpenSubagent).toHaveBeenCalledWith(entry.id);
  });

  it('omits the action when no subagent matches the tool use id', () => {
    render(<WorkLogGroup entries={[entry]} subagentByToolUseId={new Map()} onOpenSubagent={vi.fn()} />);

    fireEvent.click(screen.getByText('Task'));
    expect(screen.queryByRole('button', { name: 'Open subagent transcript' })).not.toBeInTheDocument();
  });
});

describe('PAN-4642 cite-row gate', () => {
  function assistantMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
    return { id: 'asst-1', role: 'assistant', text: 'Here is my reply.', createdAt: '2026-11-01T00:00:00Z', completedAt: '2026-11-01T00:00:01Z', ...overrides };
  }
  function userMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
    return { id: 'user-1', role: 'user', text: 'My question.', createdAt: '2026-11-01T00:00:00Z', ...overrides };
  }

  it('marks a completed assistant row citable when citeConversationName is set', () => {
    render(<AssistantMessageRow message={assistantMessage()} durationStart="2026-11-01T00:00:00Z" isStreaming={false} citeConversationName="conv-a" />);
    expect(document.querySelector('[data-cite-message-id="asst-1"][data-cite-role="assistant"]')).toBeInTheDocument();
  });

  it('does not mark a still-streaming assistant row citable', () => {
    render(<AssistantMessageRow message={assistantMessage({ completedAt: undefined })} durationStart="2026-11-01T00:00:00Z" isStreaming citeConversationName="conv-a" />);
    expect(document.querySelector('[data-cite-message-id]')).not.toBeInTheDocument();
  });

  it('does not mark an assistant row citable without citeConversationName', () => {
    render(<AssistantMessageRow message={assistantMessage()} durationStart="2026-11-01T00:00:00Z" isStreaming={false} />);
    expect(document.querySelector('[data-cite-message-id]')).not.toBeInTheDocument();
  });

  it('marks a settled user row citable when citeConversationName is set', () => {
    render(<UserMessageRow message={userMessage()} citeConversationName="conv-a" />);
    expect(document.querySelector('[data-cite-message-id="user-1"][data-cite-role="user"]')).toBeInTheDocument();
  });

  it('does not mark an optimistic user row citable', () => {
    render(<UserMessageRow message={userMessage({ id: 'optimistic-1' })} citeConversationName="conv-a" />);
    expect(document.querySelector('[data-cite-message-id]')).not.toBeInTheDocument();
  });
});

describe('PAN-4642 citation highlight (data-cited)', () => {
  const SOURCE = { kind: 'message' as const, messageId: 'asst-1', role: 'assistant' as const };

  function assistantMessage(): ChatMessage {
    return { id: 'asst-1', role: 'assistant', text: 'Here is my reply.', createdAt: '2026-11-01T00:00:00Z', completedAt: '2026-11-01T00:00:01Z' };
  }

  beforeEach(() => {
    localStorage.clear();
    resetCitationStore();
  });

  it('renders data-cited="true" on an assistant row with a pending citation', () => {
    addCitation('conv-a', { source: SOURCE, quotedText: 'my reply', comment: '' });
    render(<AssistantMessageRow message={assistantMessage()} durationStart="2026-11-01T00:00:00Z" isStreaming={false} citeConversationName="conv-a" />);
    expect(document.querySelector('[data-cite-message-id="asst-1"]')).toHaveAttribute('data-cited', 'true');
  });

  it('removes data-cited once the citation is consumed', () => {
    addCitation('conv-a', { source: SOURCE, quotedText: 'my reply', comment: '' });
    render(<AssistantMessageRow message={assistantMessage()} durationStart="2026-11-01T00:00:00Z" isStreaming={false} citeConversationName="conv-a" />);
    expect(document.querySelector('[data-cite-message-id="asst-1"]')).toHaveAttribute('data-cited', 'true');

    act(() => { consumeCitations('conv-a'); });
    expect(document.querySelector('[data-cite-message-id="asst-1"]')).not.toHaveAttribute('data-cited', 'true');
  });
});

describe('PAN-4476 shared prompt author', () => {
  const user = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
    id: 'user-1',
    role: 'user',
    text: 'Run the tests.',
    createdAt: '2026-11-01T00:00:00Z',
    ...overrides,
  });
  const alice = { login: 'alice', avatarUrl: 'https://avatars.githubusercontent.com/u/1' };

  it('renders @login and the avatar on a user message with an author', () => {
    render(<UserMessageRow message={user({ author: alice })} />);
    const line = screen.getByTestId('user-message-author');
    expect(line.textContent).toContain('@alice');
    expect(line.querySelector('img')?.getAttribute('src')).toBe(alice.avatarUrl);
  });

  it('renders no author line without an author', () => {
    render(<UserMessageRow message={user()} />);
    expect(screen.queryByTestId('user-message-author')).toBeNull();
  });

  it('leaves an optimistic message unchanged', () => {
    render(<UserMessageRow message={user({ id: 'optimistic-1', acknowledged: true })} />);
    expect(screen.queryByTestId('user-message-author')).toBeNull();
    expect(screen.getByText('Sent · waiting for transcript')).toBeTruthy();
  });
});

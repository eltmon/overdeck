/**
 * MessagesTimeline tests — round-divider injection (PAN-830, pan-y6ge).
 *
 * The first eight rows are always rendered in the non-virtualized tail under
 * `ALWAYS_UNVIRTUALIZED_TAIL_ROWS`, so a small fixture renders entirely in
 * normal flow. That keeps these tests independent of jsdom's missing layout
 * APIs (`getBoundingClientRect`, `ResizeObserver` callbacks) which the
 * virtualizer relies on for measurement.
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagesTimeline, type RoundMarker } from '../MessagesTimeline';
import type { ChatMessage } from '../chat-types';

vi.mock('../ChatMarkdown', () => ({
  ChatMarkdown: ({ text, cwd, issueId }: { text: string; cwd?: string; issueId?: string | null }) => (
    <div data-testid="chat-markdown" data-cwd={cwd ?? ''} data-issue-id={issueId ?? ''}>{text}</div>
  ),
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, getItemKey, estimateSize }: {
    count: number;
    getItemKey?: (index: number) => string;
    estimateSize?: (index: number) => number;
  }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({
      index,
      key: getItemKey?.(index) ?? index,
      start: index * 40,
      size: estimateSize?.(index) ?? 40,
    })),
    getTotalSize: () => count * 40,
    measure: vi.fn(),
    measureElement: vi.fn(),
    scrollToIndex: vi.fn(),
  }),
}));

function makeMessage(id: string, role: ChatMessage['role'], offsetMs: number, text = `text:${id}`): ChatMessage {
  return {
    id,
    role,
    text,
    createdAt: new Date(1_700_000_000_000 + offsetMs).toISOString(),
    completedAt:
      role === 'assistant'
        ? new Date(1_700_000_000_000 + offsetMs + 1000).toISOString()
        : undefined,
  };
}

describe('MessagesTimeline — search', () => {
  it('handles target-message scroll requests once per target key', async () => {
    const messages: ChatMessage[] = [
      makeMessage('u1', 'user', 0, 'hello'),
      makeMessage('a1', 'assistant', 5_000, 'target reply'),
    ];
    const workLog: [] = [];
    const onTargetMessageHandled = vi.fn();

    const { rerender } = render(
      <MessagesTimeline
        messages={messages}
        workLog={workLog}
        streaming={false}
        targetMessageId="a1"
        targetMessageIndex={1}
        targetMessageNonce={1}
        onTargetMessageHandled={onTargetMessageHandled}
      />,
    );

    await waitFor(() => expect(onTargetMessageHandled).toHaveBeenCalledTimes(1));

    rerender(
      <MessagesTimeline
        messages={messages}
        workLog={workLog}
        streaming={false}
        targetMessageId="a1"
        targetMessageIndex={1}
        targetMessageNonce={1}
        onTargetMessageHandled={onTargetMessageHandled}
      />,
    );

    expect(onTargetMessageHandled).toHaveBeenCalledTimes(1);

    rerender(
      <MessagesTimeline
        messages={messages}
        workLog={workLog}
        streaming={false}
        targetMessageId="a1"
        targetMessageIndex={1}
        targetMessageNonce={2}
        onTargetMessageHandled={onTargetMessageHandled}
      />,
    );

    await waitFor(() => expect(onTargetMessageHandled).toHaveBeenCalledTimes(2));
  });

  it('captures Ctrl+F and searches messages beyond browser-visible text', () => {
    const messages: ChatMessage[] = [
      makeMessage('u1', 'user', 0, 'hello from the top'),
      makeMessage('a1', 'assistant', 5_000, 'the needle is in the assistant reply'),
    ];

    render(<MessagesTimeline messages={messages} workLog={[]} streaming={false} />);

    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    const input = screen.getByRole('textbox', { name: 'Search conversation' });
    expect(input).toHaveFocus();

    fireEvent.change(input, { target: { value: 'needle' } });
    expect(screen.getByText('1/1')).toBeInTheDocument();
    const highlighted = screen.getByText('needle');
    expect(highlighted).toHaveAttribute('data-conversation-search-highlight', 'true');
    expect(highlighted).toHaveClass('bg-amber-300/40');
    expect(highlighted.closest('[data-search-row-id]'))
      .toHaveStyle({ outline: '2px solid var(--color-primary)' });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Search conversation' })).toBeNull();
  });
});

describe('MessagesTimeline — roundMarkers', () => {
  it('passes file-link context to virtualized message rows', () => {
    const messages: ChatMessage[] = Array.from({ length: 10 }, (_, index) =>
      makeMessage(`a${index + 1}`, 'assistant', index * 5_000),
    );

    render(
      <MessagesTimeline
        messages={messages}
        workLog={[]}
        streaming={false}
        cwd="/home/eltmon/project"
        issueId="PAN-1370"
      />,
    );

    const oldestRenderedMarkdown = screen.getByText('text:a1');
    expect(oldestRenderedMarkdown).toHaveAttribute('data-cwd', '/home/eltmon/project');
    expect(oldestRenderedMarkdown).toHaveAttribute('data-issue-id', 'PAN-1370');
  });

  it('renders no dividers when roundMarkers is omitted', () => {
    const messages: ChatMessage[] = [
      makeMessage('u1', 'user', 0),
      makeMessage('a1', 'assistant', 5_000),
    ];
    render(
      <MessagesTimeline messages={messages} workLog={[]} streaming={false} />,
    );
    expect(screen.queryByTestId(/^round-divider-/)).toBeNull();
  });

  it('injects a divider after the row whose id matches afterMessageId', () => {
    const messages: ChatMessage[] = [
      makeMessage('u1', 'user', 0),
      makeMessage('a1', 'assistant', 5_000),
      makeMessage('u2', 'user', 10_000),
    ];
    const markers: RoundMarker[] = [
      { afterMessageId: 'a1', round: 1, verdict: 'passed' },
    ];
    render(
      <MessagesTimeline
        messages={messages}
        workLog={[]}
        streaming={false}
        roundMarkers={markers}
      />,
    );
    const divider = screen.getByTestId('round-divider-1');
    expect(divider).toBeInTheDocument();
    expect(divider).toHaveAttribute('data-round', '1');
    expect(divider).toHaveAttribute('data-verdict', 'passed');
    expect(divider.textContent).toContain('Round 1');
    expect(divider.textContent).toContain('Passed');
  });

  it('renders multiple round dividers in order (passed/failed/running/pending)', () => {
    const messages: ChatMessage[] = [
      makeMessage('u1', 'user', 0),
      makeMessage('a1', 'assistant', 5_000),
      makeMessage('a2', 'assistant', 10_000),
      makeMessage('a3', 'assistant', 15_000),
      makeMessage('a4', 'assistant', 20_000),
    ];
    const markers: RoundMarker[] = [
      { afterMessageId: 'a1', round: 1, verdict: 'passed' },
      { afterMessageId: 'a2', round: 2, verdict: 'failed' },
      { afterMessageId: 'a3', round: 3, verdict: 'running' },
      { afterMessageId: 'a4', round: 4, verdict: 'pending' },
    ];
    render(
      <MessagesTimeline
        messages={messages}
        workLog={[]}
        streaming={false}
        roundMarkers={markers}
      />,
    );
    const round1 = screen.getByTestId('round-divider-1');
    const round2 = screen.getByTestId('round-divider-2');
    const round3 = screen.getByTestId('round-divider-3');
    const round4 = screen.getByTestId('round-divider-4');
    expect(round1).toHaveAttribute('data-verdict', 'passed');
    expect(round2).toHaveAttribute('data-verdict', 'failed');
    expect(round3).toHaveAttribute('data-verdict', 'running');
    expect(round4).toHaveAttribute('data-verdict', 'pending');
    expect(round1.textContent).toContain('Passed');
    expect(round2.textContent).toContain('Failed');
    expect(round3.textContent).toContain('Running');
    expect(round4.textContent).toContain('Pending');
  });

  it('appends an optional label suffix when provided', () => {
    const messages: ChatMessage[] = [
      makeMessage('u1', 'user', 0),
      makeMessage('a1', 'assistant', 5_000),
    ];
    const markers: RoundMarker[] = [
      {
        afterMessageId: 'a1',
        round: 2,
        verdict: 'passed',
        label: 'synthesis',
      },
    ];
    render(
      <MessagesTimeline
        messages={messages}
        workLog={[]}
        streaming={false}
        roundMarkers={markers}
      />,
    );
    const divider = screen.getByTestId('round-divider-2');
    expect(divider.textContent).toContain('synthesis');
  });

  it('drops markers whose afterMessageId does not match any row', () => {
    const messages: ChatMessage[] = [
      makeMessage('u1', 'user', 0),
      makeMessage('a1', 'assistant', 5_000),
    ];
    const markers: RoundMarker[] = [
      { afterMessageId: 'does-not-exist', round: 9, verdict: 'failed' },
    ];
    render(
      <MessagesTimeline
        messages={messages}
        workLog={[]}
        streaming={false}
        roundMarkers={markers}
      />,
    );
    expect(screen.queryByTestId('round-divider-9')).toBeNull();
  });

  it('renders multiple dividers attached to the same row in marker order', () => {
    const messages: ChatMessage[] = [
      makeMessage('u1', 'user', 0),
      makeMessage('a1', 'assistant', 5_000),
    ];
    const markers: RoundMarker[] = [
      { afterMessageId: 'a1', round: 1, verdict: 'passed', label: 'review' },
      { afterMessageId: 'a1', round: 1, verdict: 'running', label: 'synthesis' },
    ];
    render(
      <MessagesTimeline
        messages={messages}
        workLog={[]}
        streaming={false}
        roundMarkers={markers}
      />,
    );
    const dividers = screen.getAllByTestId('round-divider-1');
    expect(dividers).toHaveLength(2);
    expect(dividers[0]?.textContent).toContain('review');
    expect(dividers[1]?.textContent).toContain('synthesis');
  });

  it('marks dividers as separators with an accessible label', () => {
    const messages: ChatMessage[] = [
      makeMessage('u1', 'user', 0),
      makeMessage('a1', 'assistant', 5_000),
    ];
    const markers: RoundMarker[] = [
      { afterMessageId: 'a1', round: 7, verdict: 'failed' },
    ];
    render(
      <MessagesTimeline
        messages={messages}
        workLog={[]}
        streaming={false}
        roundMarkers={markers}
      />,
    );
    const divider = screen.getByTestId('round-divider-7');
    expect(divider).toHaveAttribute('role', 'separator');
    expect(divider).toHaveAttribute('aria-label', 'Round 7 — Failed');
  });

  it('collapses tool-only work groups when hideToolCalls is true', () => {
    const messages: ChatMessage[] = [
      makeMessage('u1', 'user', 0),
      makeMessage('a1', 'assistant', 5_000),
    ];
    const workLog = [
      { id: 'w1', createdAt: new Date(1_700_000_005_000).toISOString(), label: 'Bash', tone: 'tool' as const },
      { id: 'w2', createdAt: new Date(1_700_000_006_000).toISOString(), label: 'Read', tone: 'tool' as const },
    ];
    render(
      <MessagesTimeline
        messages={messages}
        workLog={workLog}
        streaming={false}
        hideToolCalls
      />,
    );
    expect(screen.getByText('2 tool calls were made')).toBeInTheDocument();
    expect(screen.queryByText('Bash')).not.toBeInTheDocument();
    expect(screen.queryByText('Read')).not.toBeInTheDocument();
  });

  it('does not collapse mixed-tone work groups even when hideToolCalls is true', () => {
    const messages: ChatMessage[] = [
      makeMessage('u1', 'user', 0),
      makeMessage('a1', 'assistant', 5_000),
    ];
    const workLog = [
      { id: 'w1', createdAt: new Date(1_700_000_005_000).toISOString(), label: 'Bash', tone: 'tool' as const },
      { id: 'w2', createdAt: new Date(1_700_000_006_000).toISOString(), label: 'Context compacted', tone: 'info' as const },
    ];
    render(
      <MessagesTimeline
        messages={messages}
        workLog={workLog}
        streaming={false}
        hideToolCalls
      />,
    );
    expect(screen.queryByText(/tool calls were made/)).not.toBeInTheDocument();
    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(screen.getByText('Context compacted')).toBeInTheDocument();
  });
});

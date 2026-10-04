/**
 * MessagesTimeline tests — round-divider injection (PAN-830, pan-y6ge).
 *
 * The first eight rows are always rendered in the non-virtualized tail under
 * `ALWAYS_UNVIRTUALIZED_TAIL_ROWS`, so a small fixture renders entirely in
 * normal flow. That keeps these tests independent of jsdom's missing layout
 * APIs (`getBoundingClientRect`, `ResizeObserver` callbacks) which the
 * virtualizer relies on for measurement.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MessagesTimeline, type RoundMarker } from '../MessagesTimeline';
import type { ChatMessage, WorkLogEntry } from '../chat-types';
import { useConnectionState } from '../../../lib/connectionState';
import { ConversationBookmarksProvider, useConversationBookmarks } from '../bookmarks/ConversationBookmarks';

vi.mock('../ChatMarkdown', () => ({
  ChatMarkdownSettingsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  ChatMarkdown: ({ text, cwd, issueId }: { text: string; cwd?: string; issueId?: string | null }) => (
    <div data-testid="chat-markdown" data-cwd={cwd ?? ''} data-issue-id={issueId ?? ''}>{text}</div>
  ),
}));

const { measureSpy, resizeItemSpy, indexFromElementSpy, elementsCache } = vi.hoisted(() => ({
  measureSpy: vi.fn(),
  resizeItemSpy: vi.fn(),
  indexFromElementSpy: vi.fn((el: Element) => Number(el.getAttribute('data-index') ?? -1)),
  elementsCache: new Map<string, Element>(),
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
    measure: measureSpy,
    measureElement: vi.fn(),
    scrollToIndex: vi.fn(),
    resizeItem: resizeItemSpy,
    elementsCache,
    indexFromElement: indexFromElementSpy,
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
  it('clears the Sending indicator for acknowledged optimistic messages', () => {
    render(
      <MessagesTimeline
        messages={[
          {
            ...makeMessage('optimistic-ack', 'user', 0, 'acked message'),
            acknowledged: true,
          },
        ]}
        workLog={[]}
        streaming={false}
      />,
    );

    expect(screen.getByText('acked message')).toBeInTheDocument();
    expect(screen.queryByText('Sending…')).not.toBeInTheDocument();
  });

  it('preserves prompt and command recovery actions while distinguishing unknown delivery', () => {
    const retry = vi.fn();
    const discard = vi.fn();
    render(<MessagesTimeline messages={[]} workLog={[]} streaming={false}
      failedMessages={[
        { id: 'unknown', text: 'Unknown prompt', kind: 'prompt', createdAt: '', deliveryUnknown: true, retryable: false, error: 'Receipt expired' },
        { id: 'failed', text: 'Rejected prompt', kind: 'prompt', createdAt: '', retryable: true },
        { id: 'command', text: '/pan status', kind: 'command', createdAt: '', retryable: true },
      ]} onRetryFailed={retry} onDiscardFailed={discard} />);
    expect(screen.getByText('Delivery not confirmed')).toBeInTheDocument();
    expect(screen.getByText('Failed to send')).toBeInTheDocument();
    expect(screen.getByText('Command request failed')).toBeInTheDocument();
    expect(screen.getByText('Receipt expired')).toBeInTheDocument();
    expect(screen.getByText('Unknown prompt')).toBeInTheDocument();
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries).toHaveLength(2);
    fireEvent.click(retries[0]);
    expect(retry).toHaveBeenCalledWith('failed', 'Rejected prompt');
    const discards = screen.getAllByRole('button', { name: 'Discard' });
    expect(discards).toHaveLength(3);
    fireEvent.click(discards[0]);
    expect(discard).toHaveBeenCalledWith('unknown');
  });

  it('renders Not delivered — resend for a not-delivered failure (PAN-4278)', () => {
    const retry = vi.fn();
    render(<MessagesTimeline messages={[]} workLog={[]} streaming={false}
      failedMessages={[
        { id: 'not-delivered', text: 'BTW How can I launch Orca?', kind: 'prompt', createdAt: '', code: 'not-delivered',
          error: 'Not delivered: refused: agent_blocked', deliveryUnknown: false, retryable: true },
      ]} onRetryFailed={retry} />);

    expect(screen.getByText('Not delivered — resend')).toBeInTheDocument();
    expect(screen.getByText('Not delivered: refused: agent_blocked')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
    expect(retry).toHaveBeenCalledWith('not-delivered', 'BTW How can I launch Orca?');
  });

  it('labels a held message and offers Retry only once the server is live (PAN-4279)', () => {
    const held = [{ id: 'held', text: 'held ping', kind: 'prompt' as const, createdAt: '', retryable: true, heldOffline: true }];
    useConnectionState.setState({ serverReachable: false, streamLive: false, restarting: false });
    try {
      const { unmount } = render(<MessagesTimeline messages={[]} workLog={[]} streaming={false} failedMessages={held} />);
      expect(screen.getByText('Waiting to send — will send when the server reconnects')).toBeInTheDocument();
      expect(screen.queryByText('Failed to send')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
      unmount();

      useConnectionState.setState({ serverReachable: true, streamLive: true });
      render(<MessagesTimeline messages={[]} workLog={[]} streaming={false} failedMessages={held} />);
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    } finally {
      useConnectionState.setState({ serverReachable: true, streamLive: false });
    }
  });

  it('renders a not-found outbox entry with Resend and copies its text to the clipboard (PAN-4247 AC4)', () => {
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    try {
      const retry = vi.fn();
      render(<MessagesTimeline messages={[]} workLog={[]} streaming={false}
        failedMessages={[
          { id: 'not-found', text: 'Are you still there?', kind: 'prompt', createdAt: '', notFoundInTranscript: true, deliveryUnknown: true, retryable: true },
        ]} onRetryFailed={retry} />);

      expect(screen.getByText('Not found in transcript')).toBeInTheDocument();
      expect(screen.queryByText('Delivery not confirmed')).not.toBeInTheDocument();
      const resend = screen.getByRole('button', { name: 'Resend' });
      fireEvent.click(resend);
      expect(retry).toHaveBeenCalledWith('not-found', 'Are you still there?');

      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Are you still there?');
    } finally {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard });
    }
  });

  it.each([
    ['pending', false, 'Sending…', {}],
    ['accepted', true, 'Sent · waiting for transcript', {}],
    ['unknown', false, 'Delivery not confirmed', {}],
    ['subagent', true, 'Delivered to subagent · Investigate flaky test', {
      deliveredToSubagent: { agentId: 'agent-1', description: 'Investigate flaky test' },
    }],
  ] as const)('renders the %s delivery state without losing the message text', (deliveryState, acknowledged, label, extra) => {
    render(<MessagesTimeline messages={[{
      ...makeMessage('optimistic-id', 'user', 0, 'Preserved prompt'), deliveryState, acknowledged, ...extra,
    }]} workLog={[]} streaming={false} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText('Preserved prompt')).toBeInTheDocument();
  });

  it('renders a subagent landing at full opacity with no spinner and no waiting-for-transcript label (PAN-4247 AC3)', () => {
    render(<MessagesTimeline messages={[{
      ...makeMessage('optimistic-id', 'user', 0, 'Preserved prompt'),
      deliveryState: 'subagent',
      acknowledged: true,
      deliveredToSubagent: { agentId: 'agent-1', description: 'Investigate flaky test' },
    }]} workLog={[]} streaming={false} />);
    expect(screen.getByText('Delivered to subagent · Investigate flaky test')).toBeInTheDocument();
    expect(screen.queryByText('Sent · waiting for transcript')).not.toBeInTheDocument();
    const bubble = screen.getByTitle(/routed this message to running subagent agent-1/);
    expect(bubble.querySelector('svg')).toBeNull();
    expect(bubble).not.toHaveStyle({ opacity: '0.6' });
  });

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
    const highlightedRow = highlighted.closest('[data-search-row-id]') as HTMLElement;
    const expectedOutline = document.createElement('div');
    expectedOutline.style.outline = '2px solid var(--color-primary)';
    expect(highlightedRow.style.outlineWidth).toBe(expectedOutline.style.outlineWidth);
    expect(highlightedRow.style.outlineStyle).toBe(expectedOutline.style.outlineStyle);
    expect(highlightedRow.style.outlineColor).toBe(expectedOutline.style.outlineColor);

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

  it('re-reads mounted row heights after hideToolCalls changes (PAN-4497)', () => {
    const messages: ChatMessage[] = [
      makeMessage('u1', 'user', 0),
      makeMessage('a1', 'assistant', 5_000),
    ];
    const el = document.createElement('div');
    el.setAttribute('data-index', '0');
    Object.defineProperty(el, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 123 }) as DOMRect,
    });
    document.body.appendChild(el);
    elementsCache.set('a1', el);

    try {
      const { rerender } = render(
        <MessagesTimeline messages={messages} workLog={[]} streaming={false} hideToolCalls={false} />,
      );

      resizeItemSpy.mockClear();
      measureSpy.mockClear();

      rerender(
        <MessagesTimeline messages={messages} workLog={[]} streaming={false} hideToolCalls />,
      );

      expect(resizeItemSpy).toHaveBeenCalledWith(0, 123);
      expect(measureSpy).not.toHaveBeenCalled();
    } finally {
      document.body.removeChild(el);
      elementsCache.clear();
    }
  });

  it('shows command detail for Codex shell work log rows', () => {
    const messages: ChatMessage[] = [
      makeMessage('u1', 'user', 0),
      makeMessage('a1', 'assistant', 5_000),
    ];
    const workLog: WorkLogEntry[] = [
      {
        id: 'w1',
        createdAt: new Date(1_700_000_005_000).toISOString(),
        label: 'Shell',
        command: 'git status --short\nnpm test',
        tone: 'tool',
      },
    ];

    render(
      <MessagesTimeline
        messages={messages}
        workLog={workLog}
        streaming={false}
      />,
    );

    expect(screen.getByText('Shell')).toBeInTheDocument();
    expect(screen.getByText('git status --short')).toBeInTheDocument();
  });
});

describe('MessagesTimeline — Pi harness tool entries', () => {
  it('renders the lowercase bash label + command summary in the collapsed row', () => {
    const messages: ChatMessage[] = [
      makeMessage('u1', 'user', 0),
      makeMessage('a1', 'assistant', 5_000),
    ];
    const workLog: WorkLogEntry[] = [
      {
        id: 'w1',
        createdAt: new Date(1_700_000_005_000).toISOString(),
        label: 'bash',
        toolTitle: 'bash',
        toolInput: { command: 'rg -n foo src/' },
        detail: 'rg -n foo src/',
        result: 'src/a.ts:1:foo',
        tone: 'tool',
      },
    ];
    render(<MessagesTimeline messages={messages} workLog={workLog} streaming={false} />);
    expect(screen.getByText('bash')).toBeInTheDocument();
    expect(screen.getByText('rg -n foo src/')).toBeInTheDocument();
  });

  it('expands a bash entry to show the full command in a shell block', () => {
    const messages: ChatMessage[] = [
      makeMessage('u1', 'user', 0),
      makeMessage('a1', 'assistant', 5_000),
    ];
    const workLog: WorkLogEntry[] = [
      {
        id: 'w1',
        createdAt: new Date(1_700_000_005_000).toISOString(),
        label: 'bash',
        toolTitle: 'bash',
        toolInput: { command: 'fd -t f pi src/\n# second line' },
        detail: 'fd -t f pi src/',
        tone: 'tool',
      },
    ];
    render(<MessagesTimeline messages={messages} workLog={workLog} streaming={false} />);
    // Collapsed: only the first-line summary is visible.
    expect(screen.queryByText(/# second line/)).not.toBeInTheDocument();
    // The row label is clickable to expand.
    fireEvent.click(screen.getByText('bash'));
    // Expanded: the second line of the command renders — it only exists in
    // the expanded shell block, so this uniquely proves the full command is shown.
    expect(screen.getByText(/# second line/)).toBeInTheDocument();
  });

  it('expands a read entry to show the file path', () => {
    const messages: ChatMessage[] = [
      makeMessage('u1', 'user', 0),
      makeMessage('a1', 'assistant', 5_000),
    ];
    const workLog: WorkLogEntry[] = [
      {
        id: 'w1',
        createdAt: new Date(1_700_000_005_000).toISOString(),
        label: 'read',
        toolTitle: 'read',
        toolInput: { path: '/repo/src/lib/util.ts' },
        detail: 'util.ts',
        tone: 'tool',
      },
    ];
    render(<MessagesTimeline messages={messages} workLog={workLog} streaming={false} />);
    fireEvent.click(screen.getByText('read'));
    // ChatMarkdown is mocked to pass the path (wrapped in backticks) through as text.
    expect(screen.getByText(/\/repo\/src\/lib\/util\.ts/)).toBeInTheDocument();
  });

  it('still shows the tool body for error-tone entries (errored tool call)', () => {
    const messages: ChatMessage[] = [
      makeMessage('u1', 'user', 0),
      makeMessage('a1', 'assistant', 5_000),
    ];
    const workLog: WorkLogEntry[] = [
      {
        id: 'w1',
        createdAt: new Date(1_700_000_005_000).toISOString(),
        label: 'edit',
        toolTitle: 'edit',
        toolInput: { path: '/repo/src/a.ts', edits: [{ oldText: 'x', newText: 'y' }] },
        result: 'oldText not found',
        tone: 'error',
      },
    ];
    render(<MessagesTimeline messages={messages} workLog={workLog} streaming={false} />);
    // Errored entry is expandable and surfaces the file path (tool body)
    // alongside the error result.
    fireEvent.click(screen.getByText('edit'));
    expect(screen.getByText(/\/repo\/src\/a\.ts/)).toBeInTheDocument();
    expect(screen.getByText('oldText not found')).toBeInTheDocument();
  });
});

describe('MessagesTimeline — bookmark jump (PAN-4498 WI-7)', () => {
  const fetchMock = vi.fn();
  const outlineOf = (el: HTMLElement) => `${el.style.outlineWidth} ${el.style.outlineStyle} ${el.style.outlineColor}`;
  const expectedOutline = (() => {
    const div = document.createElement('div');
    div.style.outline = '2px solid var(--color-primary)';
    return `${div.style.outlineWidth} ${div.style.outlineStyle} ${div.style.outlineColor}`;
  })();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ bookmarks: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function JumpTrigger({ messageId }: { messageId: string }) {
    const ctx = useConversationBookmarks();
    return (
      <>
        <button onClick={() => ctx?.jumpTo(messageId)}>jump</button>
        <span data-testid="missing">{ctx?.missingMessageId ?? ''}</span>
      </>
    );
  }

  function renderWithBookmarks(messages: ChatMessage[], opts: { bookmarksEnabled?: boolean } = {}) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <ConversationBookmarksProvider conversationName="conv-a">
          <JumpTrigger messageId="target" />
          <MessagesTimeline messages={messages} workLog={[]} streaming={false} bookmarksEnabled={opts.bookmarksEnabled ?? true} />
        </ConversationBookmarksProvider>
      </QueryClientProvider>,
    );
  }

  it('a jump request for a row inside the virtualized region scrolls it into view and outlines it', async () => {
    const messages: ChatMessage[] = Array.from({ length: 12 }, (_, i) =>
      makeMessage(i === 2 ? 'target' : `m${i}`, 'assistant', i * 1000, `text ${i}`));
    renderWithBookmarks(messages);
    await act(() => vi.advanceTimersByTimeAsync(0));

    fireEvent.click(screen.getByText('jump'));
    await act(() => vi.advanceTimersByTimeAsync(0));

    const row = document.querySelector('[data-search-row-id="target"]') as HTMLElement;
    expect(row).toBeTruthy();
    expect(outlineOf(row)).toBe(expectedOutline);
  });

  it('the outline is removed after 1600 ms', async () => {
    const messages: ChatMessage[] = [makeMessage('target', 'assistant', 0, 'hi')];
    renderWithBookmarks(messages);
    await act(() => vi.advanceTimersByTimeAsync(0));

    fireEvent.click(screen.getByText('jump'));
    await act(() => vi.advanceTimersByTimeAsync(0));
    const row = document.querySelector('[data-search-row-id="target"]') as HTMLElement;
    expect(outlineOf(row)).toBe(expectedOutline);

    await act(() => vi.advanceTimersByTimeAsync(1600));

    expect(outlineOf(row)).not.toBe(expectedOutline);
  });

  it('a jump request for an unknown message id calls resolveJump(nonce, false)', async () => {
    const messages: ChatMessage[] = [makeMessage('m0', 'assistant', 0, 'hi')];
    renderWithBookmarks(messages);
    await act(() => vi.advanceTimersByTimeAsync(0));

    fireEvent.click(screen.getByText('jump'));
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByTestId('missing')).toHaveTextContent('target');
  });

  it('the same nonce is not handled twice', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const messages: ChatMessage[] = [makeMessage('target', 'assistant', 0, 'hi')];
    const tree = (msgs: ChatMessage[]) => (
      <QueryClientProvider client={client}>
        <ConversationBookmarksProvider conversationName="conv-a">
          <JumpTrigger messageId="target" />
          <MessagesTimeline messages={msgs} workLog={[]} streaming={false} bookmarksEnabled />
        </ConversationBookmarksProvider>
      </QueryClientProvider>
    );
    const { rerender } = render(tree(messages));
    await act(() => vi.advanceTimersByTimeAsync(0));

    fireEvent.click(screen.getByText('jump'));
    await act(() => vi.advanceTimersByTimeAsync(0));
    const row = document.querySelector('[data-search-row-id="target"]') as HTMLElement;
    expect(outlineOf(row)).toBe(expectedOutline);

    await act(() => vi.advanceTimersByTimeAsync(1600));
    expect(outlineOf(row)).not.toBe(expectedOutline);

    // Same provider instance (same jump request/nonce), but a new `messages` array
    // reference forces `rows` — and so the jump effect's deps — to recompute. The
    // handled-nonce guard must still skip it: no re-flash.
    rerender(tree([makeMessage('target', 'assistant', 0, 'hi')]));
    await act(() => vi.advanceTimersByTimeAsync(0));

    const rowAfterRerender = document.querySelector('[data-search-row-id="target"]') as HTMLElement;
    expect(outlineOf(rowAfterRerender)).not.toBe(expectedOutline);
  });

  it('bookmarksEnabled=false ignores jump requests', async () => {
    const messages: ChatMessage[] = [makeMessage('target', 'assistant', 0, 'hi')];
    renderWithBookmarks(messages, { bookmarksEnabled: false });
    await act(() => vi.advanceTimersByTimeAsync(0));

    fireEvent.click(screen.getByText('jump'));
    await act(() => vi.advanceTimersByTimeAsync(0));

    const row = document.querySelector('[data-search-row-id="target"]') as HTMLElement;
    expect(outlineOf(row)).not.toBe(expectedOutline);
    expect(screen.getByTestId('missing')).toHaveTextContent('');
  });
});

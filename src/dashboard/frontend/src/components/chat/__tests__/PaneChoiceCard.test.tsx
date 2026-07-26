/**
 * PAN-3113 — PaneChoiceCard (mockup A decision card + verbatim mirror) and
 * its injection into the MessagesTimeline: a live choice pins to the end, an
 * answered signature swaps the pending card for the emerald answered row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MessagesTimeline } from '../MessagesTimeline';
import { PaneChoiceCard } from '../messagesTimeline/PaneChoiceCard';
import type { PendingPaneChoice } from '../../../lib/paneChoice';

vi.mock('../../../lib/paneChoice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/paneChoice')>();
  return {
    ...actual,
    answerConversationPaneChoice: vi.fn(),
  };
});

vi.mock('../ChatMarkdown', () => ({
  ChatMarkdownSettingsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  ChatMarkdown: ({ text }: { text: string }) => <div data-testid="chat-markdown">{text}</div>,
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

import { answerConversationPaneChoice } from '../../../lib/paneChoice';

const CHOICE: PendingPaneChoice = {
  signature: 'sig-resume-gate',
  title: 'This session is 4h 5m old and 146.9k tokens.',
  contextLines: [
    'This session is 4h 5m old and 146.9k tokens.',
    'Resuming the full session will consume a substantial portion of your usage limits. We recommend resuming from a summary.',
  ],
  options: [
    { number: 1, label: 'Resume from summary', recommended: true },
    { number: 2, label: 'Resume full session as-is', recommended: false },
    { number: 3, label: "Don't ask me again", recommended: false },
  ],
  selectedIndex: 0,
  footerHint: 'Enter to confirm · Esc to cancel',
  confidence: 'high',
};

function renderWithQuery(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PaneChoiceCard — high confidence (mockup A)', () => {
  it('renders title, context, all options, and flags the recommended one', () => {
    renderWithQuery(<PaneChoiceCard choice={CHOICE} conversationName="conv-x" />);
    expect(screen.getByText('This session is 4h 5m old and 146.9k tokens.')).toBeTruthy();
    expect(screen.getByText(/Resuming the full session will consume/)).toBeTruthy();
    expect(screen.getByText('Resume from summary')).toBeTruthy();
    expect(screen.getByText('Resume full session as-is')).toBeTruthy();
    expect(screen.getByText("Don't ask me again")).toBeTruthy();
    expect(screen.getByText('Recommended')).toBeTruthy();
    expect(screen.getByText('Needs you')).toBeTruthy();
  });

  it('sends the selected index + signature and flips to the answered row', async () => {
    vi.mocked(answerConversationPaneChoice).mockResolvedValue({ ok: true, answeredLabel: "Don't ask me again" });
    const onAnswered = vi.fn();
    renderWithQuery(<PaneChoiceCard choice={CHOICE} conversationName="conv-x" onAnswered={onAnswered} />);

    fireEvent.click(screen.getByText("Don't ask me again"));
    fireEvent.click(screen.getByText('Send answer'));

    await waitFor(() => expect(screen.getByText('Answered')).toBeTruthy());
    expect(answerConversationPaneChoice).toHaveBeenCalledWith('conv-x', 2, 'sig-resume-gate');
    expect(onAnswered).toHaveBeenCalledWith('sig-resume-gate', "Don't ask me again");
    expect(screen.queryByText('Send answer')).toBeNull();
  });

  it('shows the server error and stays actionable on refusal', async () => {
    vi.mocked(answerConversationPaneChoice).mockResolvedValue({
      ok: false,
      error: 'The choice menu changed since the card was rendered — refresh and re-answer',
      code: 'menu-changed',
    });
    renderWithQuery(<PaneChoiceCard choice={CHOICE} conversationName="conv-x" />);
    fireEvent.click(screen.getByText('Send answer'));
    await waitFor(() => expect(screen.getByText(/menu changed since the card/)).toBeTruthy());
    expect(screen.getByText('Send answer')).toBeTruthy();
  });
});

describe('PaneChoiceCard — low confidence (verbatim mirror)', () => {
  it('renders the footer hint verbatim and answers on row click', async () => {
    vi.mocked(answerConversationPaneChoice).mockResolvedValue({ ok: true, answeredLabel: 'Resume full session as-is' });
    const mirror = { ...CHOICE, confidence: 'low' as const };
    renderWithQuery(<PaneChoiceCard choice={mirror} conversationName="conv-x" />);

    expect(screen.getByText('Enter to confirm · Esc to cancel')).toBeTruthy();
    expect(screen.queryByText('Send answer')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Resume full session as-is/ }));
    await waitFor(() => expect(answerConversationPaneChoice).toHaveBeenCalledWith('conv-x', 1, 'sig-resume-gate'));
  });
});

describe('MessagesTimeline — pane choice injection', () => {
  const baseProps = {
    messages: [],
    workLog: [],
    streaming: false,
    conversationName: 'conv-x',
  };

  it('appends the pending choice card at the end of the timeline', () => {
    renderWithQuery(<MessagesTimeline {...baseProps} paneChoice={CHOICE} />);
    expect(screen.getByText('Needs you')).toBeTruthy();
    expect(screen.getByText('Resume from summary')).toBeTruthy();
  });

  it('swaps the pending card for the answered row once its signature is answered', () => {
    renderWithQuery(
      <MessagesTimeline
        {...baseProps}
        paneChoice={CHOICE}
        answeredPaneChoices={[{ signature: CHOICE.signature, label: 'Resume from summary', at: new Date().toISOString() }]}
      />,
    );
    expect(screen.queryByText('Needs you')).toBeNull();
    expect(screen.getByText('Answered')).toBeTruthy();
    expect(screen.getByText('Resume from summary')).toBeTruthy();
  });

  it('renders no choice rows when nothing is pending', () => {
    renderWithQuery(<MessagesTimeline {...baseProps} />);
    expect(screen.queryByText('Needs you')).toBeNull();
    expect(screen.queryByText('Answered')).toBeNull();
  });
});

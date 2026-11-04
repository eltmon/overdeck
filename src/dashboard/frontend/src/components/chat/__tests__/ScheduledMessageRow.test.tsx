/** PAN-4641 WI-12: a scheduled message renders as a dimmed bubble with Edit / Cancel / Dismiss. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScheduledMessageRow } from '../messagesTimeline/ScheduledMessageRow';
import { scheduledToChatMessages } from '../scheduledMessages';
import type { ScheduledMessage } from '../chat-types';

vi.mock('../ChatMarkdown', () => ({
  ChatMarkdown: ({ text }: { text: string }) => <div data-testid="md">{text}</div>,
}));

function row(overrides: Partial<ScheduledMessage> = {}): ScheduledMessage {
  const later = new Date(Date.now() + 2 * 60 * 60_000);
  return {
    id: 4,
    conversationName: 'conv-row',
    text: 'continue please',
    status: 'pending',
    notBefore: later.toISOString(),
    resetSource: 'quota-limits',
    limitWindow: 'five_hour',
    attempts: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sentAt: null,
    deliveredAt: null,
    ...overrides,
  };
}

function renderRow(scheduled: ScheduledMessage) {
  const [message] = scheduledToChatMessages([scheduled]);
  return render(<ScheduledMessageRow message={message!} scheduled={scheduled} />);
}

function stubFetch() {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify({ supported: true, limit: null, messages: [] }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function writes(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method)
    .map(([input, init]) => [init?.method, String(input), init?.body ?? null]);
}

describe('ScheduledMessageRow', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the text and the send-time label', () => {
    stubFetch();
    renderRow(row());
    expect(screen.getByText('continue please')).toBeInTheDocument();
    expect(screen.getByText(/Sends at about .* \(when your 5-hour limit resets\)/)).toBeInTheDocument();
  });

  it('Cancel sends DELETE for the row', async () => {
    const fetchMock = stubFetch();
    renderRow(row());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(writes(fetchMock)).toEqual([
      ['DELETE', '/api/conversations/conv-row/scheduled-messages/4', null],
    ]));
  });

  it('Edit then Save sends PATCH with the new text', async () => {
    const fetchMock = stubFetch();
    renderRow(row());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Edit queued message'), { target: { value: 'new text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes(fetchMock)).toEqual([
      ['PATCH', '/api/conversations/conv-row/scheduled-messages/4', JSON.stringify({ message: 'new text' })],
    ]));
    await waitFor(() => expect(screen.queryByLabelText('Edit queued message')).not.toBeInTheDocument());
  });

  it('a failed row shows Dismiss and no Edit', () => {
    stubFetch();
    renderRow(row({ status: 'failed', lastError: 'Session has ended' }));
    expect(screen.getByText(/Not sent: Session has ended/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('a row being sent has no actions', () => {
    stubFetch();
    renderRow(row({ status: 'sending' }));
    expect(screen.getByText(/Sending…/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

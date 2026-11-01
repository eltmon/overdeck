/** PAN-4641 WI-11: scheduled-message labels, timeline mapping and the client hook's requests. */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  scheduledSendLabel,
  scheduledToChatMessages,
  useScheduledMessages,
  type ScheduledMessage,
} from '../scheduledMessages';

const NOW = new Date(2026, 8, 2, 12, 0);

function message(overrides: Partial<ScheduledMessage> = {}): ScheduledMessage {
  return {
    id: 7,
    conversationName: 'conv-a',
    text: 'continue please',
    status: 'pending',
    notBefore: new Date(2026, 8, 2, 17, 0).toISOString(),
    resetSource: 'quota-limits',
    limitWindow: 'five_hour',
    attempts: 0,
    lastError: null,
    createdAt: new Date(2026, 8, 2, 11, 0).toISOString(),
    updatedAt: new Date(2026, 8, 2, 11, 0).toISOString(),
    sentAt: null,
    deliveredAt: null,
    ...overrides,
  };
}

describe('scheduledSendLabel', () => {
  it('names the 5-hour and weekly windows', () => {
    expect(scheduledSendLabel(message(), NOW)).toBe('Sends at about 17:00 (when your 5-hour limit resets)');
    expect(scheduledSendLabel(message({ limitWindow: 'seven_day' }), NOW)).toBe('Sends at about 17:00 (when your weekly limit resets)');
    expect(scheduledSendLabel(message({ limitWindow: null, resetSource: 'message-text' }), NOW))
      .toBe('Sends at about 17:00 (when your usage limit resets)');
  });

  it('prefixes a weekday when the send time is not today', () => {
    const tomorrow = new Date(2026, 8, 3, 9, 30);
    const weekday = tomorrow.toLocaleDateString([], { weekday: 'short' });
    expect(scheduledSendLabel(message({ notBefore: tomorrow.toISOString() }), NOW))
      .toBe(`Sends at about ${weekday} 09:30 (when your 5-hour limit resets)`);
  });

  it('covers the fallback, no-limit, sending, failed and unknown wordings', () => {
    expect(scheduledSendLabel(message({ resetSource: 'fallback', notBefore: new Date(2026, 8, 2, 12, 15).toISOString() }), NOW))
      .toBe('Tries again at about 12:15 (reset time unknown)');
    expect(scheduledSendLabel(message({ resetSource: null, limitWindow: null }), NOW)).toBe('Sends within a minute');
    expect(scheduledSendLabel(message({ status: 'sending' }), NOW)).toBe('Sending…');
    expect(scheduledSendLabel(message({ status: 'failed', lastError: 'Session has ended' }), NOW)).toBe('Not sent: Session has ended');
    expect(scheduledSendLabel(message({ status: 'unknown' }), NOW)).toBe('Delivery not confirmed');
  });
});

describe('scheduledToChatMessages', () => {
  it('maps rows to scheduled user bubbles', () => {
    const row = message();
    expect(scheduledToChatMessages([row])).toEqual([{
      id: 'scheduled-7',
      role: 'user',
      text: 'continue please',
      createdAt: row.createdAt,
      deliveryState: 'scheduled',
      scheduled: row,
    }]);
  });
});

describe('useScheduledMessages', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(snapshot: unknown) {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(snapshot), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('makes no request when disabled', () => {
    const fetchMock = stubFetch({ supported: true, limit: null, messages: [] });
    const { result } = renderHook(() => useScheduledMessages('conv-disabled', false));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.supported).toBe(false);
  });

  it('loads the queue and sends each mutation to its route', async () => {
    const fetchMock = stubFetch({ supported: true, limit: null, messages: [message()] });
    const { result, unmount } = renderHook(() => useScheduledMessages('conv a', true));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.supported).toBe(true);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/conversations/conv%20a/scheduled-messages');

    await act(async () => { await result.current.schedule('hello'); });
    await act(async () => { await result.current.edit(7, 'edited'); });
    await act(async () => { await result.current.cancel(7); });

    const writes = fetchMock.mock.calls
      .filter(([, init]) => init?.method)
      .map(([input, init]) => [init?.method, String(input), init?.body ?? null]);
    expect(writes).toEqual([
      ['POST', '/api/conversations/conv%20a/scheduled-messages', JSON.stringify({ message: 'hello' })],
      ['PATCH', '/api/conversations/conv%20a/scheduled-messages/7', JSON.stringify({ message: 'edited' })],
      ['DELETE', '/api/conversations/conv%20a/scheduled-messages/7', null],
    ]);
    unmount();
  });

  it('throws the server error from a refused mutation', async () => {
    const fetchMock = stubFetch({ supported: true, limit: null, messages: [] });
    const { result, unmount } = renderHook(() => useScheduledMessages('conv-refused', true));
    fetchMock.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ error: '/pan commands cannot be scheduled', code: 'command-not-schedulable' }), { status: 422 }));
    await expect(result.current.schedule('/pan status')).rejects.toThrow('/pan commands cannot be scheduled');
    unmount();
  });

  it('answers the empty snapshot when the request fails', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const { result, unmount } = renderHook(() => useScheduledMessages('conv-broken', true));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current).toMatchObject({ supported: false, limit: null, messages: [] });
    unmount();
  });
});

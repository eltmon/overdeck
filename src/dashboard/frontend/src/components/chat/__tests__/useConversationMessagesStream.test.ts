import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationEvent } from '../chat-types';

const transportMock = vi.hoisted(() => ({
  listeners: [] as Array<(event: ConversationEvent) => void>,
}));

vi.mock('../../../lib/wsTransport', () => ({
  getTransport: () => ({
    subscribe: (_createStream: unknown, listener: (event: ConversationEvent) => void) => {
      transportMock.listeners.push(listener);
      return vi.fn();
    },
  }),
}));

import {
  applyConversationMessagesEvent,
  shouldStreamConversationMessages,
  useConversationMessagesStream,
} from '../useConversationMessagesStream';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  transportMock.listeners.length = 0;
});

describe('useConversationMessagesStream', () => {
  const conversation = {
    id: 1,
    name: 'conv-one',
    sessionAlive: true,
    harness: 'claude-code' as const,
  };

  it('reports no first payload before the stream emits an event', () => {
    const { result } = renderHook(
      () => useConversationMessagesStream(conversation),
      { wrapper: createWrapper() },
    );

    expect(result.current).toEqual({ enabled: true, receivedFirstPayload: false });
  });

  it('reports the first payload after the stream emits an event', () => {
    const { result } = renderHook(
      () => useConversationMessagesStream(conversation),
      { wrapper: createWrapper() },
    );

    act(() => {
      transportMock.listeners[0]!({ kind: 'discovering' });
    });

    expect(result.current.receivedFirstPayload).toBe(true);
  });

  it('does not expose the prior first-payload signal when the conversation changes', () => {
    const { result, rerender } = renderHook(
      ({ name }) => useConversationMessagesStream({ ...conversation, name }),
      { initialProps: { name: 'conv-one' }, wrapper: createWrapper() },
    );

    act(() => {
      transportMock.listeners[0]!({ kind: 'discovering' });
    });
    expect(result.current.receivedFirstPayload).toBe(true);

    rerender({ name: 'conv-two' });

    expect(result.current.receivedFirstPayload).toBe(false);

    act(() => {
      transportMock.listeners[0]!({ kind: 'discovering' });
    });

    expect(result.current.receivedFirstPayload).toBe(false);
  });
});

describe('applyConversationMessagesEvent', () => {
  it('replaces cache contents for full snapshots', () => {
    const cache = applyConversationMessagesEvent(
      {
        messages: [{ id: 'old', role: 'user', text: 'old', createdAt: '2026-06-08T00:00:00.000Z' }],
        workLog: [],
        streaming: true,
        discovering: true,
      },
      {
        kind: 'messages',
        snapshot: true,
        messages: [{ id: 'new', role: 'user', text: 'new', createdAt: '2026-06-08T00:00:01.000Z' }],
        workLog: [],
        streaming: false,
      },
    );

    expect(cache.messages.map((message) => message.id)).toEqual(['new']);
    expect(cache.discovering).toBe(false);
  });

  it('merges incremental deltas without dropping prior transcript history', () => {
    const cache = applyConversationMessagesEvent(
      {
        messages: [
          { id: 'm1', role: 'user', text: 'hello', createdAt: '2026-06-08T00:00:00.000Z' },
          { id: 'm2', role: 'assistant', text: 'working', createdAt: '2026-06-08T00:00:01.000Z', streaming: true },
        ],
        workLog: [
          { id: 'w1', createdAt: '2026-06-08T00:00:02.000Z', label: 'Bash', tone: 'tool' },
        ],
        streaming: true,
      },
      {
        kind: 'messages',
        snapshot: false,
        messages: [
          { id: 'm2', role: 'assistant', text: 'done', createdAt: '2026-06-08T00:00:01.000Z', completedAt: '2026-06-08T00:00:03.000Z' },
          { id: 'm3', role: 'user', text: 'next', createdAt: '2026-06-08T00:00:04.000Z' },
        ],
        workLog: [
          { id: 'w1', createdAt: '2026-06-08T00:00:02.000Z', label: 'Bash', tone: 'tool', result: 'ok' },
        ],
        streaming: false,
      },
    );

    expect(cache.messages.map((message) => [message.id, message.text])).toEqual([
      ['m1', 'hello'],
      ['m2', 'done'],
      ['m3', 'next'],
    ]);
    expect(cache.workLog).toEqual([
      { id: 'w1', createdAt: '2026-06-08T00:00:02.000Z', label: 'Bash', tone: 'tool', result: 'ok' },
    ]);
  });

  it('clears stale context usage when the stream reports null', () => {
    const cache = applyConversationMessagesEvent(
      {
        messages: [],
        workLog: [],
        streaming: true,
        contextUsage: {
          activeBytes: 100,
          estimatedTokens: 25,
          contextWindow: 200000,
          percentUsed: 1,
        },
      },
      {
        kind: 'messages',
        snapshot: false,
        messages: [],
        workLog: [],
        streaming: true,
        contextUsage: null,
      },
    );

    expect(cache.contextUsage).toBeNull();
  });
});

describe('shouldStreamConversationMessages', () => {
  it('streams live Claude Code conversations and legacy null-harness conversations', () => {
    expect(shouldStreamConversationMessages({ id: 1, sessionAlive: true, harness: 'claude-code' })).toBe(true);
    expect(shouldStreamConversationMessages({ id: 1, sessionAlive: true, harness: null })).toBe(true);
    expect(shouldStreamConversationMessages({ id: 1, sessionAlive: true, harness: 'ohmypi' })).toBe(true);
    expect(shouldStreamConversationMessages({ id: 1, sessionAlive: true, harness: 'ohmypi' })).toBe(true);
    expect(shouldStreamConversationMessages({ id: 1, sessionAlive: true, harness: 'codex' })).toBe(true);
    expect(shouldStreamConversationMessages({ id: -1, sessionAlive: true, harness: 'claude-code' })).toBe(false);
  });

  it('streams a freshly-created real conversation that is still spawning (sessionAlive:false, not ended)', () => {
    // The reload bug: a new conversation reports sessionAlive:false until its
    // background spawn finishes. It must still stream so the feed self-populates
    // the instant the runtime writes — without a page reload.
    expect(shouldStreamConversationMessages({ id: 1, sessionAlive: false, harness: 'claude-code' })).toBe(true);
    expect(shouldStreamConversationMessages({ id: 1, sessionAlive: false, harness: null })).toBe(true);
  });

  it('does NOT stream an ended conversation — historical view uses the one-shot HTTP path', () => {
    expect(shouldStreamConversationMessages({ id: 1, sessionAlive: false, harness: 'claude-code', endedAt: '2026-06-23T00:00:00.000Z' })).toBe(false);
    expect(shouldStreamConversationMessages({ id: 1, sessionAlive: true, harness: 'claude-code', endedAt: '2026-06-23T00:00:00.000Z' })).toBe(false);
  });

  it('still gates synthetic agent sessions (id < 0) on a live session', () => {
    expect(shouldStreamConversationMessages({ id: -1, name: 'agent-pan-1', sessionAlive: false, harness: 'ohmypi' })).toBe(false);
    expect(shouldStreamConversationMessages({ id: -1, name: 'agent-pan-1', sessionAlive: true, harness: 'ohmypi' })).toBe(true);
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WS_METHODS } from '@overdeck/contracts';
import type { ConversationEvent } from '../chat-types';

const transportMock = vi.hoisted(() => ({
  listeners: [] as Array<(event: ConversationEvent) => void>,
  factories: [] as Array<(client: unknown) => unknown>,
}));

vi.mock('../../../lib/wsTransport', () => ({
  getTransport: () => ({
    subscribe: (createStream: (client: unknown) => unknown, listener: (event: ConversationEvent) => void) => {
      transportMock.factories.push(createStream);
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
  transportMock.factories.length = 0;
});

/** Runs a recorded subscribe factory, as the transport does on every (re)connect, and returns its payload. */
function subscribePayload(index: number): Record<string, unknown> {
  let payload: Record<string, unknown> = {};
  transportMock.factories[index]!({
    [WS_METHODS.subscribeConversationMessages]: (input: Record<string, unknown>) => { payload = input; return null; },
  });
  return payload;
}

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

describe('full parser delta no-loss audit', () => {
  it('retains all history and tool fields while applying metadata-only updates and plan removal', () => {
    const initial = applyConversationMessagesEvent(undefined, {
      kind: 'messages', snapshot: true, metadataSnapshot: true, streaming: true, totalCost: 1,
      messages: [{ id: 'user', role: 'user', text: 'Original prompt', createdAt: '2026-09-09' }],
      workLog: [{ id: 'tool', label: 'Shell', tone: 'error', createdAt: '2026-09-09', command: 'pwd', result: 'Full error output' }],
      proposedPlan: { id: 'plan', plan: 'Do the work', status: 'pending', createdAt: '2026-09-09' },
      compactBoundaries: [{ id: 'compact', timestamp: '2026-09-09', trigger: 'auto' }],
      contextUsage: { activeBytes: 100, estimatedTokens: 25, contextWindow: 1000, percentUsed: 2.5 },
    });
    const updated = applyConversationMessagesEvent(initial, {
      kind: 'messages', snapshot: false, metadataSnapshot: true, streaming: false, totalCost: 2,
      messages: [], workLog: [], compactBoundaries: [], contextUsage: null,
    });
    expect(updated.messages).toEqual(initial.messages);
    expect(updated.workLog).toEqual(initial.workLog);
    expect(updated).toMatchObject({ totalCost: 2, streaming: false, contextUsage: null, compactBoundaries: [] });
    expect(updated.proposedPlan).toBeUndefined();
  });

  it('replaces history only when a smaller snapshot carries a confirmed reset', () => {
    const initial = { messages: [{ id: 'old', role: 'user' as const, text: 'Old', createdAt: '2026-09-09' }],
      workLog: [{ id: 'tool', label: 'Shell', tone: 'tool' as const, createdAt: '2026-09-09' }], streaming: false };
    const snapshot = { kind: 'messages' as const, snapshot: true, streaming: false, messages: [], workLog: [] };
    expect(applyConversationMessagesEvent(initial, snapshot).messages).toEqual(initial.messages);
    expect(applyConversationMessagesEvent(initial, { ...snapshot, reset: true }))
      .toMatchObject({ messages: [], workLog: [] });
  });
});

describe('windowed history (PAN-4558)', () => {
  const at = (i: number) => new Date(Date.UTC(2026, 9, 19) + i * 1000).toISOString();
  const message = (i: number) => ({ id: `m${i}`, role: 'user' as const, text: `m${i}`, createdAt: at(i), sequence: i });
  const cursor = (i: number) => JSON.stringify([at(i), i, 0, `m${i}`]);

  it('keeps paged-in older rows when a windowed snapshot arrives', () => {
    const previous = {
      messages: [message(0), message(1), message(2), message(3)],
      workLog: [],
      streaming: false,
      history: { cursor: cursor(0), hasOlder: true, transcript: '1:2' },
    };
    const next = applyConversationMessagesEvent(previous, {
      kind: 'messages', messages: [message(2), message(3), message(4)], workLog: [], streaming: true, snapshot: true,
      window: { cursor: cursor(2), hasOlder: true, transcript: '1:2' },
    });
    expect(next.messages.map((m) => m.id)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
    expect(next.history).toEqual({ cursor: cursor(0), hasOlder: true, transcript: '1:2' });
    expect(next.streaming).toBe(true);
  });

  it('sends no resume on the first subscribe and the cache state on a resubscribe', () => {
    renderHook(
      () => useConversationMessagesStream({ id: 1, name: 'conv-resume', sessionAlive: true, harness: 'claude-code' }),
      { wrapper: createWrapper() },
    );
    expect(subscribePayload(0)).toEqual({ conversationName: 'conv-resume' });

    act(() => {
      transportMock.listeners[0]!({
        kind: 'messages', messages: [message(0), { ...message(1), role: 'assistant' }], workLog: [], streaming: true, snapshot: true,
        window: { cursor: cursor(0), hasOlder: false, transcript: '1:2' },
      });
    });
    expect(subscribePayload(0)).toEqual({
      conversationName: 'conv-resume',
      resume: { afterSequence: 1, openIds: ['m1'], transcript: '1:2' },
    });
  });
});


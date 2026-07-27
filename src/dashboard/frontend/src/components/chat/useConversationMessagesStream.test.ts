import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Stream } from 'effect';
import { WS_METHODS } from '@overdeck/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const transportMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));
const fetchMocks = vi.hoisted(() => ({ fetchWithTimeout: vi.fn() }));

vi.mock('../../lib/wsTransport', () => ({
  getTransport: () => ({ subscribe: transportMocks.subscribe }),
}));
vi.mock('../../lib/apiFetch', () => ({
  fetchWithTimeout: fetchMocks.fetchWithTimeout,
}));

import {
  applyConversationMessagesEvent,
  conversationMessagesQueryKey,
  shouldStreamConversationMessages,
  subagentTranscriptQueryKey,
  useSubagentTranscript,
  type ConversationMessagesCache,
} from './useConversationMessagesStream';
import type { ConversationEvent, SubagentSummary } from './chat-types';

type GateArg = Parameters<typeof shouldStreamConversationMessages>[0];
const base = (over: Partial<GateArg>): GateArg => ({ name: 'conv-x', harness: 'claude-code', sessionAlive: true, id: 1, ...over });

const parentCache: ConversationMessagesCache = {
  messages: [{ id: 'parent-message', role: 'user', text: 'Parent', createdAt: '2026-01-01T00:00:00Z' }],
  workLog: [{ id: 'parent-tool', label: 'Read', createdAt: '2026-01-01T00:00:01Z', tone: 'tool' }],
  streaming: true,
};

const subagents: SubagentSummary[] = [{
  agentId: 'sub-1',
  agentType: 'Explore',
  description: 'Trace the stream',
  toolUseId: 'toolu_sub_1',
  spawnDepth: 1,
  status: 'running',
}];

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe('shouldStreamConversationMessages (PAN-1908 agent streaming)', () => {
  it('streams a real claude-code DB conversation (unchanged)', () => {
    expect(shouldStreamConversationMessages(base({ id: 42, harness: 'claude-code' }))).toBe(true);
    expect(shouldStreamConversationMessages(base({ id: 42, harness: null }))).toBe(true);
  });

  it('streams real ohmypi/codex DB conversations via full JSONL snapshots', () => {
    expect(shouldStreamConversationMessages(base({ id: 42, harness: 'ohmypi' }))).toBe(true);
    expect(shouldStreamConversationMessages(base({ id: 42, harness: 'codex' }))).toBe(true);
  });

  it('streams a synthetic ohmypi work-agent session', () => {
    expect(shouldStreamConversationMessages(base({ id: -1, name: 'agent-pan-1908', harness: 'ohmypi' }))).toBe(true);
  });

  it('streams a synthetic codex agent session', () => {
    expect(shouldStreamConversationMessages(base({ id: -1, name: 'agent-pan-2', harness: 'codex' }))).toBe(true);
  });

  it('does NOT stream a synthetic claude agent session (stays on poll)', () => {
    expect(shouldStreamConversationMessages(base({ id: -1, name: 'agent-pan-3', harness: 'claude-code' }))).toBe(false);
    expect(shouldStreamConversationMessages(base({ id: -1, name: 'agent-pan-3', harness: null }))).toBe(false);
  });

  it('streams planning/specialist ohmypi sessions too', () => {
    expect(shouldStreamConversationMessages(base({ id: -1, name: 'planning-pan-1908', harness: 'ohmypi' }))).toBe(true);
    expect(shouldStreamConversationMessages(base({ id: -1, name: 'specialist-x-merge', harness: 'codex' }))).toBe(true);
  });

  it('does not stream a non-agent synthetic name', () => {
    expect(shouldStreamConversationMessages(base({ id: -1, name: 'draft-123', harness: 'ohmypi' }))).toBe(false);
  });

  it('never streams a dead session', () => {
    expect(shouldStreamConversationMessages(base({ id: -1, name: 'agent-pan-1908', harness: 'ohmypi', sessionAlive: false }))).toBe(false);
    expect(shouldStreamConversationMessages(base({ id: 42, harness: 'claude-code', endedAt: '2026-01-01T00:00:00Z' }))).toBe(false);
  });
});

describe('subagent message cache', () => {
  it('replaces the subagent list without changing parent messages or work log', () => {
    const next = applyConversationMessagesEvent(parentCache, { kind: 'subagents', subagents });

    expect(next.subagents).toEqual(subagents);
    expect(next.messages).toBe(parentCache.messages);
    expect(next.workLog).toBe(parentCache.workLog);
  });

  it('preserves subagents when applying a messages event', () => {
    const previous = { ...parentCache, subagents };
    const event: ConversationEvent = {
      kind: 'messages',
      messages: [],
      workLog: [],
      streaming: false,
      snapshot: false,
    };

    expect(applyConversationMessagesEvent(previous, event).subagents).toEqual(subagents);
  });
});

describe('useSubagentTranscript', () => {
  let listener: ((event: ConversationEvent) => void) | undefined;

  beforeEach(() => {
    listener = undefined;
    transportMocks.rpc.mockReset().mockReturnValue(Stream.empty);
    transportMocks.unsubscribe.mockReset();
    transportMocks.subscribe.mockReset().mockImplementation((connect, onEvent) => {
      connect({ [WS_METHODS.subscribeConversationMessages]: transportMocks.rpc });
      listener = onEvent;
      return transportMocks.unsubscribe;
    });
    fetchMocks.fetchWithTimeout.mockReset();
  });

  it('uses an isolated query key and unsubscribes when the subagent is deselected', () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(conversationMessagesQueryKey('conv-x'), parentCache);
    const { rerender } = renderHook(
      ({ agentId }: { agentId: string | null }) => useSubagentTranscript(base({}), agentId),
      { initialProps: { agentId: 'sub-1' }, wrapper: wrapper(queryClient) },
    );

    expect(transportMocks.rpc).toHaveBeenCalledWith({ conversationName: 'conv-x', agentId: 'sub-1' });
    act(() => listener?.({
      kind: 'messages',
      messages: [{ id: 'sub-message', role: 'assistant', text: 'Subagent', createdAt: '2026-01-01T00:00:02Z' }],
      workLog: [],
      streaming: true,
      snapshot: true,
    }));

    expect(queryClient.getQueryData(subagentTranscriptQueryKey('conv-x', 'sub-1'))).toMatchObject({
      messages: [{ id: 'sub-message' }],
    });
    expect(queryClient.getQueryData(conversationMessagesQueryKey('conv-x'))).toEqual(parentCache);

    rerender({ agentId: null });
    expect(transportMocks.unsubscribe).toHaveBeenCalledOnce();
  });

  it('fetches an ended subagent transcript once over HTTP', async () => {
    fetchMocks.fetchWithTimeout.mockResolvedValue(new Response(JSON.stringify({
      messages: [{ id: 'ended', role: 'assistant', text: 'Done', createdAt: '2026-01-01T00:00:00Z' }],
      workLog: [],
      streaming: false,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const queryClient = createQueryClient();
    const { result } = renderHook(
      () => useSubagentTranscript(base({ endedAt: '2026-01-01T00:00:00Z' }), 'sub-1'),
      { wrapper: wrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.data?.messages[0]?.text).toBe('Done'));
    expect(fetchMocks.fetchWithTimeout).toHaveBeenCalledWith(
      '/api/conversations/conv-x/messages?agentId=sub-1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(transportMocks.subscribe).not.toHaveBeenCalled();
  });
});

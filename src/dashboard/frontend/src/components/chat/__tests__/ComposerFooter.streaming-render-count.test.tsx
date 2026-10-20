/**
 * PAN-4560 FR-9: a streamed delta for the open conversation re-renders the
 * timeline but not the composer toolbar.
 *
 * Mounts the real ConversationPanel and the real (memoized) ComposerFooter.
 * Composer renders are counted through `useHandoffNotice`, which the footer
 * calls on every render, so a memo bail-out counts as zero.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConversationPanel } from '../ConversationPanel';
import type { ConversationMessagesCache } from '../useConversationMessagesStream';
import { useStableComposerProps } from '../useStableComposerProps';

const counts = vi.hoisted(() => ({ composer: 0 }));

vi.mock('../continueOnDevice/handoffNoticeStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../continueOnDevice/handoffNoticeStore')>();
  return {
    ...actual,
    useHandoffNotice: (...args: Parameters<typeof actual.useHandoffNotice>) => {
      counts.composer += 1;
      return actual.useHandoffNotice(...args);
    },
  };
});

const streamSnapshot = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('../../../lib/wsTransport', () => ({
  getTransport: () => ({
    request: () => new Promise(() => {}),
    subscribe: (createStream: (client: unknown) => unknown, listener: (event: unknown) => void) => {
      createStream(new Proxy({}, { get: () => () => ({}) }));
      if (streamSnapshot.current) listener(streamSnapshot.current);
      return () => {};
    },
  }),
  dashboardMutationJsonHeaders: () => ({}),
}));
vi.mock('../../DialogProvider', () => ({
  DialogProvider: ({ children }: { children: React.ReactNode }) => children,
  useConfirm: () => vi.fn().mockResolvedValue(true),
  useAlert: () => vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../MessagesTimeline', () => ({
  MessagesTimeline: ({ messages }: { messages: Array<{ id: string; text: string }> }) => (
    <div data-testid="timeline">{messages.map((message) => message.text).join(' | ')}</div>
  ),
}));
vi.mock('../../XTerminal', () => ({ XTerminal: () => <div /> }));
vi.mock('../../DiffWorkerPoolProvider', () => ({
  DiffWorkerPoolProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../DiffPanel', () => ({ DiffPanel: () => <div /> }));
vi.mock('../../CommandDeck/ConversationList', () => ({ updateConversationTitle: vi.fn() }));
vi.mock('../../CommandDeck/styles/command-deck.module.css', () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));
// The composer's own heavy children, stubbed as ComposerFooter.test.tsx does.
vi.mock('../ComposerPromptEditor', () => ({
  loadDraft: () => '',
  ComposerPromptEditor: () => <textarea aria-label="Composer editor" />,
}));
vi.mock('../ModelPicker', () => ({
  ModelPicker: () => <div />,
  MODEL_EFFORT_SUPPORT: {},
  loadStoredHarness: () => 'claude-code',
  loadStoredModel: () => 'claude-sonnet-4-6',
  saveStoredHarness: vi.fn(),
  saveStoredModel: vi.fn(),
  onKnownModelsSync: () => () => {},
}));
vi.mock('../defaultConversationModel', () => ({ getDefaultConversationModel: () => 'claude-sonnet-4-6' }));
vi.mock('../EffortPicker', () => ({ EffortPicker: () => <div />, loadStoredEffort: () => 'medium' }));
vi.mock('../VoiceWidget', () => ({ VoiceWidget: () => <div /> }));
vi.mock('../../Settings/modelCatalog', () => ({
  modelSupportsImages: () => true,
  findModelDef: () => ({ name: 'Claude Sonnet 4.6' }),
}));

const conversation: React.ComponentProps<typeof ConversationPanel>['conversation'] = {
  id: 1,
  name: 'test-conv',
  tmuxSession: 'conv-test-conv',
  status: 'active' as const,
  cwd: '/tmp/project',
  issueId: null,
  createdAt: '2026-10-19T00:00:00Z',
  endedAt: null,
  lastAttachedAt: null,
  sessionAlive: true,
  title: 'Streaming conversation',
  model: 'claude-sonnet-4-6',
  effort: 'medium',
};

const seed: ConversationMessagesCache = {
  messages: [
    { id: 'm-1', role: 'user', text: 'Profile the dashboard', createdAt: '2026-10-19T00:00:00Z' },
    { id: 'm-2', role: 'assistant', text: 'Measuring', createdAt: '2026-10-19T00:00:01Z', streaming: true },
  ],
  workLog: [],
  streaming: true,
  contextUsage: { activeBytes: 4000, estimatedTokens: 1000, contextWindow: 200000, percentUsed: 0.5 },
};

beforeEach(() => {
  counts.composer = 0;
  streamSnapshot.current = { kind: 'messages', snapshot: true, ...seed };
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/conversations/pending-input')) return Response.json([]);
    if (/\/bookmarks$/.test(url)) return Response.json({ bookmarks: [] });
    if (/\/diffs$/.test(url)) return Response.json({ summaries: [] });
    if (url.includes('/api/dashboard/session')) return Response.json({ csrfToken: 'test-csrf-token' });
    return Response.json({});
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ComposerFooter under a streamed delta', () => {
  it('re-renders the timeline but not the composer', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(['conversation-messages', 'test-conv'], seed);
    render(
      <QueryClientProvider client={client}>
        <ConversationPanel conversation={conversation} viewMode="conversation" onArchived={() => {}} />
      </QueryClientProvider>,
    );
    await screen.findByLabelText('Composer editor');
    await vi.waitFor(() => expect(client.isFetching()).toBe(0));
    const composerRendersBefore = counts.composer;
    expect(composerRendersBefore).toBeGreaterThan(0);

    // TanStack Query batches observer notifications, so flush them inside an async act.
    await act(async () => {
      client.setQueryData<ConversationMessagesCache>(['conversation-messages', 'test-conv'], (prev) => {
        if (!prev) return prev;
        const last = prev.messages[prev.messages.length - 1]!;
        return { ...prev, messages: [...prev.messages.slice(0, -1), { ...last, text: `${last.text} the render counts` }] };
      });
    });

    await vi.waitFor(() => expect(screen.getByTestId('timeline')).toHaveTextContent('Measuring the render counts'));
    expect(counts.composer).toBe(composerRendersBefore);
  });
});

describe('useStableComposerProps', () => {
  it('keeps onSend stable across deltas and sends with the latest messages', () => {
    const addOptimistic = vi.fn();
    const { result, rerender } = renderHook(
      ({ messages }: { messages: ConversationMessagesCache['messages'] }) =>
        useStableComposerProps({ conversation, data: seed, serverMessages: messages, addOptimistic }),
      { initialProps: { messages: seed.messages } },
    );
    const firstOnSend = result.current.onSend;
    const firstUsage = result.current.contextWindowUsage;

    const grown = [...seed.messages, { id: 'm-3', role: 'assistant' as const, text: 'More', createdAt: '2026-10-19T00:00:02Z' }];
    rerender({ messages: seed.messages.map((m) => ({ ...m })) });
    rerender({ messages: grown });

    expect(result.current.onSend).toBe(firstOnSend);
    expect(result.current.contextWindowUsage).toBe(firstUsage);
    result.current.onSend('hello', 'client-1');
    expect(addOptimistic).toHaveBeenCalledWith('test-conv', 'hello', 3, {
      clientMessageId: 'client-1',
      echoBaselineIds: ['m-1', 'm-2', 'm-3'],
    });
  });
});

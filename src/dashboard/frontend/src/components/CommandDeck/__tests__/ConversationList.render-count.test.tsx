/**
 * PAN-4560 FR-10: a conversation-list poll in which only conversation B
 * changed re-renders only B's row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConversationList, type Conversation } from '../ConversationList';

const rowRenders = vi.hoisted(() => new Map<string, number>());

vi.mock('../ConversationRow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ConversationRow')>();
  return {
    ...actual,
    ConversationRow: (props: React.ComponentProps<typeof actual.ConversationRow>) => {
      rowRenders.set(props.conv.name, (rowRenders.get(props.conv.name) ?? 0) + 1);
      return <actual.ConversationRow {...props} />;
    },
  };
});
vi.mock('../../DialogProvider', () => ({
  DialogProvider: ({ children }: { children: React.ReactNode }) => children,
  useConfirm: () => vi.fn().mockResolvedValue(true),
  useAlert: () => vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../styles/command-deck.module.css', () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

function conversation(id: number, name: string): Conversation {
  return {
    id,
    name,
    tmuxSession: `conv-${name}`,
    status: 'active',
    cwd: '/tmp/project',
    issueId: null,
    createdAt: `2026-10-19T00:00:0${id}Z`,
    endedAt: null,
    lastAttachedAt: null,
    sessionAlive: true,
    isWorking: false,
    title: `Conversation ${name}`,
  } as Conversation;
}

beforeEach(() => {
  rowRenders.clear();
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ConversationList poll isolation', () => {
  it('re-renders only the changed conversation row', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(['conversations'], [conversation(1, 'A'), conversation(2, 'B'), conversation(3, 'C')]);
    client.setQueryData(['registered-projects'], []);
    const onSelectConversation = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <ConversationList selectedConversation="A" onSelectConversation={onSelectConversation} />
      </QueryClientProvider>,
    );
    await screen.findByText('Conversation C');
    const before = Object.fromEntries(rowRenders);

    // TanStack Query batches observer notifications, so flush them inside an async act.
    await act(async () => {
      client.setQueryData<Conversation[]>(['conversations'], (prev) =>
        prev?.map((c) => (c.name === 'B' ? { ...c, isWorking: !c.isWorking } : c)));
    });

    await vi.waitFor(() => expect(rowRenders.get('B')).toBeGreaterThan(before.B ?? 0));
    expect(rowRenders.get('A')).toBe(before.A);
    expect(rowRenders.get('C')).toBe(before.C);
  });
});

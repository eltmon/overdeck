import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { useOpenConversation, useOpenConversationBeside } from '../useOpenConversation';
import { flushPanesPersistence, usePanesStore } from '../../../../lib/panesStore';
import { resetDeckLayoutStore, selectDeckLayout, useDeckLayoutStore } from '../../../../lib/deckLayoutStore';
import { collectLeafIds } from '../../../../lib/paneLayout';
import { TestDeckNavigationProvider, type DeckNavigationCall } from '../deckNavigation';
import { useCommandDeckSelection } from '../../../../lib/commandDeckSelection';
import { NO_PROJECT_KEY } from '../../../CommandDeck/projectsData';
import type { Conversation } from '../../../CommandDeck/ConversationList';

const listedConversation: Conversation = {
  id: 42,
  name: 'existing-conv',
  tmuxSession: 'conv-existing-conv',
  status: 'active',
  cwd: '/x',
  issueId: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  endedAt: null,
  lastAttachedAt: null,
  sessionAlive: false,
};

const dfaiConversation: Conversation = { ...listedConversation, id: 51, name: 'dfai-conv', tmuxSession: 'conv-dfai-conv', cwd: '/dfai', title: 'DFAI work' };
const otherConversation: Conversation = { ...listedConversation, id: 52, name: 'other-conv', tmuxSession: 'conv-other-conv', title: 'Other work' };

const resolveConversationProjectName = vi.fn((conv: Conversation | null | undefined) => (conv ? (conv.cwd === '/dfai' ? 'dfai' : 'proj') : null));

vi.mock('../useProjectScope', () => ({
  useProjectScope: () => ({
    conversations: [listedConversation, dfaiConversation, otherConversation],
    resolveConversationProjectName,
  }),
}));

let calls: DeckNavigationCall[];

beforeEach(() => {
  calls = [];
  resolveConversationProjectName.mockClear();
  useCommandDeckSelection.setState({ selectedConversation: null, selectedFeature: null });
  flushPanesPersistence();
  localStorage.clear();
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} });
  resetDeckLayoutStore();
});

function wrapper({ children }: { children: ReactNode }) {
  return <TestDeckNavigationProvider calls={calls}>{children}</TestDeckNavigationProvider>;
}

describe('useOpenConversation (PAN-5339 opener-door)', () => {
  it('opens an unlisted Conversation object by resolving its own project', () => {
    const { result } = renderHook(() => useOpenConversation(null), { wrapper });
    const unlisted: Conversation = {
      id: 3904,
      name: '20261113-6031',
      tmuxSession: 'conv-20261113-6031',
      status: 'ended',
      cwd: '/y',
      issueId: null,
      createdAt: '2026-11-13T00:00:00.000Z',
      endedAt: '2026-11-13T01:00:00.000Z',
      lastAttachedAt: null,
      sessionAlive: false,
    };

    result.current(unlisted);

    expect(calls).toEqual([{ method: 'openInDeck', target: { projectKey: 'proj', conversationRouteKey: '3904' } }]);
    expect(resolveConversationProjectName).toHaveBeenCalledWith(unlisted);
    expect(useCommandDeckSelection.getState().selectedConversation).toBe('20261113-6031');
  });

  it('still opens a listed string name as before', () => {
    const { result } = renderHook(() => useOpenConversation('proj'), { wrapper });

    result.current('existing-conv');

    expect(calls).toEqual([{ method: 'openInDeck', target: { projectKey: 'proj', conversationRouteKey: '42' } }]);
  });

  it('an unlisted string name falls back to selecting its project bucket', () => {
    const { result } = renderHook(() => useOpenConversation(null), { wrapper });

    result.current('not-in-the-list');

    expect(calls).toEqual([{ method: 'selectProject', projectName: NO_PROJECT_KEY, opts: { updateUrl: false } }]);
    expect(useCommandDeckSelection.getState().selectedConversation).toBe('not-in-the-list');
  });

  it('null clears the selection without opening anything', () => {
    useCommandDeckSelection.setState({ selectedConversation: 'existing-conv', selectedFeature: null });
    const { result } = renderHook(() => useOpenConversation(null), { wrapper });

    result.current(null);

    expect(calls).toEqual([]);
    expect(useCommandDeckSelection.getState().selectedConversation).toBeNull();
  });
});

describe('All projects deck routing (PAN-5343 H-D5/H-D6)', () => {
  const ALL = '__all-projects__';

  it('a plain open in the All deck stays in the All deck', () => {
    const { result } = renderHook(() => useOpenConversation(ALL), { wrapper });

    result.current('dfai-conv');

    expect(calls).toEqual([{ method: 'openInDeck', target: { projectKey: ALL, conversationRouteKey: '51' } }]);
    const panes = usePanesStore.getState().panesByWorkspace[ALL] ?? [];
    expect(panes.map((p) => p.conversationId)).toEqual(['dfai-conv']);
    expect(usePanesStore.getState().panesByWorkspace.dfai).toBeUndefined();
  });

  it('the beside hook in a 1-pane All deck builds two leaves', () => {
    const open = renderHook(() => useOpenConversation(ALL), { wrapper }).result.current;
    const beside = renderHook(() => useOpenConversationBeside(ALL), { wrapper }).result.current;

    open('dfai-conv');
    beside('other-conv');

    const layout = selectDeckLayout(ALL)(useDeckLayoutStore.getState());
    const panes = usePanesStore.getState().panesByWorkspace[ALL] ?? [];
    const byId = new Map(panes.map((p) => [p.paneId, p.conversationId]));
    expect(collectLeafIds(layout!).map((id) => byId.get(id))).toEqual(['dfai-conv', 'other-conv']);
    expect(calls.at(-1)).toEqual({ method: 'openInDeck', target: { projectKey: ALL, conversationRouteKey: '52' } });
    expect(calls.some((c) => c.method === 'selectProject')).toBe(false);
  });

  it('a plain open in a project deck still targets the conversation\'s project', () => {
    const { result } = renderHook(() => useOpenConversation('overdeck'), { wrapper });

    result.current('dfai-conv');

    expect(calls).toEqual([{ method: 'openInDeck', target: { projectKey: 'dfai', conversationRouteKey: '51' } }]);
  });

  it('the beside hook in a project deck opens beside in the conversation\'s project deck', () => {
    const { result } = renderHook(() => useOpenConversationBeside('proj'), { wrapper });

    result.current('existing-conv');

    expect(calls).toEqual([{ method: 'openInDeck', target: { projectKey: 'proj', conversationRouteKey: '42' } }]);
    const panes = usePanesStore.getState().panesByWorkspace.proj ?? [];
    const layout = selectDeckLayout('proj')(useDeckLayoutStore.getState());
    expect(collectLeafIds(layout!)).toEqual([panes[0]!.paneId, panes[1]!.paneId]);
    expect(panes[0]!.paneType).toBe('home');
  });
});

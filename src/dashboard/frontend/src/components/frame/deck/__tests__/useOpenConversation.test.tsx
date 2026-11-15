import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { useOpenConversation } from '../useOpenConversation';
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

const resolveConversationProjectName = vi.fn((conv: Conversation | null | undefined) => (conv ? 'proj' : null));

vi.mock('../useProjectScope', () => ({
  useProjectScope: () => ({
    conversations: [listedConversation],
    resolveConversationProjectName,
  }),
}));

let calls: DeckNavigationCall[];

beforeEach(() => {
  calls = [];
  resolveConversationProjectName.mockClear();
  useCommandDeckSelection.setState({ selectedConversation: null, selectedFeature: null });
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

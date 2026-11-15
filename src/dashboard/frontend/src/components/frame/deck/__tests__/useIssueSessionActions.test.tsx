import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProjectSessionTree, SessionNode } from '@overdeck/contracts';
import { useIssueSessionActions } from '../useIssueSessionActions';
import { TestDeckNavigationProvider, type DeckNavigationCall } from '../deckNavigation';
import { sessionTreesQueryKey } from '../useDeckProjects';
import { usePanesStore } from '../../../../lib/panesStore';
import { useCommandDeckSelection } from '../../../../lib/commandDeckSelection';
import type { ProjectData } from '../../../CommandDeck/projectsData';

vi.mock('../../../DialogProvider', () => ({ useConfirm: () => vi.fn(async () => true) }));
vi.mock('../../../../lib/refresh-dashboard-state', () => ({ refreshDashboardState: vi.fn(async () => undefined) }));

const projects: ProjectData[] = [
  { key: 'proj', name: 'proj', path: '/p/proj', features: [{ issueId: 'PAN-1' } as ProjectData['features'][number]] },
];
const tree = {
  projectKey: 'proj',
  features: [{ issueId: 'PAN-1', sessions: [{ sessionId: 'agent-x', presence: 'active', type: 'work' } as SessionNode] }],
} as unknown as ProjectSessionTree;

let client: QueryClient;
let calls: DeckNavigationCall[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['command-deck-projects'], projects);
  client.setQueryData(sessionTreesQueryKey('proj'), [tree]);
  calls = [];
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  vi.stubGlobal('fetch', fetchMock);
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} });
  useCommandDeckSelection.setState({ selectedConversation: 'conv-a', selectedFeature: null, selectedSessionByIssue: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <TestDeckNavigationProvider calls={calls}>{children}</TestDeckNavigationProvider>
    </QueryClientProvider>
  );
}

const activePane = (deck: string) => {
  const state = usePanesStore.getState();
  const id = state.activePaneByWorkspace[deck];
  return (state.panesByWorkspace[deck] ?? []).find((p) => p.paneId === id);
};

describe('useIssueSessionActions (PAN-5293 WI-4)', () => {
  it('handleSelectFeature opens the issue pane, selects it and calls openInDeck once', () => {
    const { result } = renderHook(() => useIssueSessionActions('proj'), { wrapper });
    act(() => result.current.handleSelectFeature('PAN-1'));

    expect(activePane('proj')).toMatchObject({ paneType: 'issue', issueId: 'PAN-1' });
    expect(calls).toEqual([{ method: 'openInDeck', target: { projectKey: 'proj', issueId: 'PAN-1' } }]);
    const selection = useCommandDeckSelection.getState();
    expect(selection.selectedFeature).toBe('PAN-1');
    expect(selection.selectedConversation).toBeNull();
    expect(selection.selectedSessionByIssue['PAN-1']).toBe('agent-x');
  });

  it('handleViewTerminal opens a terminal pane for the session and calls openInDeck', () => {
    const { result } = renderHook(() => useIssueSessionActions('proj'), { wrapper });
    act(() => result.current.handleViewTerminal('agent-x'));

    expect(activePane('proj')).toMatchObject({ paneType: 'terminal', terminalId: 'agent-x' });
    expect(calls).toEqual([{ method: 'openInDeck', target: { projectKey: 'proj' } }]);
  });

  it('handleStopSession sends DELETE /api/agents/<id>', async () => {
    const { result } = renderHook(() => useIssueSessionActions('proj'), { wrapper });
    await act(async () => {
      await result.current.handleStopSession('agent-x');
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/agent-x', { method: 'DELETE' });
  });

  it('handleCleanupOrphanedResources invalidates command-deck-projects after a confirmed prompt', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useIssueSessionActions('proj'), { wrapper });
    await act(async () => {
      await result.current.handleCleanupOrphanedResources('PAN-1');
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/issues/PAN-1/cleanup-workspace', { method: 'POST' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['command-deck-projects'] });
    confirmSpy.mockRestore();
  });
});

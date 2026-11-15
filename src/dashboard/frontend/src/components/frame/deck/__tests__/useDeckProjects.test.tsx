import { beforeEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProjectSessionTree, SessionNode } from '@overdeck/contracts';
import { sessionTreesQueryKey, useDeckProjects } from '../useDeckProjects';
import type { ProjectData } from '../../../CommandDeck/projectsData';

type Feature = ProjectData['features'][number];
const feature = (issueId: string): Feature => ({ issueId } as Feature);
const session = (sessionId: string, presence: SessionNode['presence'] = 'active'): SessionNode =>
  ({ sessionId, presence } as SessionNode);
const tree = (projectKey: string, features: Array<[string, SessionNode[]]>): ProjectSessionTree =>
  ({ projectKey, features: features.map(([issueId, sessions]) => ({ issueId, sessions })) } as unknown as ProjectSessionTree);

const projects: ProjectData[] = [
  { key: 'alpha', name: 'alpha', path: '/p/alpha', features: [feature('ALP-1'), feature('ALP-2')] },
  { key: 'beta', name: 'beta', path: '/p/beta', features: [feature('BET-1'), feature('BET-2')] },
];

let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['command-deck-projects'], projects);
  client.setQueryData(sessionTreesQueryKey('alpha,beta'), [
    tree('alpha', [['ALP-1', [session('a1')]], ['ALP-2', [session('a2')]]]),
    tree('beta', [['BET-1', [session('b1')]], ['BET-2', [session('b2')]]]),
  ]);
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useDeckProjects (PAN-5293 §6.1)', () => {
  it('merges session trees into features', () => {
    const { result } = renderHook(() => useDeckProjects(), { wrapper });
    expect(result.current.projects).toBe(projects);
    expect(result.current.isFetched).toBe(true);
    const alpha = result.current.projectsWithSessions[0]!;
    expect(alpha.features[0]!.sessions?.map((s) => s.sessionId)).toEqual(['a1']);
    expect(Object.keys(result.current.sessionTreeMap)).toEqual(['alpha', 'beta']);
  });

  it('keeps the identity of untouched projects and features when one project tree changes', async () => {
    const { result } = renderHook(() => useDeckProjects(), { wrapper });
    const before = result.current.projectsWithSessions;
    const [alphaTree, betaTree] = client.getQueryData<ProjectSessionTree[]>(sessionTreesQueryKey('alpha,beta'))!;
    const newSessions = [session('b1', 'idle')];
    const nextBeta = {
      ...betaTree!,
      features: [{ ...betaTree!.features[0]!, sessions: newSessions }, betaTree!.features[1]!],
    } as ProjectSessionTree;

    act(() => {
      client.setQueryData(sessionTreesQueryKey('alpha,beta'), [alphaTree, nextBeta]);
    });

    await waitFor(() => expect(result.current.projectsWithSessions).not.toBe(before));
    const after = result.current.projectsWithSessions;
    expect(after[0]).toBe(before[0]);
    expect(after[0]!.features[0]).toBe(before[0]!.features[0]);
    expect(after[0]!.features[1]).toBe(before[0]!.features[1]);
    expect(after[1]).not.toBe(before[1]);
    // Structural sharing in react-query copies the changed path, so compare by value.
    expect(after[1]!.features[0]!.sessions).toEqual(newSessions);
    expect(after[1]!.features[0]).not.toBe(before[1]!.features[0]);
    expect(after[1]!.features[1]).toBe(before[1]!.features[1]);
  });
});

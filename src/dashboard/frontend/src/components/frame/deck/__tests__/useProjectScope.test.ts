import { beforeEach, describe, expect, it } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useProjectScope } from '../useProjectScope';
import { NO_PROJECT_KEY, type ProjectData } from '../../../CommandDeck/projectsData';
import type { Conversation } from '../../../CommandDeck/ConversationList';

const registeredProjects = [
  { key: 'alpha', name: 'alpha', path: '/home/u/Projects/alpha' },
  { key: 'beta', name: 'beta', path: '/home/u/Projects/beta' },
];

const projects: ProjectData[] = [
  { key: 'alpha', name: 'alpha', path: '/home/u/Projects/alpha', features: [{ issueId: 'ALP-1' } as ProjectData['features'][number]] },
];

const conv = (id: number, fields: Partial<Conversation>): Conversation =>
  ({ id, name: `conv-${id}`, title: `Conversation ${id}`, ...fields }) as Conversation;

const conversations = [
  conv(1, { cwd: '/home/u/Projects/alpha/src' }),            // cwd-only → alpha
  conv(2, { cwd: '/home/u/Projects/alpha', projectKey: 'beta' }), // override → beta
  conv(3, { cwd: '/home/u/Projects/beta' }),                  // cwd-only → beta
  conv(4, { cwd: '/home/u/elsewhere' }),                      // unscoped
  conv(5, { projectKey: 'ghost' }),                            // unregistered override → unscoped
];

let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['registered-projects'], registeredProjects);
  client.setQueryData(['command-deck-projects'], projects);
  client.setQueryData(['session-trees', 'alpha'], []);
  client.setQueryData(['conversations'], conversations);
});

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children);
}

describe('useProjectScope (PAN-5293 §6.1)', () => {
  it('scopes conversations to the rows resolveEffectiveProjectKey maps to the project', () => {
    const { result } = renderHook(() => useProjectScope('beta'), { wrapper });
    expect(result.current.projectConvs.map((c) => c.id)).toEqual([2, 3]);
    expect([...result.current.projectConvIdSet]).toEqual([2, 3]);

    const alpha = renderHook(() => useProjectScope('alpha'), { wrapper });
    expect(alpha.result.current.projectConvs.map((c) => c.id)).toEqual([1]);
    expect(alpha.result.current.projectIssueIds).toEqual(['ALP-1']);
    expect(alpha.result.current.selectedProjectData?.name).toBe('alpha');
    expect(alpha.result.current.selectedRegisteredProject?.key).toBe('alpha');
  });

  it('returns the unscoped conversations for NO_PROJECT_KEY', () => {
    const { result } = renderHook(() => useProjectScope(NO_PROJECT_KEY), { wrapper });
    expect(result.current.projectConvs.map((c) => c.id)).toEqual([4, 5]);
    expect(result.current.membership.unknown).toBe(false);
  });

  it('prefers the conversations passed in over the query', () => {
    const passed = [conv(9, { cwd: '/home/u/Projects/beta/x' })];
    const { result } = renderHook(() => useProjectScope('beta', passed), { wrapper });
    expect(result.current.projectConvs.map((c) => c.id)).toEqual([9]);
  });

  it('resolves a conversation to its project name and flags an unregistered deck', () => {
    const { result } = renderHook(() => useProjectScope('ghost'), { wrapper });
    expect(result.current.resolveConversationProjectName(conversations[1])).toBe('beta');
    expect(result.current.resolveConversationProjectName(conversations[3])).toBeNull();
    expect(result.current.membership).toEqual({ pending: false, registryError: false, unknown: true });
    expect(result.current.projectConvs).toEqual([]);
  });
});

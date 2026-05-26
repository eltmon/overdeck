import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { fetchConversations, type Conversation } from '../components/CommandDeck/ConversationList';

interface RegisteredProject {
  key: string;
  name: string;
  path: string;
  linearTeam: string | null;
  githubRepo: string | null;
  linearProject: string | null;
}

export function useRegisteredProjects() {
  return useQuery<RegisteredProject[]>({
    queryKey: ['registered-projects'],
    queryFn: async () => {
      const res = await fetch('/api/registered-projects');
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60000,
  });
}

/**
 * Resolve the project root path for an issue id (e.g. `PAN-123` → the
 * `panopticon` project's `path`). Returns `null` when no issue is selected
 * or no matching project is registered — callers should fall back to the
 * server-side default cwd.
 */
export function useProjectCwdForIssue(issueId: string | null): string | null {
  const { data: projects = [] } = useRegisteredProjects();

  return useMemo(() => {
    if (!issueId) return null;
    const prefix = issueId.split('-')[0]?.toUpperCase();
    if (!prefix) return null;
    const match =
      projects.find((p) => p.linearTeam?.toUpperCase() === prefix) ??
      projects.find((p) => p.key.toUpperCase().replace(/-/g, '') === prefix);
    return match?.path ?? null;
  }, [issueId, projects]);
}

/**
 * Resolve the cwd to use for the global top-bar editor launcher.
 *
 * Priority:
 *   1. If the issue drawer is open → the matching registered project's path
 *      (e.g. PAN-123 → /home/user/Projects/panopticon-cli).
 *   2. Else if a conversation is selected → that conversation's own `cwd`
 *      (the directory Claude/the agent is running in).
 *   3. Else `null` → caller falls back to the server-resolved default cwd.
 */
export function useTopBarCwd(issueId: string | null, convId: string | null): string | null {
  const issueCwd = useProjectCwdForIssue(issueId);

  const { data: conversations = [] } = useQuery<Conversation[]>({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    enabled: !issueCwd && convId !== null,
    staleTime: 10_000,
  });

  return useMemo(() => {
    if (issueCwd) return issueCwd;
    if (!convId) return null;
    const conv = conversations.find((c) => String(c.id) === convId || c.name === convId);
    return conv?.cwd ?? null;
  }, [issueCwd, convId, conversations]);
}

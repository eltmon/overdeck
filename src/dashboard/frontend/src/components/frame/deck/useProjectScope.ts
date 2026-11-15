/**
 * useProjectScope — the data scoped to one deck project (PAN-5293 §6.1, moved
 * from CommandDeck/index.tsx): its conversations, issue ids, project data and
 * registry entry, the conversation→project resolver, and the membership
 * flags the deck and the Issues section gate on.
 *
 * `conversations` defaults to the `['conversations']` query; CommandDeck
 * passes its `usePriorityConversation` list so a deep-linked conversation not
 * yet in the list still reaches ProjectHome. For `NO_PROJECT_KEY` the scope is
 * the conversations under no registered project.
 */

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Conversation } from '../../CommandDeck/ConversationList';
import { fetchWithTimeout } from '../../../lib/apiFetch';
import { usePlannedBacklogVisibility } from '../../../hooks/usePlannedBacklogVisibility';
import {
  filterSpecOnlyPlanned,
  isUnscopedConversation,
  resolveEffectiveProjectKey,
  NO_PROJECT_KEY,
  type ProjectData,
} from '../../CommandDeck/projectsData';
import {
  fetchRegisteredProjects,
  findRegisteredProject,
  isKnownProject,
  type RegisteredProject,
} from '../../CommandDeck/UnknownProjectState';
import type { ProjectFeature } from '../../CommandDeck/ProjectTree/ProjectNode';
import { useDeckProjects } from './useDeckProjects';

export async function fetchConversations(): Promise<Conversation[]> {
  const res = await fetchWithTimeout('/api/conversations');
  if (!res.ok) throw new Error('Failed to fetch conversations');
  return res.json();
}

export interface ProjectMembership {
  /** The project list or the registry has not loaded yet. */
  pending: boolean;
  /** The registry query failed. */
  registryError: boolean;
  /** The project is not registered on this machine. */
  unknown: boolean;
}

export interface ProjectScope {
  /** The conversation list the scope was computed from. */
  conversations: Conversation[];
  projectConvs: Conversation[];
  projectConvIdSet: Set<number>;
  projectIssueIds: string[];
  selectedProjectData: ProjectData | null;
  visibleFeatures: ProjectFeature[];
  selectedRegisteredProject: RegisteredProject | undefined;
  resolveConversationProjectName: (conv: Conversation | null | undefined) => string | null;
  membership: ProjectMembership;
}

export function useProjectScope(deckKey: string | null, conversationsOverride?: Conversation[]): ProjectScope {
  const { projectsWithSessions, isFetched: projectsFetched } = useDeckProjects();
  const showPlannedBacklog = usePlannedBacklogVisibility((state) => state.showPlannedBacklog);
  const { data: registeredProjects = [], isFetched: registeredProjectsFetched, isError: registeredProjectsError } = useQuery({
    queryKey: ['registered-projects'],
    queryFn: fetchRegisteredProjects,
    staleTime: 60000,
  });
  const { data: conversationList = [] } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    refetchInterval: 10000,
  });
  const conversations = conversationsOverride ?? conversationList;

  // Partition conversations into project-scoped vs unscoped
  const { projectConversations } = useMemo(() => {
    const map: Record<string, Conversation[]> = {};
    const excludeSet = new Set<number>();
    if (!Array.isArray(registeredProjects) || registeredProjects.length === 0) return { projectConversations: map, excludeConvIds: excludeSet };

    const keyToKeys = new Map<string, string[]>();
    for (const rp of registeredProjects) {
      const keys = Array.from(new Set([rp.key, rp.name].filter((key): key is string => Boolean(key))));
      keyToKeys.set(rp.key, keys);
    }

    // One resolver decides "which project" for every conversation (PAN-1577):
    // explicit projectKey override first, cwd→project-path inference otherwise.
    for (const conv of conversations) {
      const effectiveKey = resolveEffectiveProjectKey(conv, registeredProjects);
      if (!effectiveKey) continue;
      const projectKeys = keyToKeys.get(effectiveKey);
      if (!projectKeys) continue;
      for (const projectKey of projectKeys) {
        if (!map[projectKey]) map[projectKey] = [];
        map[projectKey].push(conv);
      }
      excludeSet.add(conv.id);
    }

    return { projectConversations: map, excludeConvIds: excludeSet };
  }, [conversations, registeredProjects]);

  // Resolve the registered project (by name) that owns a conversation, or null
  // when the conversation is unscoped. Prefers the explicit `projectKey`
  // override (PAN-1577) when set; falls back to cwd→project-path inference
  // only when it's null (e.g. created without a projectKey, so cwd defaults to
  // ~/Projects).
  const resolveConversationProjectName = useCallback(
    (conv: Conversation | null | undefined): string | null => {
      if (!conv) return null;
      const effectiveKey = resolveEffectiveProjectKey(conv, registeredProjects);
      if (!effectiveKey) return null;
      const matched = registeredProjects.find((rp) => rp.key === effectiveKey);
      return matched ? (matched.name ?? matched.key) : null;
    },
    [registeredProjects],
  );

  const selectedProjectData = useMemo(() => {
    if (!deckKey) return null;
    return projectsWithSessions.find(p => p.name === deckKey) ?? null;
  }, [projectsWithSessions, deckKey]);
  const visibleFeatures = useMemo(
    () => filterSpecOnlyPlanned(selectedProjectData?.features ?? [], showPlannedBacklog),
    [selectedProjectData, showPlannedBacklog],
  );

  const selectedRegisteredProject = useMemo(
    () => findRegisteredProject(registeredProjects, deckKey),
    [registeredProjects, deckKey],
  );
  const isProjectValidationPending = Boolean(deckKey && (!projectsFetched || !registeredProjectsFetched));
  const showUnknownProject = Boolean(deckKey && !isProjectValidationPending && !registeredProjectsError && !isKnownProject(deckKey, registeredProjects));

  // ── Project-scoped deck data (PAN-1561) ──────────────────────────────────────
  // For a real project: its scoped conversations + issue ids. For the special
  // "No project" bucket: conversations not under any registered project.
  const isNoProject = deckKey === NO_PROJECT_KEY;
  const unscopedConversations = useMemo(
    () => conversations.filter((c) => isUnscopedConversation(c, registeredProjects)),
    [conversations, registeredProjects],
  );
  const projectConvs = useMemo(
    () =>
      isNoProject
        ? unscopedConversations
        : deckKey
          ? (projectConversations[deckKey] ?? [])
          : [],
    [isNoProject, unscopedConversations, deckKey, projectConversations],
  );
  const projectConvIdSet = useMemo(() => new Set(projectConvs.map(c => c.id)), [projectConvs]);
  const projectIssueIds = useMemo(
    () => (selectedProjectData?.features ?? []).map(f => f.issueId),
    [selectedProjectData],
  );

  const membership = useMemo<ProjectMembership>(
    () => ({ pending: isProjectValidationPending, registryError: Boolean(registeredProjectsError), unknown: showUnknownProject }),
    [isProjectValidationPending, registeredProjectsError, showUnknownProject],
  );

  return {
    conversations,
    projectConvs,
    projectConvIdSet,
    projectIssueIds,
    selectedProjectData,
    visibleFeatures,
    selectedRegisteredProject,
    resolveConversationProjectName,
    membership,
  };
}

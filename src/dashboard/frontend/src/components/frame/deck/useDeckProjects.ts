/**
 * useDeckProjects — the Command Deck's project list merged with live session
 * trees (PAN-5293 §6.1, moved from CommandDeck/index.tsx).
 *
 * One query key, `['command-deck-projects']`, shared with every other reader
 * (F-D5). The session-tree bulk query is `sessionTreesQueryKey(projects)`;
 * `useSessionTreeSubscription` patches that entry with live deltas.
 */

import { useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ProjectSessionTree, SessionNode } from '@overdeck/contracts';
import { fetchProjects, type ProjectData } from '../../CommandDeck/projectsData';
import type { ProjectFeature } from '../../CommandDeck/ProjectTree/ProjectNode';

export async function fetchAllSessionTrees(projectKeys: string[]): Promise<ProjectSessionTree[]> {
  if (projectKeys.length === 0) return [];
  const res = await fetch(`/api/session-trees?projects=${encodeURIComponent(projectKeys.join(','))}`);
  if (!res.ok) throw new Error('Failed to fetch session trees');
  const data = await res.json() as { trees: ProjectSessionTree[] };
  return data.trees;
}

/** Key of the session-tree bulk query, one per project-name set. */
export const sessionTreesQueryKey = (projectNamesKey: string) => ['session-trees', projectNamesKey] as const;

/** Comma-joined project names: the session-tree query's identity. */
export const projectNamesKeyOf = (projects: readonly ProjectData[]) => projects.map(p => p.name).join(',');

export interface DeckProjects {
  projects: ProjectData[];
  projectsWithSessions: ProjectData[];
  sessionTreeMap: Record<string, ProjectSessionTree>;
  isLoading: boolean;
  isFetched: boolean;
}

export function useDeckProjects(): DeckProjects {
  const { data: projects = [], isLoading, isFetched } = useQuery({
    queryKey: ['command-deck-projects'],
    queryFn: fetchProjects,
    refetchInterval: 30000,
  });

  // ── Session Tree (PAN-821) ───────────────────────────────────────────────────
  // Fetch all session trees in a single request to avoid N+1 HTTP waterfall
  const projectNamesKey = useMemo(() => projectNamesKeyOf(projects), [projects]);
  const { data: sessionTrees = [] } = useQuery({
    queryKey: sessionTreesQueryKey(projectNamesKey),
    queryFn: () => fetchAllSessionTrees(projects.map(p => p.name)),
    enabled: projects.length > 0,
  });

  const sessionTreeDataRef = useRef<Record<string, ProjectSessionTree>>({});
  const sessionTreeMap = useMemo(() => {
    const map: Record<string, ProjectSessionTree> = {};
    let changed = false;
    for (const tree of sessionTrees) {
      map[tree.projectKey] = tree;
      if (sessionTreeDataRef.current[tree.projectKey] !== tree) changed = true;
    }
    if (!changed && Object.keys(map).length === Object.keys(sessionTreeDataRef.current).length) {
      return sessionTreeDataRef.current;
    }
    sessionTreeDataRef.current = map;
    return map;
  }, [sessionTrees]);

  // Merge session trees into project features, preserving object identity
  // for features whose sessions haven't changed (avoids O(total features)
  // re-renders per delta — only features in the affected project re-render).
  // Fetched features carry no sessions, so a merge from `project` alone would
  // copy every feature on every tree change; reuse the previous merge of the
  // same project data instead (PAN-5293 deck-data-hooks.ac2).
  const previousMergeRef = useRef(new Map<string, { project: ProjectData; merged: ProjectData }>());
  const projectsWithSessions = useMemo(() => {
    const previous = previousMergeRef.current;
    const next = new Map<string, { project: ProjectData; merged: ProjectData }>();
    const result = projects.map(project => {
      const tree = sessionTreeMap[project.name];
      if (!tree) return project;
      const prior = previous.get(project.name);
      const priorFeatures = prior?.project === project ? prior.merged.features : null;

      const featureSessions = new Map<string, readonly SessionNode[]>();
      for (const feature of tree.features) {
        featureSessions.set(feature.issueId.toLowerCase(), feature.sessions);
      }

      let featuresChanged = false;
      const nextFeatures = project.features.map((feature: ProjectFeature, index) => {
        const sessions = featureSessions.get(feature.issueId.toLowerCase()) ?? feature.sessions;
        const priorFeature = priorFeatures?.[index];
        if (priorFeature && priorFeature.sessions === sessions) {
          if (priorFeature !== feature) featuresChanged = true;
          return priorFeature;
        }
        if (sessions === feature.sessions) return feature;
        featuresChanged = true;
        return { ...feature, sessions };
      });
      const merged = !featuresChanged
        ? project
        : prior?.project === project && nextFeatures.every((f, index) => f === prior.merged.features[index])
          ? prior.merged
          : { ...project, features: nextFeatures };
      next.set(project.name, { project, merged });
      return merged;
    });
    previousMergeRef.current = next;
    return result;
  }, [projects, sessionTreeMap]);

  return { projects, projectsWithSessions, sessionTreeMap, isLoading, isFetched };
}

/**
 * useSessionTreeSubscription — live session-tree deltas for every deck project
 * (PAN-5293 §6.1, moved from CommandDeck/index.tsx). Patches the bulk
 * `sessionTreesQueryKey` cache entry that `useDeckProjects` reads; a
 * `session_added` delta refetches it instead. Mount it once (F-D4).
 */

import { useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { WS_METHODS } from '@overdeck/contracts';
import type { ProjectSessionTree, SessionTreeDelta } from '@overdeck/contracts';
import { getTransport, type PanRpcProtocolClient } from '../../../lib/wsTransport';
import type { ProjectData } from '../../CommandDeck/projectsData';
import { projectNamesKeyOf, sessionTreesQueryKey } from './useDeckProjects';

/** Apply a live delta to a cached ProjectSessionTree. Returns a new object or undefined if not applicable.
 *  Optimized to O(F + S) per delta by finding the target feature/session by index instead of nested scans.
 */
export function applySessionTreeDelta(tree: ProjectSessionTree, delta: SessionTreeDelta): ProjectSessionTree {
  const deltaIssueIdLower = delta.issueId.toLowerCase();
  const featureIdx = tree.features.findIndex(f => f.issueId.toLowerCase() === deltaIssueIdLower);
  if (featureIdx === -1) return tree;

  const feature = tree.features[featureIdx];
  if (!feature) return tree;

  switch (delta.kind) {
    case 'session_added': {
      // Lightweight delta — invalidate to trigger refetch
      return tree;
    }
    case 'session_removed': {
      const filtered = feature.sessions.filter(s => s.sessionId !== delta.sessionId);
      if (filtered.length === feature.sessions.length) return tree;
      const newFeatures = [...tree.features];
      newFeatures[featureIdx] = { ...feature, sessions: filtered };
      return { ...tree, features: newFeatures };
    }
    case 'presence_changed':
    case 'status_changed': {
      const sessionIdx = feature.sessions.findIndex(s => s.sessionId === delta.sessionId);
      if (sessionIdx === -1) return tree;
      const newSessions = [...feature.sessions];
      newSessions[sessionIdx] = {
        ...feature.sessions[sessionIdx]!,
        ...(delta.presence !== undefined && { presence: delta.presence }),
        ...(delta.status !== undefined && { status: delta.status }),
      };
      const newFeatures = [...tree.features];
      newFeatures[featureIdx] = { ...feature, sessions: newSessions };
      return { ...tree, features: newFeatures };
    }
    case 'pending_input_changed': {
      const sessionIdx = feature.sessions.findIndex(s => s.sessionId === delta.sessionId);
      if (sessionIdx === -1) return tree;
      const newSessions = [...feature.sessions];
      newSessions[sessionIdx] = {
        ...feature.sessions[sessionIdx]!,
        awaitingInput: delta.awaitingInput ?? false,
        awaitingInputPrompt: delta.awaitingInputPrompt,
        awaitingInputReason: delta.awaitingInputReason,
        pendingInputKinds: delta.pendingInputKinds,
      };
      const newFeatures = [...tree.features];
      newFeatures[featureIdx] = { ...feature, sessions: newSessions };
      return { ...tree, features: newFeatures };
    }
    default:
      return tree;
  }
}

export function useSessionTreeSubscription(projects: readonly ProjectData[]): void {
  const queryClient = useQueryClient();
  const projectNamesKey = useMemo(() => projectNamesKeyOf(projects), [projects]);

  // Track current project names key for delta handlers (avoids stale closure)
  // Subscribe to live session tree deltas for each project
  useEffect(() => {
    const transport = getTransport();
    const unsubscribes: Array<() => void> = [];

    for (const project of projects) {
      const unsubscribe = transport.subscribe(
        (client) =>
          (client as PanRpcProtocolClient)[WS_METHODS.subscribeProjectSessionTree]({
            projectKey: project.name,
          }) as unknown as import('effect').Stream.Stream<SessionTreeDelta, Error>,
        (delta) => {
          const bulkKey = sessionTreesQueryKey(projectNamesKey);
          const bulkData = queryClient.getQueryData<ProjectSessionTree[]>(bulkKey);
          if (!bulkData) return;
          const tree = bulkData.find(t => t.projectKey === project.name);
          if (!tree) return;
          if (delta.kind === 'session_added') {
            void queryClient.invalidateQueries({ queryKey: bulkKey, exact: true });
            return;
          }

          const updated = applySessionTreeDelta(tree, delta);
          if (updated === tree) return;
          const newBulkData = bulkData.map(t => t.projectKey === project.name ? updated : t);
          queryClient.setQueryData(bulkKey, newBulkData);
        },
      );
      unsubscribes.push(unsubscribe);
    }

    return () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
    };
  }, [projectNamesKey, projects, queryClient]);
}

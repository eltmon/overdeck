/**
 * Agents Directory data (PAN-3920 W5, D7).
 *
 * The server recomputes the directory on every read (memoized 3 s) and stores
 * nothing, so the page polls every 5 s while visible and refetches early —
 * at most once per 2 s — whenever the live pane inventory changes.
 */
import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentDirectoryResponse } from '@overdeck/contracts';

import { useDashboardStore } from '../../../lib/store';

export type DirectoryWindowHours = 24 | 168;

export const AGENT_DIRECTORY_QUERY_KEY = 'agent-directory';
const PANE_INVALIDATE_THROTTLE_MS = 2_000;

export async function fetchAgentDirectory(windowHours: DirectoryWindowHours): Promise<AgentDirectoryResponse> {
  const res = await fetch(`/api/agent-directory?windowHours=${windowHours}`);
  if (!res.ok) throw new Error(`Failed to load the agents directory (${res.status})`);
  return res.json() as Promise<AgentDirectoryResponse>;
}

export function useAgentDirectory(windowHours: DirectoryWindowHours) {
  const queryClient = useQueryClient();
  const backendPanesById = useDashboardStore((s) => s.backendPanesById);
  const lastInvalidatedAt = useRef(0);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const now = Date.now();
    if (now - lastInvalidatedAt.current < PANE_INVALIDATE_THROTTLE_MS) return;
    lastInvalidatedAt.current = now;
    void queryClient.invalidateQueries({ queryKey: [AGENT_DIRECTORY_QUERY_KEY] });
  }, [backendPanesById, queryClient]);

  return useQuery({
    queryKey: [AGENT_DIRECTORY_QUERY_KEY, windowHours],
    queryFn: () => fetchAgentDirectory(windowHours),
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    staleTime: 2_000,
  });
}

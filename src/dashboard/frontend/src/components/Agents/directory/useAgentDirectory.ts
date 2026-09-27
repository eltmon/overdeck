/**
 * Agents Directory data (PAN-3920 W5, D7).
 *
 * The server recomputes the directory on every read (memoized 3 s) and stores
 * nothing, so the page polls every 5 s while visible and refetches early —
 * at most once per 2 s, with a trailing refetch for changes inside the
 * window — whenever the live pane inventory changes. A hidden tab neither
 * polls nor invalidates.
 *
 * The same hook serves the Live view (PAN-4197): `useAgentDirectory('live')`
 * reads `?scope=live` — what is running or waiting now — with the same poll
 * and throttle.
 */
import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentDirectoryResponse } from '@overdeck/contracts';

import { useDashboardStore } from '../../../lib/store';

export type DirectoryWindowHours = 24 | 168;
/** A time window, or the live scope. */
export type DirectoryRequest = DirectoryWindowHours | 'live';

export const AGENT_DIRECTORY_QUERY_KEY = 'agent-directory';
export const PANE_INVALIDATE_THROTTLE_MS = 2_000;

export async function fetchAgentDirectory(windowHours: DirectoryWindowHours): Promise<AgentDirectoryResponse> {
  const res = await fetch(`/api/agent-directory?windowHours=${windowHours}`);
  if (!res.ok) throw new Error(`Failed to load the agents directory (${res.status})`);
  return res.json() as Promise<AgentDirectoryResponse>;
}

export async function fetchLiveAgentDirectory(): Promise<AgentDirectoryResponse> {
  const res = await fetch('/api/agent-directory?scope=live');
  if (!res.ok) throw new Error(`Failed to load the live agents (${res.status})`);
  return res.json() as Promise<AgentDirectoryResponse>;
}

function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export function useAgentDirectory(request: DirectoryRequest) {
  const queryClient = useQueryClient();
  const backendPanesById = useDashboardStore((s) => s.backendPanesById);
  const lastInvalidatedAt = useRef(0);
  const trailing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRender = useRef(true);

  useEffect(() => () => {
    if (trailing.current) clearTimeout(trailing.current);
  }, []);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (isDocumentHidden()) return;
    const invalidate = () => {
      trailing.current = null;
      if (isDocumentHidden()) return;
      lastInvalidatedAt.current = Date.now();
      void queryClient.invalidateQueries({ queryKey: [AGENT_DIRECTORY_QUERY_KEY] });
    };
    const wait = PANE_INVALIDATE_THROTTLE_MS - (Date.now() - lastInvalidatedAt.current);
    if (wait <= 0) {
      invalidate();
    } else if (!trailing.current) {
      trailing.current = setTimeout(invalidate, wait);
    }
  }, [backendPanesById, queryClient]);

  return useQuery({
    queryKey: [AGENT_DIRECTORY_QUERY_KEY, request],
    queryFn: () => (request === 'live' ? fetchLiveAgentDirectory() : fetchAgentDirectory(request)),
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    staleTime: 2_000,
  });
}

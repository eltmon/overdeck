/**
 * useSocketIssues — Real-time issue push via socket.io
 *
 * Connects to the dashboard server's socket.io endpoint,
 * listens for push events, and injects data directly into
 * TanStack Query's cache via queryClient.setQueryData().
 *
 * Falls back to HTTP polling if socket connection fails.
 */

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import type { Issue } from '../types';

export function useSocketIssues(): void {
  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io({
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[socket.io] Connected for real-time issue updates');
    });

    socket.on('disconnect', (reason) => {
      console.log('[socket.io] Disconnected:', reason);
    });

    // Set base ['issues'] cache directly, then invalidate filtered queries so they refetch
    const updateIssueQueries = (issues: Issue[]) => {
      // Set the exact ['issues'] key used by App.tsx and AgentList.tsx
      queryClient.setQueryData(['issues'], issues);
      // Invalidate filtered queries (e.g. ['issues', cycle, completed] in KanbanBoard)
      // so they refetch through their queryFn with correct params
      queryClient.invalidateQueries({ queryKey: ['issues'], exact: false });
    };

    // Full snapshot (on connect, or on request)
    socket.on('issues:snapshot', updateIssueQueries);

    // Incremental update (after changes detected by server)
    socket.on('issues:updated', updateIssueQueries);

    // Agent lifecycle events — invalidate agents query for immediate UI updates
    socket.on('agents:changed', () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    });

    // Pipeline status — real-time review/test/merge status pushed from server
    socket.on('pipeline:status', (status: any) => {
      if (status?.issueId) {
        queryClient.setQueryData(['review-status', status.issueId], status);
      }
    });

    // Merge ready notification — server signals that an issue is ready to merge.
    // Invalidate the review-status cache so the dashboard re-fetches and shows the MERGE button.
    socket.on('merge:ready', ({ issueId }: { issueId: string }) => {
      queryClient.invalidateQueries({ queryKey: ['review-status', issueId] });
      // Also refresh the issues list in case the status column needs updating
      queryClient.invalidateQueries({ queryKey: ['issues'], exact: false });
    });

    // Planning agent lifecycle events
    socket.on('planning:started', ({ issueId }: { issueId: string }) => {
      queryClient.invalidateQueries({ queryKey: ['planningStatus', issueId] });
    });

    socket.on('planning:failed', ({ issueId }: { issueId: string }) => {
      queryClient.invalidateQueries({ queryKey: ['planningStatus', issueId] });
      // Invalidate agents so kanban badge picks up the failed state
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    });

    // Tab visibility: request snapshot on re-focus
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && socket.connected) {
        socket.emit('issues:request-snapshot');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [queryClient]);
}

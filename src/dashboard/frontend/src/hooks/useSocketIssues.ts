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

    // Update all issue-related queries (base ['issues'] and filtered ['issues', cycle, completed])
    const updateIssueQueries = (issues: Issue[]) => {
      queryClient.setQueriesData({ queryKey: ['issues'] }, issues);
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

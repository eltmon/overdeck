/**
 * useResourceStats — subscribes to `resources:updated` Socket.io events
 * and injects data into TanStack Query cache for the ['resources'] key.
 *
 * Uses the existing socket connection from useSocketIssues if present,
 * otherwise creates its own. The hook is idempotent — safe to call multiple times.
 */

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';

let sharedSocket: Socket | null = null;
let socketRefCount = 0;

function getSharedSocket(): Socket {
  if (!sharedSocket || !sharedSocket.connected) {
    sharedSocket = io({
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });
  }
  return sharedSocket;
}

export function useResourceStats(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = getSharedSocket();
    socketRefCount++;

    const handleUpdate = (snapshot: unknown) => {
      queryClient.setQueryData(['resources'], snapshot);
    };

    socket.on('resources:updated', handleUpdate);

    return () => {
      socket.off('resources:updated', handleUpdate);
      socketRefCount--;
      if (socketRefCount <= 0 && sharedSocket) {
        sharedSocket.disconnect();
        sharedSocket = null;
        socketRefCount = 0;
      }
    };
  }, [queryClient]);
}

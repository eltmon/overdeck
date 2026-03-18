/**
 * useGodViewSocket — God View real-time socket.io hook (PAN-341)
 *
 * Connects to the dashboard server and subscribes to God View specific events:
 *   - godview:agent-output — terminal lines per agent
 *   - godview:status-change — agent status transitions
 *   - godview:activity — global activity feed
 *
 * Stores state in a Zustand store for consumption by God View components.
 */

import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { create } from 'zustand';

export interface GodViewActivityEvent {
  agentId: string;
  timestamp: string;
  type: string;
  message: string;
}

export interface GodViewStore {
  // Terminal output per agent (last 30 lines)
  agentOutput: Record<string, string[]>;
  setAgentOutput: (agentId: string, lines: string[]) => void;

  // Status changes
  agentStatuses: Record<string, string>;
  setAgentStatus: (agentId: string, status: string) => void;

  // Activity feed (last 50 events, newest first)
  activityFeed: GodViewActivityEvent[];
  appendActivityEvents: (events: GodViewActivityEvent[]) => void;

  // System health
  systemHealth: { cpu: number; memPercent: number; memUsed: number; memTotal: number } | null;
  setSystemHealth: (h: GodViewStore['systemHealth']) => void;

  // Focus state
  focusedAgentId: string | null;
  setFocusedAgentId: (id: string | null) => void;
}

export const useGodViewStore = create<GodViewStore>((set) => ({
  agentOutput: {},
  setAgentOutput: (agentId, lines) =>
    set((s) => ({ agentOutput: { ...s.agentOutput, [agentId]: lines } })),

  agentStatuses: {},
  setAgentStatus: (agentId, status) =>
    set((s) => ({ agentStatuses: { ...s.agentStatuses, [agentId]: status } })),

  activityFeed: [],
  appendActivityEvents: (events) =>
    set((s) => {
      const merged = [...events, ...s.activityFeed];
      // Deduplicate by timestamp+agentId
      const seen = new Set<string>();
      const unique = merged.filter((e) => {
        const key = `${e.agentId}:${e.timestamp}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return { activityFeed: unique.slice(0, 50) };
    }),

  systemHealth: null,
  setSystemHealth: (h) => set({ systemHealth: h }),

  focusedAgentId: null,
  setFocusedAgentId: (id) => set({ focusedAgentId: id }),
}));

let godViewSocket: Socket | null = null;
let godViewSocketRefCount = 0;

export function useGodViewSocket(): void {
  const store = useGodViewStore();

  useEffect(() => {
    godViewSocketRefCount++;

    // Reuse existing socket if already connected
    if (!godViewSocket || !godViewSocket.connected) {
      godViewSocket = io({
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
      });
    }

    const socket = godViewSocket;

    socket.on('godview:agent-output', ({ agentId, lines }: { agentId: string; lines: string[] }) => {
      store.setAgentOutput(agentId, lines);
    });

    socket.on('godview:status-change', ({ agentId, status }: { agentId: string; status: string }) => {
      store.setAgentStatus(agentId, status);
    });

    socket.on('godview:activity', ({ events }: { events: GodViewActivityEvent[] }) => {
      store.appendActivityEvents(events);
    });

    // Poll system health every 10s
    let healthTimer: ReturnType<typeof setInterval> | null = null;
    const fetchHealth = async () => {
      try {
        const res = await fetch('/api/godview/system-health');
        if (res.ok) {
          const data = await res.json();
          store.setSystemHealth(data);
        }
      } catch { /* ignore */ }
    };
    fetchHealth();
    healthTimer = setInterval(fetchHealth, 10000);

    return () => {
      if (healthTimer) clearInterval(healthTimer);

      socket.off('godview:agent-output');
      socket.off('godview:status-change');
      socket.off('godview:activity');

      godViewSocketRefCount--;
      if (godViewSocketRefCount === 0 && godViewSocket) {
        godViewSocket.disconnect();
        godViewSocket = null;
      }
    };
  }, []);
}

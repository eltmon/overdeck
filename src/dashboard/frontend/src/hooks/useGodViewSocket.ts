/**
 * useGodViewSocket — God View real-time data hook (PAN-341, migrated PAN-433)
 *
 * Previously used socket.io. Now bridges from the main DashboardStore which
 * receives all domain events via WebSocket RPC (EventRouter).
 *
 * Data sources:
 *   - agent output → DashboardStore.agentOutputById (from agent.output_received events)
 *   - agent status → DashboardStore.agentsById (from agent.status_changed events)
 *   - activity → DashboardStore.recentActivity (from activity.updated events)
 *   - system health → REST polling /api/godview/system-health (unchanged)
 */

import { useEffect } from 'react';
import { create } from 'zustand';

export interface GodViewActivityEvent {
  agentId: string;
  timestamp: string;
  type: string;
  message: string;
}

export interface GodViewStore {
  // System health (REST polled)
  systemHealth: { cpu: number; memPercent: number; memUsed: number; memTotal: number } | null;
  setSystemHealth: (h: GodViewStore['systemHealth']) => void;

  // Focus state
  focusedAgentId: string | null;
  setFocusedAgentId: (id: string | null) => void;
}

export const useGodViewStore = create<GodViewStore>((set) => ({
  systemHealth: null,
  setSystemHealth: (h) => set({ systemHealth: h }),

  focusedAgentId: null,
  setFocusedAgentId: (id) => set({ focusedAgentId: id }),
}));

// Derived selectors from DashboardStore (replaces duplicate GodView state)
export const selectGodViewAgentOutput = (s: { agentOutputById: Record<string, string[]> }) =>
  s.agentOutputById;

let _lastAgentsById: Record<string, { status: string }> | undefined;
let _lastStatuses: Record<string, string> | undefined;
export const selectGodViewAgentStatuses = (s: { agentsById: Record<string, { status: string }> }) => {
  if (s.agentsById === _lastAgentsById && _lastStatuses) {
    return _lastStatuses;
  }
  const statuses: Record<string, string> = {};
  for (const [id, agent] of Object.entries(s.agentsById)) {
    statuses[id] = agent.status;
  }
  _lastAgentsById = s.agentsById;
  _lastStatuses = statuses;
  return statuses;
};

export const selectGodViewActivityFeed = (s: { recentActivity: unknown[] }) =>
  s.recentActivity as GodViewActivityEvent[];

export function useGodViewSocket(): void {
  const store = useGodViewStore();

  useEffect(() => {
    // Poll system health every 10s (REST endpoint, not event-sourced)
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
    };
  }, []);
}

/**
 * useAgentSetInvalidation (PAN-2893) — event-driven issues-pane refresh.
 *
 * The projects/issues pane loads over REST (`/api/issues/resource-allocated`)
 * on a 30s poll, while agent lifecycle already streams over /ws/rpc into the
 * store. This hook bridges the two: when the SET of agents changes (an agent
 * appeared or disappeared — the transitions that change resource allocation),
 * invalidate the `['command-deck-projects']` query so react-query refetches immediately.
 * Status-only churn (thinking/working flaps) is deliberately ignored, and a
 * debounce collapses convoy-spawn bursts into one refetch. The 30s poll stays
 * as the missed-event backstop.
 */
import { useEffect, useRef } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { useDashboardStore, selectAgents } from './store';

export const AGENT_SET_INVALIDATION_DEBOUNCE_MS = 1_000;

export function agentSetSignature(agents: Array<{ id: string }>): string {
  return agents.map((agent) => agent.id).sort().join('\n');
}

export function useAgentSetInvalidation(queryClient: QueryClient): void {
  const agents = useDashboardStore(selectAgents) as Array<{ id: string }>;
  const signature = agentSetSignature(agents);
  const lastSignature = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (lastSignature.current === null) {
      // First observation is the baseline, not a change.
      lastSignature.current = signature;
      return;
    }
    if (signature === lastSignature.current) return;
    lastSignature.current = signature;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void queryClient.invalidateQueries({ queryKey: ['command-deck-projects'] });
    }, AGENT_SET_INVALIDATION_DEBOUNCE_MS);
  }, [signature, queryClient]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
}

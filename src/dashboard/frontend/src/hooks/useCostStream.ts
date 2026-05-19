/**
 * useCostStream - Real-time cost updates hook
 *
 * Polls the /api/costs/stream endpoint for new cost events
 */

import { useQuery } from '@tanstack/react-query';
import { useState, useEffect } from 'react';

export interface CostEvent {
  ts: string;
  model: string;
  provider: string;
  cost: number;
  tokens: number;
}

interface CostStreamResponse {
  events: CostEvent[];
  byIssue: Record<string, CostEvent[]>;
  count: number;
}

async function fetchCostStream(since?: string, limit = 50): Promise<CostStreamResponse> {
  const params = new URLSearchParams();
  if (since) params.set('since', since);
  params.set('limit', limit.toString());

  const res = await fetch(`/api/costs/stream?${params}`);
  if (!res.ok) throw new Error('Failed to fetch cost stream');
  return res.json();
}

export interface UseCostStreamOptions {
  enabled?: boolean;
  pollInterval?: number; // ms, default 5000 (5 seconds)
  limit?: number;
}

export interface UseCostStreamResult {
  recentEvents: CostEvent[];
  eventsByIssue: Record<string, CostEvent[]>;
  isLoading: boolean;
  error: Error | null;
  totalCost: number;
  eventCount: number;
}

/**
 * Hook to stream real-time cost events
 */
export function useCostStream(options: UseCostStreamOptions = {}): UseCostStreamResult {
  const {
    enabled = true,
    pollInterval = 5000,
    limit = 50,
  } = options;

  const [lastFetchTime, setLastFetchTime] = useState<string | undefined>();

  const { data, isLoading, error } = useQuery({
    queryKey: ['cost-stream', lastFetchTime, limit],
    queryFn: () => fetchCostStream(lastFetchTime, limit),
    enabled,
    refetchInterval: pollInterval,
    refetchIntervalInBackground: true,
  });

  // Update lastFetchTime when we get new events
  useEffect(() => {
    if (data && data.events.length > 0) {
      const latestTs = data.events[data.events.length - 1].ts;
      setLastFetchTime(latestTs);
    }
  }, [data]);

  const totalCost = data?.events.reduce((sum, event) => sum + event.cost, 0) || 0;

  return {
    recentEvents: data?.events || [],
    eventsByIssue: data?.byIssue || {},
    isLoading,
    error: error as Error | null,
    totalCost,
    eventCount: data?.count || 0,
  };
}

/**
 * Hook to track cost for a specific issue in real-time
 */
export function useIssueCostStream(issueId: string, options: UseCostStreamOptions = {}) {
  const stream = useCostStream(options);

  const issueEvents = stream.eventsByIssue[issueId] || [];
  const issueCost = issueEvents.reduce((sum, event) => sum + event.cost, 0);

  return {
    ...stream,
    issueEvents,
    issueCost,
  };
}

import { useQuery } from '@tanstack/react-query';

export interface HandoffSuggestion {
  suggested: boolean;
  trigger: string | null;
  currentModel: string;
  suggestedModel: string | null;
  reason: string;
  estimatedSavings?: number;
}

export interface AgentCost {
  agentId: string;
  model: string;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
  };
  cost: number;
}

async function fetchHandoffSuggestion(agentId: string): Promise<HandoffSuggestion> {
  const res = await fetch(`/api/agents/${agentId}/handoff/suggestion`);
  if (!res.ok) throw new Error('Failed to fetch handoff suggestion');
  return res.json();
}

async function fetchAgentCost(agentId: string): Promise<AgentCost> {
  const res = await fetch(`/api/agents/${agentId}/cost`);
  if (!res.ok) throw new Error('Failed to fetch agent cost');
  return res.json();
}

export function useHandoffSuggestion(agentId: string) {
  return useQuery({
    queryKey: ['handoff-suggestion', agentId],
    queryFn: () => fetchHandoffSuggestion(agentId),
    refetchInterval: 30000, // Refresh every 30 seconds
  });
}

export function useAgentCost(agentId: string) {
  return useQuery({
    queryKey: ['agent-cost', agentId],
    queryFn: () => fetchAgentCost(agentId),
    refetchInterval: 60000, // Refresh every minute
  });
}

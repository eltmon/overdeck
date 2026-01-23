import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Brain, Cpu, RotateCcw, Loader2 } from 'lucide-react';
import { SpecialistAgentCard, type SpecialistAgent } from './SpecialistAgentCard';
import { IssueAgentCard, type IssueAgent, type CloisterHealth } from './IssueAgentCard';

interface CloisterHealthResponse {
  agents: CloisterHealth[];
}

interface AgentListProps {
  selectedAgent: string | null;
  onSelectAgent: (agentId: string | null) => void;
}

async function fetchAgents(): Promise<IssueAgent[]> {
  const res = await fetch('/api/agents');
  if (!res.ok) throw new Error('Failed to fetch agents');
  return res.json();
}

async function fetchSpecialists(): Promise<SpecialistAgent[]> {
  const res = await fetch('/api/specialists');
  if (!res.ok) throw new Error('Failed to fetch specialists');
  return res.json();
}

async function fetchCloisterHealth(): Promise<CloisterHealthResponse> {
  const res = await fetch('/api/cloister/agents/health');
  if (!res.ok) throw new Error('Failed to fetch Cloister health');
  return res.json();
}

async function resetAllSpecialists(): Promise<void> {
  const res = await fetch('/api/specialists/reset-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to reset specialists');
  }
}

export function AgentList({ selectedAgent, onSelectAgent }: AgentListProps) {
  const queryClient = useQueryClient();
  const { data: agents, isLoading: agentsLoading, error: agentsError } = useQuery({
    queryKey: ['agents'],
    queryFn: fetchAgents,
    refetchInterval: 3000,
  });

  const { data: specialists, isLoading: specialistsLoading } = useQuery({
    queryKey: ['specialists'],
    queryFn: fetchSpecialists,
    refetchInterval: 5000,
  });

  const { data: cloisterHealth } = useQuery({
    queryKey: ['cloister-health'],
    queryFn: fetchCloisterHealth,
    refetchInterval: 5000,
  });

  const resetAllMutation = useMutation({
    mutationFn: resetAllSpecialists,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['specialists'] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
    onError: (error: Error) => {
      alert(`Failed to reset specialists: ${error.message}`);
    },
  });

  const handleResetAll = () => {
    if (confirm('Reset ALL specialist agents?\n\nThis will kill any running specialists and clear their session files.')) {
      resetAllMutation.mutate();
    }
  };

  if (agentsLoading || specialistsLoading) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="text-gray-400">Loading agents...</div>
      </div>
    );
  }

  if (agentsError) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="text-red-400">Error: {(agentsError as Error).message}</div>
      </div>
    );
  }

  const runningAgents = agents?.filter((a) => a.status !== 'dead') || [];
  const enabledSpecialists = specialists?.filter((s) => s.enabled) || [];

  return (
    <div className="space-y-4">
      {/* Specialist Agents Section */}
      <div className="bg-gray-800 rounded-lg">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
          <h2 className="font-semibold text-white flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-400" />
            Specialist Agents ({enabledSpecialists.length})
          </h2>
          <button
            onClick={handleResetAll}
            disabled={resetAllMutation.isPending}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-400 hover:text-yellow-400 hover:bg-gray-700 rounded transition-colors disabled:opacity-50"
            title="Reset all specialists (kill & clear sessions)"
          >
            {resetAllMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RotateCcw className="w-3.5 h-3.5" />
            )}
            Reset All
          </button>
        </div>

        <div className="divide-y divide-gray-700">
          {enabledSpecialists.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No specialist agents configured.
            </div>
          ) : (
            enabledSpecialists.map((specialist) => (
              <SpecialistAgentCard
                key={specialist.name}
                specialist={specialist}
                onSelect={() =>
                  onSelectAgent(
                    specialist.tmuxSession === selectedAgent ? null : specialist.tmuxSession
                  )
                }
                isSelected={specialist.tmuxSession === selectedAgent}
              />
            ))
          )}
        </div>
      </div>

      {/* Issue Agents Section */}
      <div className="bg-gray-800 rounded-lg">
        <div className="px-4 py-3 border-b border-gray-700">
          <h2 className="font-semibold text-white flex items-center gap-2">
            <Cpu className="w-5 h-5" />
            Issue Agents ({runningAgents.length})
          </h2>
        </div>

        <div className="divide-y divide-gray-700">
          {runningAgents.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No agents running. Use{' '}
              <code className="bg-gray-700 px-2 py-1 rounded">/work-issue</code> to spawn one.
            </div>
          ) : (
            runningAgents.map((agent) => {
              const health = cloisterHealth?.agents.find((h) => h.agentId === agent.id);

              return (
                <IssueAgentCard
                  key={agent.id}
                  agent={agent}
                  health={health}
                  onSelect={() => onSelectAgent(agent.id === selectedAgent ? null : agent.id)}
                  isSelected={agent.id === selectedAgent}
                />
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

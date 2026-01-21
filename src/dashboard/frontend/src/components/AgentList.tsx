import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Agent } from '../types';
import { Square, Clock, Cpu, AlertTriangle, Activity } from 'lucide-react';

interface CloisterAgentHealth {
  agentId: string;
  state: 'active' | 'stale' | 'warning' | 'stuck';
  lastActivity: string | null;
  timeSinceActivity: number | null;
  isRunning: boolean;
}

interface CloisterHealthResponse {
  agents: CloisterAgentHealth[];
}

interface AgentListProps {
  selectedAgent: string | null;
  onSelectAgent: (agentId: string | null) => void;
}

async function fetchAgents(): Promise<Agent[]> {
  const res = await fetch('/api/agents');
  if (!res.ok) throw new Error('Failed to fetch agents');
  return res.json();
}

async function killAgent(agentId: string): Promise<void> {
  const res = await fetch(`/api/agents/${agentId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to kill agent');
}

async function fetchCloisterHealth(): Promise<CloisterHealthResponse> {
  const res = await fetch('/api/cloister/agents/health');
  if (!res.ok) throw new Error('Failed to fetch Cloister health');
  return res.json();
}

const STATUS_COLORS: Record<Agent['status'], string> = {
  healthy: 'bg-status-healthy',
  warning: 'bg-status-warning',
  stuck: 'bg-status-stuck',
  dead: 'bg-status-dead',
};

const HEALTH_STATE_EMOJI: Record<CloisterAgentHealth['state'], string> = {
  active: '🟢',
  stale: '🟡',
  warning: '🟠',
  stuck: '🔴',
};

const HEALTH_STATE_LABEL: Record<CloisterAgentHealth['state'], string> = {
  active: 'Active',
  stale: 'Stale',
  warning: 'Warning',
  stuck: 'Stuck',
};

const HEALTH_STATE_COLOR: Record<CloisterAgentHealth['state'], string> = {
  active: 'text-green-400',
  stale: 'text-yellow-400',
  warning: 'text-orange-400',
  stuck: 'text-red-400',
};

function formatDuration(startedAt: string): string {
  const start = new Date(startedAt);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);

  if (diffHours > 0) {
    return `${diffHours}h ${diffMins % 60}m`;
  }
  return `${diffMins}m`;
}

function formatTimeSince(ms: number | null): string {
  if (ms === null) return 'unknown';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ago`;
  } else if (minutes > 0) {
    return `${minutes}m ago`;
  } else {
    return `${seconds}s ago`;
  }
}

export function AgentList({ selectedAgent, onSelectAgent }: AgentListProps) {
  const queryClient = useQueryClient();

  const { data: agents, isLoading, error } = useQuery({
    queryKey: ['agents'],
    queryFn: fetchAgents,
    refetchInterval: 3000,
  });

  // Fetch Cloister health data
  const { data: cloisterHealth } = useQuery({
    queryKey: ['cloister-health'],
    queryFn: fetchCloisterHealth,
    refetchInterval: 5000,
  });

  const killMutation = useMutation({
    mutationFn: killAgent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });

  if (isLoading) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="text-gray-400">Loading agents...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="text-red-400">Error: {(error as Error).message}</div>
      </div>
    );
  }

  const runningAgents = agents?.filter((a) => a.status !== 'dead') || [];

  return (
    <div className="bg-gray-800 rounded-lg">
      <div className="px-4 py-3 border-b border-gray-700">
        <h2 className="font-semibold text-white flex items-center gap-2">
          <Cpu className="w-5 h-5" />
          Active Agents ({runningAgents.length})
        </h2>
      </div>

      <div className="divide-y divide-gray-700">
        {runningAgents.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No agents running. Use <code className="bg-gray-700 px-2 py-1 rounded">/work-issue</code> to spawn one.
          </div>
        ) : (
          runningAgents.map((agent) => {
            // Find Cloister health for this agent
            const health = cloisterHealth?.agents.find((h) => h.agentId === agent.id);

            return (
              <div
                key={agent.id}
                onClick={() => onSelectAgent(agent.id === selectedAgent ? null : agent.id)}
                className={`p-4 cursor-pointer transition-colors ${
                  selectedAgent === agent.id ? 'bg-gray-700' : 'hover:bg-gray-750'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${STATUS_COLORS[agent.status]}`} />
                    <div>
                      <div className="font-medium text-white flex items-center gap-2">
                        {agent.id}
                        {health && (
                          <span className={`text-xs ${HEALTH_STATE_COLOR[health.state]}`} title={`Cloister: ${HEALTH_STATE_LABEL[health.state]}`}>
                            {HEALTH_STATE_EMOJI[health.state]}
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-400">
                        {agent.runtime} / {agent.model}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="flex items-center gap-1 text-sm text-gray-400">
                        <Clock className="w-4 h-4" />
                        {formatDuration(agent.startedAt)}
                      </div>
                      {health && health.timeSinceActivity !== null && (
                        <div className="flex items-center gap-1 text-xs text-gray-500">
                          <Activity className="w-3 h-3" />
                          {formatTimeSince(health.timeSinceActivity)}
                        </div>
                      )}
                      {agent.consecutiveFailures > 0 && (
                        <div className="flex items-center gap-1 text-sm text-orange-400">
                          <AlertTriangle className="w-4 h-4" />
                          {agent.consecutiveFailures} failures
                        </div>
                      )}
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Kill agent ${agent.id}?`)) {
                          killMutation.mutate(agent.id);
                        }
                      }}
                      className="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-600 rounded"
                      title="Kill agent"
                    >
                      <Square className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

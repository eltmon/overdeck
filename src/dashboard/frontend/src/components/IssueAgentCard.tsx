import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Square, Clock, AlertTriangle, Activity, Bell, DollarSign, ArrowRightLeft, Play, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useAgentCost } from '../hooks/useHandoffData';
import { HandoffPanel } from './HandoffPanel';

export interface IssueAgent {
  id: string;
  status: 'healthy' | 'warning' | 'stuck' | 'dead';
  runtime: string;
  model: string;
  startedAt: string;
  consecutiveFailures: number;
}

export interface CloisterHealth {
  agentId: string;
  state: 'active' | 'stale' | 'warning' | 'stuck' | 'suspended';
  lastActivity: string | null;
  timeSinceActivity: number | null;
  isRunning: boolean;
}

interface IssueAgentCardProps {
  agent: IssueAgent;
  health?: CloisterHealth;
  onSelect?: () => void;
  isSelected?: boolean;
}

const STATUS_COLORS = {
  healthy: 'bg-status-healthy',
  warning: 'bg-status-warning',
  stuck: 'bg-status-stuck',
  dead: 'bg-status-dead',
};

const HEALTH_STATE_EMOJI = {
  active: '🟢',
  stale: '🟡',
  warning: '🟠',
  stuck: '🔴',
  suspended: '⏸️',
};

const HEALTH_STATE_LABEL = {
  active: 'Active',
  stale: 'Stale',
  warning: 'Warning',
  stuck: 'Stuck',
  suspended: 'Suspended',
};

const HEALTH_STATE_COLOR = {
  active: 'text-green-400',
  stale: 'text-yellow-400',
  warning: 'text-orange-400',
  stuck: 'text-red-400',
  suspended: 'text-blue-400',
};

async function killAgent(agentId: string): Promise<void> {
  const res = await fetch(`/api/agents/${agentId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to kill agent');
}

async function pokeAgent(agentId: string): Promise<void> {
  const res = await fetch(`/api/agents/${agentId}/poke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to poke agent');
  }
}

async function resumeAgent(agentId: string, message?: string): Promise<void> {
  const res = await fetch(`/api/agents/${agentId}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to resume agent');
  }
}

interface ActivityEntry {
  ts: string;
  tool: string;
  action?: string;
  state?: 'active' | 'idle';
}

async function fetchActivity(agentId: string): Promise<ActivityEntry[]> {
  const res = await fetch(`/api/agents/${agentId}/activity?limit=20`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.activity || [];
}

function useActivity(agentId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['activity', agentId],
    queryFn: () => fetchActivity(agentId),
    enabled,
    refetchInterval: 10000, // Refresh every 10 seconds
  });
}

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

export function IssueAgentCard({
  agent,
  health,
  onSelect,
  isSelected,
}: IssueAgentCardProps) {
  const queryClient = useQueryClient();
  const [showHandoffPanel, setShowHandoffPanel] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const { data: costData } = useAgentCost(agent.id);
  const { data: activityData } = useActivity(agent.id, health?.isRunning || health?.state === 'suspended');

  const killMutation = useMutation({
    mutationFn: () => killAgent(agent.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });

  const pokeMutation = useMutation({
    mutationFn: () => pokeAgent(agent.id),
    onSuccess: () => {
      // Show success message briefly
      alert(`Poked ${agent.id} successfully`);
    },
    onError: (error: Error) => {
      alert(`Failed to poke ${agent.id}: ${error.message}`);
    },
  });

  const resumeMutation = useMutation({
    mutationFn: (message?: string) => resumeAgent(agent.id, message),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
    onError: (error: Error) => {
      alert(`Failed to resume ${agent.id}: ${error.message}`);
    },
  });

  const handleKill = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Kill agent ${agent.id}?`)) {
      killMutation.mutate();
    }
  };

  const handlePoke = (e: React.MouseEvent) => {
    e.stopPropagation();
    pokeMutation.mutate();
  };

  const handleResume = (e: React.MouseEvent) => {
    e.stopPropagation();
    resumeMutation.mutate();
  };

  const toggleActivityExpanded = (e: React.MouseEvent) => {
    e.stopPropagation();
    setActivityExpanded(!activityExpanded);
  };

  const needsPoke = health?.state === 'warning' || health?.state === 'stuck';

  const toggleHandoffPanel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowHandoffPanel(!showHandoffPanel);
  };

  return (
    <div
      onClick={onSelect}
      className={`p-4 cursor-pointer transition-colors ${
        isSelected ? 'bg-gray-700' : 'hover:bg-gray-750'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${STATUS_COLORS[agent.status]}`} />
          <div>
            <div className="font-medium text-white flex items-center gap-2">
              {agent.id}
              {health && (
                <span
                  className={`text-xs ${HEALTH_STATE_COLOR[health.state]}`}
                  title={`Cloister: ${HEALTH_STATE_LABEL[health.state]}`}
                >
                  {HEALTH_STATE_EMOJI[health.state]}
                </span>
              )}
            </div>
            <div className="text-sm text-gray-400 flex items-center gap-2">
              {agent.runtime} / {agent.model}
              {costData && costData.cost > 0 && (
                <span
                  className="flex items-center gap-1 text-xs text-emerald-400"
                  title="Agent cost so far"
                >
                  <DollarSign className="w-3 h-3" />
                  ${costData.cost.toFixed(4)}
                </span>
              )}
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

          <div className="flex items-center gap-2">
            {/* Activity button - for all running/suspended agents */}
            {health && (health.isRunning || health.state === 'suspended') && activityData && activityData.length > 0 && (
              <button
                onClick={toggleActivityExpanded}
                className="p-2 text-gray-400 hover:text-blue-400 hover:bg-gray-600 rounded"
                title={`Show activity history (${activityData.length} entries)`}
              >
                <Activity className="w-4 h-4" />
              </button>
            )}

            {/* Handoff button */}
            <button
              onClick={toggleHandoffPanel}
              className={`p-2 hover:bg-gray-600 rounded ${
                showHandoffPanel ? 'text-blue-400' : 'text-gray-400 hover:text-blue-400'
              }`}
              title="Model handoff controls"
            >
              <ArrowRightLeft className="w-4 h-4" />
            </button>

            {/* Resume button - only for suspended */}
            {health?.state === 'suspended' && (
              <button
                onClick={handleResume}
                disabled={resumeMutation.isPending}
                className="p-2 text-gray-400 hover:text-green-400 hover:bg-gray-600 rounded disabled:opacity-50"
                title="Resume agent"
              >
                <Play className="w-4 h-4" />
              </button>
            )}

            {/* Poke button - only for warning/stuck */}
            {needsPoke && (
              <button
                onClick={handlePoke}
                disabled={pokeMutation.isPending}
                className="p-2 text-gray-400 hover:text-yellow-400 hover:bg-gray-600 rounded"
                title="Poke agent (send nudge message)"
              >
                <Bell className="w-4 h-4" />
              </button>
            )}

            {/* Kill button - not for suspended */}
            {health?.state !== 'suspended' && (
              <button
                onClick={handleKill}
                disabled={killMutation.isPending}
                className="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-600 rounded"
                title="Kill agent"
              >
                <Square className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Handoff Panel */}
      {showHandoffPanel && (
        <div className="mt-3 pt-3 border-t border-gray-700">
          <HandoffPanel agentId={agent.id} />
        </div>
      )}

      {/* Activity history section (PAN-80) */}
      {activityExpanded && activityData && activityData.length > 0 && (
        <div className="mt-3 pl-8 border-l-2 border-gray-600">
          <div className="text-xs text-gray-400 font-medium mb-2">
            Recent Activity ({activityData.length})
          </div>
          <div className="space-y-1">
            {activityData.slice().reverse().map((entry, index) => (
              <div key={index} className="flex items-center gap-2 bg-gray-750 px-3 py-1.5 rounded text-xs">
                <span className="text-gray-500">
                  {new Date(entry.ts).toLocaleTimeString()}
                </span>
                <span className="text-blue-400 font-mono">{entry.tool}</span>
                {entry.action && (
                  <span className="text-gray-400 truncate">
                    {entry.action.substring(0, 50)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

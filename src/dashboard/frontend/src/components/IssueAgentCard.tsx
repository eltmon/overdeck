import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Square, Clock, AlertTriangle, Activity, Bell, DollarSign, ArrowRightLeft, Play } from 'lucide-react';
import { useState } from 'react';
import { useAgentCost } from '../hooks/useHandoffData';
import { HandoffPanel } from './HandoffPanel';
import { useConfirmDialog } from './ConfirmDialogProvider';
import { useNotification } from './NotificationProvider';

export interface IssueAgent {
  id: string;
  status: 'healthy' | 'warning' | 'stuck' | 'dead' | 'stopped';
  runtime: string;
  model: string;
  startedAt: string;
  consecutiveFailures: number;
  contextPercent?: number | null;
  initialContextPercent?: number | null;
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

const STATUS_COLORS: Record<string, string> = {
  healthy: 'bg-status-healthy',
  warning: 'bg-status-warning',
  stuck: 'bg-status-stuck',
  dead: 'bg-status-dead',
  stopped: 'bg-gray-500',
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
  const { confirm } = useConfirmDialog();
  const { notify } = useNotification();
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
      notify({ type: 'success', message: `Poked ${agent.id} successfully` });
    },
    onError: (error: Error) => {
      notify({ type: 'error', message: `Failed to poke ${agent.id}: ${error.message}` });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: (message?: string) => resumeAgent(agent.id, message),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
    onError: (error: Error) => {
      notify({ type: 'error', message: `Failed to resume ${agent.id}: ${error.message}` });
    },
  });

  const handleKill = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (await confirm({ message: `Kill agent ${agent.id}?`, variant: 'danger', title: 'Kill Agent', confirmLabel: 'Kill' })) {
      killMutation.mutate();
    }
  };

  const handlePoke = (e: React.MouseEvent) => {
    e.stopPropagation();
    pokeMutation.mutate();
  };

  const handleResume = (e: React.MouseEvent) => {
    e.stopPropagation();
    resumeMutation.mutate(undefined);
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
        isSelected ? 'bg-surface-overlay' : 'hover:bg-gray-750'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${STATUS_COLORS[agent.status]}`} />
          <div>
            <div className="font-medium text-content flex items-center gap-2">
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
            <div className="text-sm text-content-subtle flex items-center gap-2">
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
              {agent.contextPercent != null && (
                <span
                  className="flex items-center gap-1.5 text-xs"
                  title={`Context: ${agent.contextPercent}%${agent.initialContextPercent ? ` (init: ${agent.initialContextPercent}%)` : ''}`}
                >
                  <span className="w-14 h-1.5 bg-gray-700 rounded-full overflow-hidden inline-block">
                    <span
                      className={`block h-full rounded-full transition-all ${
                        agent.contextPercent > 80 ? 'bg-red-500' :
                        agent.contextPercent > 50 ? 'bg-yellow-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${Math.min(agent.contextPercent, 100)}%` }}
                    />
                  </span>
                  <span className={
                    agent.contextPercent > 80 ? 'text-red-400' :
                    agent.contextPercent > 50 ? 'text-yellow-400' : 'text-content-muted'
                  }>
                    {agent.contextPercent}%
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="flex items-center gap-1 text-sm text-content-subtle">
              <Clock className="w-4 h-4" />
              {formatDuration(agent.startedAt)}
            </div>
            {health && health.timeSinceActivity !== null && (
              <div className="flex items-center gap-1 text-xs text-content-muted">
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
                className="p-2 text-content-subtle hover:text-blue-400 hover:bg-surface-emphasis rounded"
                title={`Show activity history (${activityData.length} entries)`}
              >
                <Activity className="w-4 h-4" />
              </button>
            )}

            {/* Handoff button - not for stopped agents */}
            {agent.status !== 'stopped' && (
              <button
                onClick={toggleHandoffPanel}
                className={`p-2 hover:bg-surface-emphasis rounded ${
                  showHandoffPanel ? 'text-blue-400' : 'text-content-subtle hover:text-blue-400'
                }`}
                title="Model handoff controls"
              >
                <ArrowRightLeft className="w-4 h-4" />
              </button>
            )}

            {/* Resume button - only for suspended */}
            {health?.state === 'suspended' && (
              <button
                onClick={handleResume}
                disabled={resumeMutation.isPending}
                className="p-2 text-content-subtle hover:text-green-400 hover:bg-surface-emphasis rounded disabled:opacity-50"
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
                className="p-2 text-content-subtle hover:text-yellow-400 hover:bg-surface-emphasis rounded"
                title="Poke agent (send nudge message)"
              >
                <Bell className="w-4 h-4" />
              </button>
            )}

            {/* Kill button - not for suspended or already stopped */}
            {health?.state !== 'suspended' && agent.status !== 'stopped' && (
              <button
                onClick={handleKill}
                disabled={killMutation.isPending}
                className="p-2 text-content-subtle hover:text-red-400 hover:bg-surface-emphasis rounded"
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
        <div className="mt-3 pt-3 border-t border-divider">
          <HandoffPanel agentId={agent.id} />
        </div>
      )}

      {/* Activity history section (PAN-80) */}
      {activityExpanded && activityData && activityData.length > 0 && (
        <div className="mt-3 pl-8 border-l-2 border-divider-strong">
          <div className="text-xs text-content-subtle font-medium mb-2">
            Recent Activity ({activityData.length})
          </div>
          <div className="space-y-1">
            {activityData.slice().reverse().map((entry, index) => (
              <div key={index} className="flex items-center gap-2 bg-gray-750 px-3 py-1.5 rounded text-xs">
                <span className="text-content-muted">
                  {new Date(entry.ts).toLocaleTimeString()}
                </span>
                <span className="text-blue-400 font-mono">{entry.tool}</span>
                {entry.action && (
                  <span className="text-content-subtle truncate">
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

import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Square, Clock, AlertTriangle, Activity, Bell, DollarSign, ArrowRightLeft, Play, Radio } from 'lucide-react';
import { useState } from 'react';
import { useSharedTick } from '../lib/useSharedTick';
import { formatRelativeTime } from '../lib/formatRelativeTime';
import { useAgentCost } from '../hooks/useHandoffData';
import { HandoffPanel } from './HandoffPanel';
import { useConfirm, useAlert } from './DialogProvider';

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
  stopped: 'bg-muted-foreground',
  running: 'bg-status-healthy',
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
  active: 'text-success',
  stale: 'text-warning',
  warning: 'text-warning-foreground',
  stuck: 'text-destructive',
  suspended: 'text-primary',
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


function stalenessClass(ms: number): string {
  if (ms < 2 * 60_000) return 'text-success';
  if (ms < 10 * 60_000) return 'text-warning';
  if (ms < 30 * 60_000) return 'text-orange-400';
  return 'text-destructive';
}

function LiveLastHeard({ lastActivity }: { lastActivity: string | null }) {
  const now = useSharedTick();
  if (!lastActivity) return null;
  const ms = now.getTime() - new Date(lastActivity).getTime();
  if (ms < 1000) return null;
  const label = formatRelativeTime(lastActivity, now);
  const cls = stalenessClass(ms);
  return (
    <div className={`flex items-center gap-1 text-xs ${cls}`} title={`Last heard: ${label}`}>
      <Radio className="w-3 h-3" />
      {label}
    </div>
  );
}

export function IssueAgentCard({
  agent,
  health,
  onSelect,
  isSelected,
}: IssueAgentCardProps) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const showAlert = useAlert();
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
      showAlert({ message: `Poked ${agent.id} successfully`, variant: 'success' });
    },
    onError: (error: Error) => {
      showAlert({ message: `Failed to poke ${agent.id}: ${error.message}`, variant: 'error' });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: (message?: string) => resumeAgent(agent.id, message),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
    onError: (error: Error) => {
      showAlert({ message: `Failed to resume ${agent.id}: ${error.message}`, variant: 'error' });
    },
  });

  const handleKill = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (await confirm({ title: 'Kill Agent', message: `Kill agent ${agent.id}?`, variant: 'destructive', confirmLabel: 'Kill' })) {
      killMutation.mutate();
    }
  };

  const handlePoke = (e: React.MouseEvent) => {
    e.stopPropagation();
    pokeMutation.mutate();
  };

  const handleResume = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Open the workspace detail pane where the user can type a resume message
    onSelect?.();
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
        isSelected ? 'bg-popover' : 'hover:bg-muted'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${STATUS_COLORS[agent.status]} ${agent.status === 'healthy' ? 'animate-pulse' : ''}`} />
          <div>
            <div className="font-medium text-foreground flex items-center gap-2">
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
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              {agent.runtime} / {agent.model}
              {costData && costData.cost > 0 && (
                <span
                  className="flex items-center gap-1 text-xs text-success"
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
                  <span className="w-14 h-1.5 bg-muted rounded-full overflow-hidden inline-block">
                    <span
                      className={`block h-full rounded-full transition-all ${
                        agent.contextPercent > 80 ? 'bg-destructive' :
                        agent.contextPercent > 50 ? 'bg-warning' : 'bg-success'
                      }`}
                      style={{ width: `${Math.min(agent.contextPercent, 100)}%` }}
                    />
                  </span>
                  <span className={
                    agent.contextPercent > 80 ? 'text-destructive' :
                    agent.contextPercent > 50 ? 'text-warning' : 'text-muted-foreground'
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
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Clock className="w-4 h-4" />
              {formatDuration(agent.startedAt)}
            </div>
            {health && (
              <LiveLastHeard lastActivity={health.lastActivity} />
            )}
            {agent.consecutiveFailures > 0 && (
              <div className="flex items-center gap-1 text-sm text-warning-foreground">
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
                className="p-2 text-muted-foreground hover:text-primary hover:bg-card rounded"
                title={`Show activity history (${activityData.length} entries)`}
              >
                <Activity className="w-4 h-4" />
              </button>
            )}

            {/* Handoff button - not for stopped agents */}
            {agent.status !== 'stopped' && (
              <button
                onClick={toggleHandoffPanel}
                className={`p-2 hover:bg-card rounded ${
                  showHandoffPanel ? 'text-primary' : 'text-muted-foreground hover:text-primary'
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
                className="p-2 text-muted-foreground hover:text-success hover:bg-card rounded disabled:opacity-50"
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
                className="p-2 text-muted-foreground hover:text-warning hover:bg-card rounded"
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
                className="p-2 text-muted-foreground hover:text-destructive hover:bg-card rounded"
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
        <div className="mt-3 pt-3 border-t border-border">
          <HandoffPanel agentId={agent.id} />
        </div>
      )}

      {/* Activity history section (PAN-80) */}
      {activityExpanded && activityData && activityData.length > 0 && (
        <div className="mt-3 pl-8 border-l-2 border-border">
          <div className="text-xs text-muted-foreground font-medium mb-2">
            Recent Activity ({activityData.length})
          </div>
          <div className="space-y-1">
            {activityData.slice().reverse().map((entry, index) => (
              <div key={index} className="flex items-center gap-2 bg-muted px-3 py-1.5 rounded text-xs">
                <span className="text-muted-foreground">
                  {new Date(entry.ts).toLocaleTimeString()}
                </span>
                <span className="text-primary font-mono">{entry.tool}</span>
                {entry.action && (
                  <span className="text-muted-foreground truncate">
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

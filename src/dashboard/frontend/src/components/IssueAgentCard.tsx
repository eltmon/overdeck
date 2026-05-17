import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Square, Clock, AlertTriangle, Activity, Bell, DollarSign, ArrowRightLeft, Play, Radio, RotateCcw, Pause, Unlock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSharedTick } from '../lib/useSharedTick';
import { formatRelativeTime } from '../lib/formatRelativeTime';
import { useAgentCost } from '../hooks/useHandoffData';
import { HandoffPanel } from './HandoffPanel';
import { useConfirm, useAlert } from './DialogProvider';
import { getHarness } from '@panctl/contracts';
import { ModelHarnessPicker, useAvailableModels, type Harness } from './shared/ModelPicker';
import { NO_RESUME_QUERY_KEY, type NoResumeMode } from './NoResumeBanner';

export interface IssueAgent {
  id: string;
  issueId?: string | null;
  status: 'healthy' | 'warning' | 'stuck' | 'dead' | 'stopped';
  runtime: string;
  model: string;
  startedAt: string;
  consecutiveFailures: number;
  stoppedByUser?: boolean;
  paused?: boolean;
  pausedReason?: string;
  pausedAt?: string;
  troubled?: boolean;
  troubledAt?: string;
  lastFailureAt?: string;
  lastFailureReason?: string;
  lastFailureNextRetryAt?: string;
  contextPercent?: number | null;
  initialContextPercent?: number | null;
  runtimeState?: string;
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

type AgentPauseFields = Pick<IssueAgent, 'paused' | 'pausedReason' | 'pausedAt'>;

async function pauseAgent(agentId: string, reason?: string): Promise<AgentPauseFields> {
  const res = await fetch(`/api/agents/${agentId}/pause`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reason ? { reason } : {}),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to pause agent');
  }
  const data = await res.json().catch(() => ({}));
  return data.agent ?? {};
}

async function unpauseAgent(agentId: string): Promise<void> {
  const res = await fetch(`/api/agents/${agentId}/unpause`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to unpause agent');
  }
}

async function clearTroubledAgent(agentId: string): Promise<void> {
  const res = await fetch(`/api/agents/${agentId}/untroubled`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to clear troubled state');
  }
}

async function startAgent(issueId: string, model: string, harness: Harness): Promise<void> {
  const res = await fetch('/api/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ issueId, model, harness }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to start agent');
  }
}

function inferIssueId(agent: IssueAgent): string | undefined {
  if (agent.issueId) return agent.issueId;
  return agent.id.match(/[A-Z][A-Z0-9]*-\d+/)?.[0];
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
  const [showPauseReason, setShowPauseReason] = useState(false);
  const [pauseReason, setPauseReason] = useState('');
  const { groups: modelGroups, defaultModel, harnessPolicy } = useAvailableModels();
  const [launchModel, setLaunchModel] = useState(agent.model || defaultModel);
  const [launchHarness, setLaunchHarness] = useState<Harness>(getHarness(agent) === 'pi' ? 'pi' : 'claude-code');
  const issueId = inferIssueId(agent);
  const now = useSharedTick();
  const noResumeMode = queryClient.getQueryData<NoResumeMode>(NO_RESUME_QUERY_KEY);
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

  const pauseMutation = useMutation({
    mutationFn: (reason?: string) => pauseAgent(agent.id, reason),
    onSuccess: (updated, reason) => {
      queryClient.setQueryData<IssueAgent[]>(['agents'], (agents) => agents?.map((item) => (
        item.id === agent.id
          ? {
              ...item,
              paused: true,
              pausedReason: updated.pausedReason ?? reason,
              pausedAt: updated.pausedAt ?? new Date().toISOString(),
            }
          : item
      )));
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      setShowPauseReason(false);
      setPauseReason('');
      showAlert({ message: `Paused ${agent.id}`, variant: 'success' });
    },
    onError: (error: Error) => {
      showAlert({ message: `Failed to pause ${agent.id}: ${error.message}`, variant: 'error' });
    },
  });

  const unpauseMutation = useMutation({
    mutationFn: () => unpauseAgent(agent.id),
    onSuccess: () => {
      queryClient.setQueryData<IssueAgent[]>(['agents'], (agents) => agents?.map((item) => (
        item.id === agent.id
          ? {
              ...item,
              paused: false,
              pausedReason: undefined,
              pausedAt: undefined,
            }
          : item
      )));
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      showAlert({ message: `Unpaused ${agent.id}`, variant: 'success' });
    },
    onError: (error: Error) => {
      showAlert({ message: `Failed to unpause ${agent.id}: ${error.message}`, variant: 'error' });
    },
  });

  const clearTroubledMutation = useMutation({
    mutationFn: () => clearTroubledAgent(agent.id),
    onSuccess: () => {
      queryClient.setQueryData<IssueAgent[]>(['agents'], (agents) => agents?.map((item) => (
        item.id === agent.id
          ? {
              ...item,
              troubled: false,
              troubledAt: undefined,
              consecutiveFailures: 0,
              lastFailureAt: undefined,
              lastFailureReason: undefined,
              lastFailureNextRetryAt: undefined,
            }
          : item
      )));
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      showAlert({ message: `Cleared troubled state for ${agent.id}`, variant: 'success' });
    },
    onError: (error: Error) => {
      showAlert({ message: `Failed to clear troubled state for ${agent.id}: ${error.message}`, variant: 'error' });
    },
  });

  const startMutation = useMutation({
    mutationFn: () => {
      if (!issueId) throw new Error('No issue ID available for this agent');
      return startAgent(issueId, launchModel, launchHarness);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      showAlert({ message: `Started agent for ${issueId}`, variant: 'success' });
    },
    onError: (error: Error) => {
      showAlert({ message: `Failed to start agent: ${error.message}`, variant: 'error' });
    },
  });

  useEffect(() => {
    if (!agent.model && defaultModel) setLaunchModel(defaultModel);
  }, [agent.model, defaultModel]);

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

  const handleShowPauseReason = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowPauseReason(true);
  };

  const handlePauseSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const reason = pauseReason.trim();
    pauseMutation.mutate(reason || undefined);
  };

  const handlePauseCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowPauseReason(false);
    setPauseReason('');
  };

  const handleUnpause = (e: React.MouseEvent) => {
    e.stopPropagation();
    unpauseMutation.mutate();
  };

  const handleClearTroubled = (e: React.MouseEvent) => {
    e.stopPropagation();
    clearTroubledMutation.mutate();
  };

  const handleStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    startMutation.mutate();
  };

  const toggleActivityExpanded = (e: React.MouseEvent) => {
    e.stopPropagation();
    setActivityExpanded(!activityExpanded);
  };

  const needsPoke = health?.state === 'warning' || health?.state === 'stuck';
  const failureTitle = [
    `${agent.consecutiveFailures} consecutive failure${agent.consecutiveFailures === 1 ? '' : 's'}`,
    agent.lastFailureReason ? `Last reason: ${agent.lastFailureReason}` : undefined,
    agent.lastFailureAt ? `Last failure: ${formatRelativeTime(agent.lastFailureAt, now)}` : undefined,
    agent.lastFailureNextRetryAt ? `Next retry: ${formatRelativeTime(agent.lastFailureNextRetryAt, now)}` : undefined,
  ].filter(Boolean).join('\n');
  const pausedTitle = [
    'Paused',
    agent.pausedReason ? `Reason: ${agent.pausedReason}` : undefined,
    agent.pausedAt ? `Paused: ${formatRelativeTime(agent.pausedAt, now)}` : undefined,
  ].filter(Boolean).join('\n');
  const isRunning = health?.isRunning === true || (health === undefined && agent.status === 'healthy');
  const isCompletedStopped = agent.status === 'stopped' && agent.runtimeState === 'completed' && agent.paused !== true && agent.troubled !== true;
  const gatingReason = !isRunning && !isCompletedStopped
    ? agent.paused === true
      ? 'Paused'
      : agent.troubled === true
        ? `Troubled (${agent.consecutiveFailures} failure${agent.consecutiveFailures === 1 ? '' : 's'})`
        : noResumeMode?.active === true
          ? 'Boot --no-resume'
          : agent.stoppedByUser === true
            ? 'Manual'
            : undefined
    : undefined;
  const gatingTitle = gatingReason === 'Boot --no-resume' && noResumeMode?.since
    ? `No-resume mode active since ${formatRelativeTime(noResumeMode.since, now)}`
    : gatingReason;

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
              {agent.paused === true && (
                <span
                  className="px-1.5 py-0.5 rounded border border-border bg-muted text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                  title={pausedTitle}
                  data-testid="issue-agent-card-paused-badge"
                >
                  Paused
                </span>
              )}
              {agent.troubled === true && (
                <span
                  className="px-1.5 py-0.5 rounded bg-destructive/15 text-[10px] font-medium uppercase tracking-wide text-destructive"
                  title={failureTitle || 'Troubled'}
                  data-testid="issue-agent-card-troubled-badge"
                >
                  Troubled
                </span>
              )}
            </div>
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide ${
                  getHarness(agent) === 'pi'
                    ? 'bg-purple-500/15 text-purple-300'
                    : 'bg-blue-500/15 text-blue-300'
                }`}
                title={`Coding-agent harness: ${getHarness(agent)}`}
                data-testid="agent-harness-badge"
              >
                {getHarness(agent)}
              </span>
              <span>/ {agent.model}</span>
              {gatingReason && (
                <span
                  className="px-1.5 py-0.5 rounded bg-orange-500/15 text-[10px] font-medium uppercase tracking-wide text-orange-300"
                  title={gatingTitle}
                  data-testid="issue-agent-card-gating-reason"
                >
                  {gatingReason}
                </span>
              )}
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
              <div className="flex items-center gap-1 text-sm text-warning-foreground" title={failureTitle}>
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

            {agent.paused === true ? (
              <button
                onClick={handleUnpause}
                disabled={unpauseMutation.isPending}
                className="p-2 text-muted-foreground hover:text-success hover:bg-card rounded disabled:opacity-50"
                title={agent.pausedReason ? `Unpause agent (${agent.pausedReason})` : 'Unpause agent'}
                data-testid="issue-agent-card-unpause"
              >
                <Unlock className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleShowPauseReason}
                disabled={pauseMutation.isPending}
                className="p-2 text-muted-foreground hover:text-warning hover:bg-card rounded disabled:opacity-50"
                title="Pause agent"
                data-testid="issue-agent-card-pause"
              >
                <Pause className="w-4 h-4" />
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

            {/* Clear troubled state - only for troubled agents */}
            {agent.troubled === true && (
              <button
                onClick={handleClearTroubled}
                disabled={clearTroubledMutation.isPending}
                className="p-2 text-muted-foreground hover:text-success hover:bg-card rounded disabled:opacity-50"
                title={failureTitle ? `Clear troubled state\n${failureTitle}` : 'Clear troubled state'}
                data-testid="issue-agent-card-clear-troubled"
              >
                <RotateCcw className="w-4 h-4" />
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

      {showPauseReason && agent.paused !== true && (
        <form
          className="mt-3 pt-3 border-t border-border flex items-center gap-2"
          onClick={(e) => e.stopPropagation()}
          onSubmit={handlePauseSubmit}
        >
          <input
            type="text"
            value={pauseReason}
            onChange={(e) => setPauseReason(e.target.value)}
            placeholder="Reason (optional)"
            className="min-w-0 flex-1 px-3 py-2 rounded bg-background border border-border text-sm"
            disabled={pauseMutation.isPending}
            data-testid="issue-agent-card-pause-reason"
          />
          <button
            type="submit"
            disabled={pauseMutation.isPending}
            className="px-3 py-2 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 text-sm"
            data-testid="issue-agent-card-pause-submit"
          >
            {pauseMutation.isPending ? 'Pausing…' : 'Pause'}
          </button>
          <button
            type="button"
            onClick={handlePauseCancel}
            disabled={pauseMutation.isPending}
            className="px-3 py-2 rounded bg-card text-muted-foreground hover:text-foreground disabled:opacity-50 text-sm"
          >
            Cancel
          </button>
        </form>
      )}

      {agent.status === 'stopped' && (
        <div
          className="mt-3 pt-3 border-t border-border space-y-3"
          onClick={(e) => e.stopPropagation()}
        >
          <ModelHarnessPicker
            model={launchModel}
            harness={launchHarness}
            onModelChange={setLaunchModel}
            onHarnessChange={setLaunchHarness}
            groups={modelGroups}
            harnessPolicy={harnessPolicy}
            modelLabel="Agent model"
          />
          <button
            type="button"
            onClick={handleStart}
            disabled={startMutation.isPending || !issueId}
            className="inline-flex items-center gap-2 px-3 py-2 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            title={issueId ? 'Start agent' : 'No issue ID available for this agent'}
            data-testid="issue-agent-card-start-agent"
          >
            <Play className="w-4 h-4" />
            {startMutation.isPending ? 'Starting…' : 'Start agent'}
          </button>
        </div>
      )}

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

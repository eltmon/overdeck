import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Brain, RotateCcw, Power, XCircle, Loader2, ChevronDown, ChevronRight, Trash2, MoveUp, MoveDown, Play, Activity } from 'lucide-react';
import { useState } from 'react';
import { useConfirm, useAlert } from './DialogProvider';

export interface SpecialistAgent {
  name: 'merge-agent' | 'review-agent' | 'test-agent';
  displayName: string;
  description: string;
  enabled: boolean;
  autoWake: boolean;
  sessionId?: string;
  lastWake?: string;
  contextTokens?: number;
  state: 'sleeping' | 'active' | 'uninitialized' | 'suspended';
  isRunning: boolean;
  tmuxSession: string;
  currentIssue?: string; // Issue ID currently being worked on
}

export interface IssueInfo {
  id: string;
  identifier: string;
  title: string;
}

interface SpecialistAgentCardProps {
  specialist: SpecialistAgent;
  issueInfo?: IssueInfo; // Info about the current issue being worked on
  onSelect?: () => void;
  isSelected?: boolean;
}

const STATE_EMOJI = {
  sleeping: '😴',
  active: '🟢',
  uninitialized: '⚪',
  suspended: '⏸️',
};

const STATE_LABEL = {
  sleeping: 'Sleeping',
  active: 'Active',
  uninitialized: 'Not Initialized',
  suspended: 'Suspended',
};

const STATE_COLOR = {
  sleeping: 'text-primary',
  active: 'text-success',
  uninitialized: 'text-muted-foreground',
  suspended: 'text-warning',
};

async function wakeSpecialist(name: string): Promise<void> {
  const res = await fetch(`/api/specialists/${name}/wake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to wake specialist');
  }
}

async function resetSpecialist(name: string): Promise<void> {
  const res = await fetch(`/api/specialists/${name}/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reinitialize: false }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to reset specialist');
  }
}

async function killSpecialist(tmuxSession: string): Promise<void> {
  const res = await fetch(`/api/agents/${tmuxSession}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to kill specialist');
}

async function resumeAgent(tmuxSession: string, message?: string): Promise<void> {
  const res = await fetch(`/api/agents/${tmuxSession}/resume`, {
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

async function fetchActivity(tmuxSession: string): Promise<ActivityEntry[]> {
  const res = await fetch(`/api/agents/${tmuxSession}/activity?limit=20`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.activity || [];
}

interface SpecialistCost {
  cost: number;
  inputTokens: number;
  outputTokens: number;
}

async function fetchSpecialistCost(name: string): Promise<SpecialistCost> {
  const res = await fetch(`/api/specialists/${name}/cost`);
  if (!res.ok) return { cost: 0, inputTokens: 0, outputTokens: 0 };
  return res.json();
}

function useSpecialistCost(name: string, enabled: boolean) {
  return useQuery({
    queryKey: ['specialist-cost', name],
    queryFn: () => fetchSpecialistCost(name),
    enabled,
    refetchInterval: 10000, // Refresh every 10 seconds
  });
}

// Queue types and functions (PAN-74)
interface TaskContext {
  prUrl?: string;
  workspace?: string;
  branch?: string;
  filesChanged?: string[];
  reason?: string;
  targetModel?: string;
  additionalInstructions?: string;
  [key: string]: string | string[] | undefined;
}

interface QueueItem {
  id: string;
  type: 'task' | 'message' | 'notification';
  priority: 'urgent' | 'high' | 'normal' | 'low';
  source: string;
  payload: {
    issueId?: string;
    message?: string;
    action?: string;
    context?: TaskContext;
  };
  createdAt: string;
  expiresAt?: string;
}

interface QueueData {
  specialistName: string;
  hasWork: boolean;
  urgentCount: number;
  totalCount: number;
  items: QueueItem[];
}

async function fetchSpecialistQueue(name: string): Promise<QueueData> {
  const res = await fetch(`/api/specialists/${name}/queue`);
  if (!res.ok) {
    return { specialistName: name, hasWork: false, urgentCount: 0, totalCount: 0, items: [] };
  }
  return res.json();
}

async function removeQueueItem(specialistName: string, itemId: string): Promise<void> {
  const res = await fetch(`/api/specialists/${specialistName}/queue/${itemId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to remove queue item');
  }
}

async function reorderQueue(specialistName: string, itemIds: string[]): Promise<void> {
  const res = await fetch(`/api/specialists/${specialistName}/queue/reorder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemIds }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to reorder queue');
  }
}

function useSpecialistQueue(name: string) {
  return useQuery({
    queryKey: ['specialist-queue', name],
    queryFn: () => fetchSpecialistQueue(name),
    refetchInterval: 5000, // Refresh every 5 seconds
  });
}

function useActivity(tmuxSession: string, enabled: boolean) {
  return useQuery({
    queryKey: ['activity', tmuxSession],
    queryFn: () => fetchActivity(tmuxSession),
    enabled,
    refetchInterval: 10000, // Refresh every 10 seconds
  });
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  } else if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return tokens.toString();
}

function formatLastWake(timestamp: string | undefined): string {
  if (!timestamp) return 'Never';

  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays}d ago`;
  } else if (diffHours > 0) {
    return `${diffHours}h ago`;
  } else if (diffMins > 0) {
    return `${diffMins}m ago`;
  } else {
    return 'Just now';
  }
}

export function SpecialistAgentCard({
  specialist,
  issueInfo,
  onSelect,
  isSelected,
}: SpecialistAgentCardProps) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const showAlert = useAlert();
  const { data: costData } = useSpecialistCost(specialist.name, specialist.state !== 'uninitialized');
  const { data: queueData } = useSpecialistQueue(specialist.name);
  const { data: activityData } = useActivity(specialist.tmuxSession, specialist.state !== 'uninitialized');
  const [queueExpanded, setQueueExpanded] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);

  const wakeMutation = useMutation({
    mutationFn: () => wakeSpecialist(specialist.name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['specialists'] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
    onError: (error: Error) => {
      showAlert({ message: `Failed to wake ${specialist.displayName}: ${error.message}`, variant: 'error' });
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => resetSpecialist(specialist.name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['specialists'] });
    },
    onError: (error: Error) => {
      showAlert({ message: `Failed to reset ${specialist.displayName}: ${error.message}`, variant: 'error' });
    },
  });

  const killMutation = useMutation({
    mutationFn: () => killSpecialist(specialist.tmuxSession),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['specialists'] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: (message?: string) => resumeAgent(specialist.tmuxSession, message),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['specialists'] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
    onError: (error: Error) => {
      showAlert({ message: `Failed to resume ${specialist.displayName}: ${error.message}`, variant: 'error' });
    },
  });

  const removeQueueItemMutation = useMutation({
    mutationFn: (itemId: string) => removeQueueItem(specialist.name, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['specialist-queue', specialist.name] });
    },
    onError: (error: Error) => {
      showAlert({ message: `Failed to remove queue item: ${error.message}`, variant: 'error' });
    },
  });

  const reorderQueueMutation = useMutation({
    mutationFn: (itemIds: string[]) => reorderQueue(specialist.name, itemIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['specialist-queue', specialist.name] });
    },
    onError: (error: Error) => {
      showAlert({ message: `Failed to reorder queue: ${error.message}`, variant: 'error' });
    },
  });

  const handleWake = (e: React.MouseEvent) => {
    e.stopPropagation();
    wakeMutation.mutate();
  };

  const handleReset = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (await confirm({ title: 'Reset Specialist', message: `Reset ${specialist.displayName}? This will clear the session file and context.`, variant: 'destructive', confirmLabel: 'Reset' })) {
      resetMutation.mutate();
    }
  };

  const handleKill = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (await confirm({ title: 'Kill Specialist', message: `Kill ${specialist.displayName}?`, variant: 'destructive', confirmLabel: 'Kill' })) {
      killMutation.mutate();
    }
  };

  const handleRemoveQueueItem = (e: React.MouseEvent, itemId: string) => {
    e.stopPropagation();
    removeQueueItemMutation.mutate(itemId);
  };

  const handleMoveUp = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    if (!queueData || index === 0) return;
    const newOrder = [...queueData.items];
    [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
    reorderQueueMutation.mutate(newOrder.map(item => item.id));
  };

  const handleMoveDown = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    if (!queueData || index === queueData.items.length - 1) return;
    const newOrder = [...queueData.items];
    [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
    reorderQueueMutation.mutate(newOrder.map(item => item.id));
  };

  const toggleQueueExpanded = (e: React.MouseEvent) => {
    e.stopPropagation();
    setQueueExpanded(!queueExpanded);
  };

  const toggleActivityExpanded = (e: React.MouseEvent) => {
    e.stopPropagation();
    setActivityExpanded(!activityExpanded);
  };

  const handleResume = (e: React.MouseEvent) => {
    e.stopPropagation();
    resumeMutation.mutate(undefined);
  };

  const priorityColors = {
    urgent: 'text-destructive',
    high: 'text-warning-foreground',
    normal: 'text-primary',
    low: 'text-muted-foreground',
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
          <Brain className="w-5 h-5 text-signal-review" />
          <div>
            <div className="font-medium text-foreground flex items-center gap-2">
              {specialist.displayName}
              {specialist.state === 'active' ? (
                <Loader2 className="w-4 h-4 text-success animate-spin" />
              ) : (
                <span className={`text-xs ${STATE_COLOR[specialist.state]}`}>
                  {STATE_EMOJI[specialist.state]}
                </span>
              )}
              {queueData && queueData.totalCount > 0 && (
                <button
                  onClick={toggleQueueExpanded}
                  className="text-xs text-warning hover:text-warning/80 flex items-center gap-1"
                  title={`${queueData.totalCount} queued task${queueData.totalCount > 1 ? 's' : ''}`}
                >
                  ({queueData.totalCount})
                  {queueExpanded ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                </button>
              )}
            </div>
            <div className="text-sm text-muted-foreground">{specialist.description}</div>
            {/* Show current issue being worked on */}
            {specialist.currentIssue && (
              <div className="text-xs text-signal-cost mt-1 flex items-center gap-1">
                <span className="text-muted-foreground">Working on:</span>
                <span className="font-mono">{specialist.currentIssue}</span>
                {issueInfo && (
                  <span className="text-muted-foreground truncate max-w-[200px]" title={issueInfo.title}>
                    - {issueInfo.title}
                  </span>
                )}
              </div>
            )}
            {specialist.sessionId && !specialist.currentIssue && (
              <div className="text-xs text-muted-foreground font-mono mt-1">
                Session: {specialist.sessionId.slice(0, 8)}...
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-sm text-muted-foreground">
              {STATE_LABEL[specialist.state]}
            </div>
            {costData && costData.cost > 0 && (
              <div className="text-xs text-success font-medium" title="Total cost">
                ${costData.cost.toFixed(4)}
              </div>
            )}
            {specialist.contextTokens && (
              <div className="text-xs text-muted-foreground">
                {formatTokens(specialist.contextTokens)} tokens
              </div>
            )}
            {specialist.lastWake && (
              <div className="text-xs text-muted-foreground">
                Last wake: {formatLastWake(specialist.lastWake)}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Activity button - for all states except uninitialized */}
            {specialist.state !== 'uninitialized' && activityData && activityData.length > 0 && (
              <button
                onClick={toggleActivityExpanded}
                className="p-2 text-muted-foreground hover:text-primary hover:bg-card rounded"
                title={`Show activity history (${activityData.length} entries)`}
              >
                <Activity className="w-4 h-4" />
              </button>
            )}

            {/* Resume button - only for suspended */}
            {specialist.state === 'suspended' && (
              <button
                onClick={handleResume}
                disabled={resumeMutation.isPending}
                className="p-2 text-muted-foreground hover:text-success hover:bg-card rounded disabled:opacity-50"
                title="Resume specialist"
              >
                <Play className="w-4 h-4" />
              </button>
            )}

            {/* Wake button - only for sleeping or uninitialized */}
            {(specialist.state === 'sleeping' || specialist.state === 'uninitialized') && (
              <button
                onClick={handleWake}
                disabled={wakeMutation.isPending || specialist.state === 'uninitialized'}
                className="p-2 text-muted-foreground hover:text-success hover:bg-card rounded disabled:opacity-50 disabled:cursor-not-allowed"
                title={
                  specialist.state === 'uninitialized'
                    ? 'Specialist not initialized - needs session ID'
                    : 'Wake specialist'
                }
              >
                <Power className="w-4 h-4" />
              </button>
            )}

            {/* Kill button - only for active */}
            {specialist.state === 'active' && (
              <button
                onClick={handleKill}
                disabled={killMutation.isPending}
                className="p-2 text-muted-foreground hover:text-destructive hover:bg-card rounded"
                title="Kill specialist"
              >
                <XCircle className="w-4 h-4" />
              </button>
            )}

            {/* Reset button - only for sleeping or uninitialized */}
            {(specialist.state === 'sleeping' || specialist.state === 'uninitialized') && (
              <button
                onClick={handleReset}
                disabled={resetMutation.isPending}
                className="p-2 text-muted-foreground hover:text-warning hover:bg-card rounded"
                title="Reset specialist (clear session)"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Queue section (PAN-74) */}
      {queueExpanded && queueData && queueData.totalCount > 0 && (
        <div className="mt-3 pl-8 border-l-2 border-border">
          <div className="text-xs text-muted-foreground font-medium mb-2">
            Queued Tasks ({queueData.totalCount})
          </div>
          <div className="space-y-2">
            {queueData.items.map((item, index) => (
              <div
                key={item.id}
                className="flex items-center justify-between bg-muted px-3 py-2 rounded text-xs"
              >
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-muted-foreground">{index + 1}.</span>
                  {item.payload.issueId && (
                    <span className="badge-bg-signal-review text-signal-review-foreground px-1 rounded text-xs font-mono">
                      {item.payload.issueId.match(/^([A-Z]+)-/)?.[1] ?? '?'}
                    </span>
                  )}
                  <span className="text-foreground font-mono">
                    {item.payload.issueId || item.payload.message || item.id.substring(0, 8)}
                  </span>
                  <span className={`${priorityColors[item.priority]} font-medium`}>
                    [{item.priority}]
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {item.source}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => handleMoveUp(e, index)}
                    disabled={index === 0 || reorderQueueMutation.isPending}
                    className="p-1 text-muted-foreground hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Move up"
                  >
                    <MoveUp className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => handleMoveDown(e, index)}
                    disabled={index === queueData.items.length - 1 || reorderQueueMutation.isPending}
                    className="p-1 text-muted-foreground hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Move down"
                  >
                    <MoveDown className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => handleRemoveQueueItem(e, item.id)}
                    disabled={removeQueueItemMutation.isPending}
                    className="p-1 text-muted-foreground hover:text-destructive disabled:opacity-50"
                    title="Remove from queue"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
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

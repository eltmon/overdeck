import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Brain, RotateCcw, Power, XCircle, Loader2, ChevronDown, ChevronRight, Trash2, MoveUp, MoveDown, Play, Activity } from 'lucide-react';
import { useState } from 'react';
import { useRequestLock } from '../contexts/RequestLockContext';

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
}

interface SpecialistAgentCardProps {
  specialist: SpecialistAgent;
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
  sleeping: 'text-blue-400',
  active: 'text-green-400',
  uninitialized: 'text-gray-500',
  suspended: 'text-yellow-400',
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
  onSelect,
  isSelected,
}: SpecialistAgentCardProps) {
  const queryClient = useQueryClient();
  const { isLocked, withLock } = useRequestLock();
  const { data: costData } = useSpecialistCost(specialist.name, specialist.state !== 'uninitialized');
  const { data: queueData } = useSpecialistQueue(specialist.name);
  const { data: activityData } = useActivity(specialist.tmuxSession, specialist.state !== 'uninitialized');
  const [queueExpanded, setQueueExpanded] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);

  // Uses request lock to prevent concurrent API calls (PAN-88)
  const wakeMutation = useMutation({
    mutationFn: () => withLock(`Waking ${specialist.displayName}`, () => wakeSpecialist(specialist.name)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['specialists'] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
    onError: (error: Error) => {
      alert(`Failed to wake ${specialist.displayName}: ${error.message}`);
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => resetSpecialist(specialist.name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['specialists'] });
    },
    onError: (error: Error) => {
      alert(`Failed to reset ${specialist.displayName}: ${error.message}`);
    },
  });

  const killMutation = useMutation({
    mutationFn: () => killSpecialist(specialist.tmuxSession),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['specialists'] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });

  // Uses request lock to prevent concurrent API calls (PAN-88)
  const resumeMutation = useMutation({
    mutationFn: (message?: string) => withLock(`Resuming ${specialist.displayName}`, () => resumeAgent(specialist.tmuxSession, message)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['specialists'] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
    onError: (error: Error) => {
      alert(`Failed to resume ${specialist.displayName}: ${error.message}`);
    },
  });

  const removeQueueItemMutation = useMutation({
    mutationFn: (itemId: string) => removeQueueItem(specialist.name, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['specialist-queue', specialist.name] });
    },
    onError: (error: Error) => {
      alert(`Failed to remove queue item: ${error.message}`);
    },
  });

  const reorderQueueMutation = useMutation({
    mutationFn: (itemIds: string[]) => reorderQueue(specialist.name, itemIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['specialist-queue', specialist.name] });
    },
    onError: (error: Error) => {
      alert(`Failed to reorder queue: ${error.message}`);
    },
  });

  const handleWake = (e: React.MouseEvent) => {
    e.stopPropagation();
    wakeMutation.mutate();
  };

  const handleReset = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (
      confirm(
        `Reset ${specialist.displayName}? This will clear the session file and context.`
      )
    ) {
      resetMutation.mutate();
    }
  };

  const handleKill = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Kill ${specialist.displayName}?`)) {
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
    urgent: 'text-red-400',
    high: 'text-orange-400',
    normal: 'text-blue-400',
    low: 'text-gray-400',
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
          <Brain className="w-5 h-5 text-purple-400" />
          <div>
            <div className="font-medium text-white flex items-center gap-2">
              {specialist.displayName}
              {specialist.state === 'active' ? (
                <Loader2 className="w-4 h-4 text-green-400 animate-spin" />
              ) : (
                <span className={`text-xs ${STATE_COLOR[specialist.state]}`}>
                  {STATE_EMOJI[specialist.state]}
                </span>
              )}
              {queueData && queueData.totalCount > 0 && (
                <button
                  onClick={toggleQueueExpanded}
                  className="text-xs text-yellow-400 hover:text-yellow-300 flex items-center gap-1"
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
            <div className="text-sm text-gray-400">{specialist.description}</div>
            {specialist.sessionId && (
              <div className="text-xs text-gray-500 font-mono mt-1">
                Session: {specialist.sessionId.slice(0, 8)}...
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-sm text-gray-400">
              {STATE_LABEL[specialist.state]}
            </div>
            {costData && costData.cost > 0 && (
              <div className="text-xs text-green-400 font-medium" title="Total cost">
                ${costData.cost.toFixed(4)}
              </div>
            )}
            {specialist.contextTokens && (
              <div className="text-xs text-gray-500">
                {formatTokens(specialist.contextTokens)} tokens
              </div>
            )}
            {specialist.lastWake && (
              <div className="text-xs text-gray-500">
                Last wake: {formatLastWake(specialist.lastWake)}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Activity button - for all states except uninitialized */}
            {specialist.state !== 'uninitialized' && activityData && activityData.length > 0 && (
              <button
                onClick={toggleActivityExpanded}
                className="p-2 text-gray-400 hover:text-blue-400 hover:bg-gray-600 rounded"
                title={`Show activity history (${activityData.length} entries)`}
              >
                <Activity className="w-4 h-4" />
              </button>
            )}

            {/* Resume button - only for suspended */}
            {specialist.state === 'suspended' && (
              <button
                onClick={handleResume}
                disabled={isLocked || resumeMutation.isPending}
                className="p-2 text-gray-400 hover:text-green-400 hover:bg-gray-600 rounded disabled:opacity-50"
                title="Resume specialist"
              >
                <Play className="w-4 h-4" />
              </button>
            )}

            {/* Wake button - only for sleeping or uninitialized */}
            {(specialist.state === 'sleeping' || specialist.state === 'uninitialized') && (
              <button
                onClick={handleWake}
                disabled={isLocked || wakeMutation.isPending || specialist.state === 'uninitialized'}
                className="p-2 text-gray-400 hover:text-green-400 hover:bg-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed"
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
                disabled={isLocked || killMutation.isPending}
                className="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-600 rounded disabled:opacity-50"
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
                className="p-2 text-gray-400 hover:text-yellow-400 hover:bg-gray-600 rounded"
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
        <div className="mt-3 pl-8 border-l-2 border-gray-600">
          <div className="text-xs text-gray-400 font-medium mb-2">
            Queued Tasks ({queueData.totalCount})
          </div>
          <div className="space-y-2">
            {queueData.items.map((item, index) => (
              <div
                key={item.id}
                className="flex items-center justify-between bg-gray-750 px-3 py-2 rounded text-xs"
              >
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-gray-500">{index + 1}.</span>
                  <span className="text-white font-mono">
                    {item.payload.issueId || item.payload.message || item.id.substring(0, 8)}
                  </span>
                  <span className={`${priorityColors[item.priority]} font-medium`}>
                    [{item.priority}]
                  </span>
                  <span className="text-gray-500 text-xs">
                    {item.source}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => handleMoveUp(e, index)}
                    disabled={index === 0 || reorderQueueMutation.isPending}
                    className="p-1 text-gray-400 hover:text-blue-400 disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Move up"
                  >
                    <MoveUp className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => handleMoveDown(e, index)}
                    disabled={index === queueData.items.length - 1 || reorderQueueMutation.isPending}
                    className="p-1 text-gray-400 hover:text-blue-400 disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Move down"
                  >
                    <MoveDown className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => handleRemoveQueueItem(e, item.id)}
                    disabled={removeQueueItemMutation.isPending}
                    className="p-1 text-gray-400 hover:text-red-400 disabled:opacity-50"
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

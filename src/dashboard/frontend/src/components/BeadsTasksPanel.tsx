import { useQuery } from '@tanstack/react-query';
import { Circle, CheckCircle2, Clock, ListTodo, RefreshCw, Loader2 } from 'lucide-react';

interface BeadTask {
  id: string;
  name: string;
  status: 'open' | 'closed';
  labels: string[];
  blockedBy: string[];
  blocks: string[];
  createdAt: string;
  closedAt?: string;
}

interface BeadsResponse {
  issueId: string;
  workspacePath: string;
  tasks: BeadTask[];
}

interface BeadsTasksPanelProps {
  issueId: string;
}

export function BeadsTasksPanel({ issueId }: BeadsTasksPanelProps) {
  const { data: beadsData, isLoading, refetch, isRefetching } = useQuery<BeadsResponse>({
    queryKey: ['beads', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/issues/${issueId}/beads`);
      if (!res.ok) throw new Error('Failed to fetch beads');
      return res.json();
    },
    refetchInterval: 10000,
  });

  const openTasks = beadsData?.tasks?.filter(t => t.status === 'open') || [];
  const closedTasks = beadsData?.tasks?.filter(t => t.status === 'closed') || [];

  if (isLoading) {
    return (
      <div className="py-3 text-center text-content-muted text-xs">
        <Loader2 className="w-4 h-4 animate-spin mx-auto mb-1" />
        Loading tasks...
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Header with counts */}
      <div className="flex items-center justify-between text-xs text-content-subtle">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Circle className="w-3 h-3 text-blue-400" />
            {openTasks.length} open
          </span>
          <span className="flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-green-400" />
            {closedTasks.length} closed
          </span>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className="p-1 hover:bg-surface-overlay rounded transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-3 h-3 ${isRefetching ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Task List */}
      {beadsData?.tasks && beadsData.tasks.length > 0 ? (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {/* Open tasks first */}
          {openTasks.map((task) => (
            <TaskItem key={task.id} task={task} />
          ))}
          {/* Then closed tasks */}
          {closedTasks.map((task) => (
            <TaskItem key={task.id} task={task} />
          ))}
        </div>
      ) : (
        <div className="text-center py-4 text-content-muted text-xs">
          <ListTodo className="w-5 h-5 mx-auto mb-1 opacity-50" />
          <p>No tasks yet</p>
        </div>
      )}
    </div>
  );
}

function TaskItem({ task }: { task: BeadTask }) {
  return (
    <div
      className={`p-2 rounded border text-xs ${
        task.status === 'open'
          ? 'border-divider bg-surface-raised/50'
          : 'border-divider bg-surface/50 opacity-60'
      }`}
    >
      <div className="flex items-start gap-2">
        {task.status === 'open' ? (
          <Circle className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
        ) : (
          <CheckCircle2 className="w-3.5 h-3.5 text-green-400 mt-0.5 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-content break-words leading-tight">
            {task.name}
          </div>
          {/* Labels */}
          {task.labels.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {task.labels.map((label) => (
                <span
                  key={label}
                  className={`text-[9px] px-1 py-0.5 rounded ${
                    label.startsWith('difficulty:')
                      ? label.includes('easy') ? 'bg-green-900/50 text-green-400' :
                        label.includes('medium') ? 'bg-yellow-900/50 text-yellow-400' :
                        label.includes('hard') ? 'bg-red-900/50 text-red-400' :
                        'bg-surface-overlay text-content-body'
                      : 'bg-surface-overlay text-content-body'
                  }`}
                >
                  {label}
                </span>
              ))}
            </div>
          )}
          {/* Dependencies */}
          {task.blockedBy.length > 0 && (
            <div className="flex items-center gap-1 mt-1 text-[9px] text-orange-400">
              <Clock className="w-2.5 h-2.5" />
              Blocked by: {task.blockedBy.join(', ')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { X, List, Loader2, CheckCircle, Clock } from 'lucide-react';

interface BeadsDialogProps {
  issueId: string;
  isOpen: boolean;
  onClose: () => void;
}

interface BeadTask {
  id: string;
  title: string;
  status: 'open' | 'in_progress' | 'closed';
  type: string;
  labels: string[];
  blockedBy: string[];
  priority: number;
  createdAt: string;
}

interface BeadsResponse {
  tasks: BeadTask[];
  workspacePath: string;
  count: number;
  message?: string;
}

export function BeadsDialog({ issueId, isOpen, onClose }: BeadsDialogProps) {
  const { data, isLoading, isFetching, error } = useQuery<BeadsResponse>({
    queryKey: ['beads', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/issues/${issueId}/beads`);
      if (!res.ok) throw new Error('Failed to fetch tasks');
      return res.json();
    },
    enabled: isOpen,
    staleTime: 0, // Always refetch when dialog opens
    refetchOnMount: 'always',
  });

  if (!isOpen) return null;

  const openTasks = data?.tasks?.filter(t => t.status !== 'closed') || [];
  const closedTasks = data?.tasks?.filter(t => t.status === 'closed') || [];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[70vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <List className="w-5 h-5 text-success" />
            <h2 className="font-semibold text-foreground">Tasks: {issueId}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-popover rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {(isLoading || isFetching) && !data?.tasks?.length && (
            <div className="space-y-2">
              {/* Skeleton loading */}
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-border bg-popover/30 animate-pulse">
                  <div className="w-4 h-4 bg-card rounded-full mt-0.5" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-card rounded w-3/4" />
                    <div className="h-3 bg-popover rounded w-1/4" />
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-center py-2 text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Loading tasks from workspace...
              </div>
            </div>
          )}

          {error && (
            <div className="text-destructive text-center py-8">
              Failed to load tasks
            </div>
          )}

          {data && data.tasks?.length === 0 && !isFetching && (
            <div className="text-muted-foreground text-center py-8">
              <List className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No tasks created yet</p>
              <p className="text-xs mt-2">Tasks will appear here once created using beads.</p>
            </div>
          )}

          {data && data.tasks?.length > 0 && (
            <div className="space-y-2">
              {/* Summary stats */}
              <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3 pb-3 border-b border-border">
                <span className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-primary rounded-full" />
                  {openTasks.length} open
                </span>
                <span className="flex items-center gap-1">
                  <CheckCircle className="w-3 h-3 text-success" />
                  {closedTasks.length} closed
                </span>
              </div>

              {/* Open tasks first */}
              {openTasks.map((task) => (
                <TaskItem key={task.id} task={task} />
              ))}

              {/* Then closed tasks */}
              {closedTasks.length > 0 && openTasks.length > 0 && (
                <div className="text-xs text-muted-foreground mt-4 mb-2">Completed</div>
              )}
              {closedTasks.map((task) => (
                <TaskItem key={task.id} task={task} />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground flex items-center justify-between">
          <span>{data?.count || 0} task{data?.count !== 1 ? 's' : ''}</span>
          <span className="text-muted-foreground">Beads</span>
        </div>
      </div>
    </div>
  );
}

function TaskItem({ task }: { task: BeadTask }) {
  const statusColors = {
    open: 'bg-popover/50 border-border',
    in_progress: 'badge-bg-primary border-primary/40',
    closed: 'badge-bg-success border-success/30 opacity-60',
  };

  const statusIcons = {
    open: <div className="w-4 h-4 border-2 border-border rounded-full" />,
    in_progress: <Loader2 className="w-4 h-4 text-primary animate-spin" />,
    closed: <CheckCircle className="w-4 h-4 text-success" />,
  };

  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border ${statusColors[task.status]}`}>
      <div className="mt-0.5">
        {statusIcons[task.status]}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-foreground">{task.title}</div>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className="text-xs text-muted-foreground">{task.id}</span>
          {task.blockedBy.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-warning">
              <Clock className="w-3 h-3" />
              Blocked
            </span>
          )}
          {task.labels.filter(l => l.startsWith('difficulty:')).map(label => (
            <span
              key={label}
              className={`text-xs px-1.5 py-0.5 rounded ${
                label.includes('simple') || label.includes('trivial') ? 'badge-bg-success text-success' :
                label.includes('medium') ? 'badge-bg-warning text-warning' :
                label.includes('complex') || label.includes('hard') ? 'badge-bg-destructive text-destructive' :
                'bg-popover text-foreground'
              }`}
            >
              {label.replace('difficulty:', '')}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

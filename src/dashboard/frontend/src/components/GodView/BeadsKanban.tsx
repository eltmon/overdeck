import { useQuery } from '@tanstack/react-query';

interface BeadsTask {
  id: string;
  title: string;
  status: 'open' | 'in_progress' | 'closed';
}

interface BeadsKanbanProps {
  agentId: string;
  workspace?: string;
}

export function BeadsKanban({ agentId }: BeadsKanbanProps) {
  const { data } = useQuery({
    queryKey: ['beads', agentId],
    queryFn: async () => {
      // Beads tasks are stored in .beads/issues.jsonl in the workspace
      // We'll fetch via agent timeline as a proxy
      const res = await fetch(`/api/agents/${agentId}/activity?limit=50`);
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 10000,
    enabled: !!agentId,
  });

  // Parse activity for task-related events
  const tasks: BeadsTask[] = [];
  if (data?.activity) {
    for (const event of data.activity) {
      if (event.type === 'task_started' || event.type === 'task_completed' || event.message?.includes('bead')) {
        tasks.push({
          id: event.id || Math.random().toString(),
          title: event.message || 'Task',
          status: event.type === 'task_completed' ? 'closed' : 'in_progress',
        });
      }
    }
  }

  if (tasks.length === 0) {
    return (
      <div className="text-xs text-center py-2" style={{ color: 'var(--gv-text-dim)' }}>
        No task events found
      </div>
    );
  }

  const groups = {
    open: tasks.filter((t) => t.status === 'open'),
    in_progress: tasks.filter((t) => t.status === 'in_progress'),
    closed: tasks.filter((t) => t.status === 'closed'),
  };

  return (
    <div className="flex gap-2 overflow-x-auto py-1">
      {Object.entries(groups).map(([status, items]) => (
        <div key={status} className="flex flex-col gap-1 min-w-[100px]">
          <div className="text-[9px] uppercase tracking-wider px-1" style={{ color: 'var(--gv-text-dim)' }}>
            {status.replace('_', ' ')} ({items.length})
          </div>
          {items.map((task) => (
            <div
              key={task.id}
              className="px-1.5 py-1 rounded text-[10px] truncate"
              style={{
                background: 'rgba(255,255,255,0.04)',
                color: status === 'closed' ? 'var(--gv-text-dim)' : 'var(--gv-text-secondary)',
                textDecoration: status === 'closed' ? 'line-through' : 'none',
              }}
            >
              {task.title}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

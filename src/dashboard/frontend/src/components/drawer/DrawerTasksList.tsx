import { cn } from '../../lib/utils';
import { useDashboardStore } from '../../lib/store';
import { useIssueData, type DrawerTaskStatus } from './useDrawerData';

function TaskStatusMarker({ status }: { status: DrawerTaskStatus }) {
  if (status === 'done') {
    return (
      <span
        data-testid="drawer-task-status-done"
        className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-success text-[9px] font-bold leading-none text-white"
      >
        ✓
      </span>
    );
  }

  if (status === 'current') {
    return (
      <span data-testid="drawer-task-status-current" className="relative flex h-[18px] w-[18px] items-center justify-center">
        <span className="drawer-task-current-ping absolute h-[18px] w-[18px] rounded-full border-[1.5px] border-info" />
        <span className="h-[10px] w-[10px] rounded-full bg-info" />
      </span>
    );
  }

  return <span data-testid="drawer-task-status-open" className="h-[18px] w-[18px] rounded-full border border-border bg-background/60" />;
}

export default function DrawerTasksList({ issueId }: { issueId?: string } = {}) {
  const drawerIssueId = useDashboardStore((s) => s.drawer.issueId);
  const { tasks } = useIssueData(issueId ?? drawerIssueId);

  return (
    <section data-component="drawer-tasks-list" data-testid="drawer-tasks-list" className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
      <div className="border-b border-border px-[14px] py-[10px] text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Tasks</div>
      {tasks.length === 0 ? (
        <div className="px-[14px] py-[16px] text-[12px] text-muted-foreground">No tasks yet.</div>
      ) : (
        <div className="divide-y divide-border/60">
          {tasks.map((task) => (
            <div key={task.id} className="grid grid-cols-[18px_1fr_auto_auto] items-center gap-[10px] px-[14px] py-[10px]">
              <TaskStatusMarker status={task.status} />
              <span
                className={cn(
                  'min-w-0 truncate text-[12px] leading-[18px] text-foreground',
                  task.status === 'done' && 'text-muted-foreground line-through decoration-[rgba(255,255,255,0.18)]',
                )}
              >
                {task.title}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">{task.id}</span>
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{task.duration}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * TasksTab — wraps the existing TasksPanel, which already owns its own
 * data fetch, list/graph toggle, and item details. We keep this thin so the
 * Tasks UX has a single source of truth (TasksPanel) shared between the
 * old TasksDialog and this Command Deck tab.
 */

import { TasksPanel } from '../../TasksPanel';

interface TasksTabProps {
  issueId: string;
}

export function TasksTab({ issueId }: TasksTabProps) {
  return (
    <div data-testid="tasks-tab" style={{ padding: 16 }}>
      <TasksPanel issueId={issueId} />
    </div>
  );
}

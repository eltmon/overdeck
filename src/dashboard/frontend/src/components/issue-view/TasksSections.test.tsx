import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { taskStatusRollup } from '../../lib/taskStatus';
import { TasksPanel } from '../TasksPanel';
import { TasksRail, useTasksQuery } from '../Stage/cockpit/TasksRail';

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === 'tasks'
      ? { issueId: 'PAN-2499', workspacePath: '/tmp/workspace', tasks: [] }
      : null,
    isLoading: false,
    isRefetching: false,
    refetch: vi.fn(),
  }),
}));

function TasksRailFixture() {
  const query = useTasksQuery('PAN-2499');
  return (
    <TasksRail
      issueId="PAN-2499"
      onOpenFull={vi.fn()}
      query={query}
      rollup={taskStatusRollup(query.data?.tasks ?? [])}
    />
  );
}

describe('legacy beads section compatibility markers', () => {
  it('renders the full section on the canonical TasksPanel', () => {
    const { container } = render(<TasksPanel issueId="PAN-2499" />);
    expect(container.querySelector('[data-section="beads-panel"]')).toBeInTheDocument();
  });

  it('renders the compact section on the canonical TasksRail', () => {
    const { container } = render(<TasksRailFixture />);
    expect(container.querySelector('[data-section="beads-panel-compact"]')).toBeInTheDocument();
    expect(screen.getByLabelText('Tasks progress')).toBeInTheDocument();
  });
});

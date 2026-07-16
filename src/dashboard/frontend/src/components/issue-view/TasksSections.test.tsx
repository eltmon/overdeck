import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TasksPanel } from '../TasksPanel';
import { TasksRail } from '../Stage/cockpit/TasksRail';

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

describe('legacy beads section compatibility markers', () => {
  it('renders the full section on the canonical TasksPanel', () => {
    const { container } = render(<TasksPanel issueId="PAN-2499" />);
    expect(container.querySelector('[data-section="beads-panel"]')).toBeInTheDocument();
  });

  it('renders the compact section on the canonical TasksRail', () => {
    const { container } = render(<TasksRail issueId="PAN-2499" onOpenFull={vi.fn()} />);
    expect(container.querySelector('[data-section="beads-panel-compact"]')).toBeInTheDocument();
    expect(screen.getByLabelText('Tasks progress')).toBeInTheDocument();
  });
});

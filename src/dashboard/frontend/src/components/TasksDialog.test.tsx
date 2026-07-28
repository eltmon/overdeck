import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TasksDialog } from './TasksDialog';

vi.mock('./xbrief/PlanMapViewer.js', () => ({
  PlanMapViewer: ({ onNodeClick }: { onNodeClick: (item: Record<string, unknown>) => void }) => (
    <button
      type="button"
      onClick={() => onNodeClick({
        id: 'running-task',
        title: 'Running task',
        status: 'running',
        priority: 'high',
        metadata: { difficulty: 'medium' },
        narrative: { Action: 'Keep working' },
        subItems: [],
      })}
    >
      Open graph item
    </button>
  ),
}));

const tasks = [
  {
    id: 'pending-task',
    title: 'Pending task',
    status: 'pending',
    labels: [],
    blockedBy: [],
    blocks: [],
    createdAt: '2026-07-28T00:00:00Z',
  },
  {
    id: 'running-task',
    title: 'Running task',
    status: 'running',
    labels: [],
    blockedBy: [],
    blocks: [],
    createdAt: '2026-07-28T00:00:00Z',
  },
  {
    id: 'completed-task',
    title: 'Completed task',
    status: 'completed',
    labels: [],
    blockedBy: [],
    blocks: [],
    createdAt: '2026-07-28T00:00:00Z',
  },
];

const plan = {
  xBRIEFInfo: { version: '0.8' },
  plan: {
    id: 'pan-3231',
    title: 'Artifact viewers',
    status: 'running',
    items: [
      {
        id: 'running-task',
        title: 'Running task',
        status: 'running',
        priority: 'high',
        metadata: { difficulty: 'medium' },
        narrative: { Action: 'Keep working' },
        subItems: [],
      },
    ],
    edges: [],
  },
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function installFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url === '/api/issues/PAN-3231/tasks') {
      return { ok: true, json: async () => ({ issueId: 'PAN-3231', workspacePath: '/tmp/PAN-3231', tasks }) };
    }
    if (url === '/api/workspaces/PAN-3231/plan') {
      return { ok: true, json: async () => plan };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('TasksDialog', () => {
  it('renders nothing while closed', () => {
    render(<TasksDialog issueId="PAN-3231" isOpen={false} onClose={vi.fn()} />, { wrapper });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders TasksPanel and classifies xBRIEF statuses', async () => {
    installFetch();
    render(<TasksDialog issueId="PAN-3231" isOpen onClose={vi.fn()} />, { wrapper });

    expect(screen.getByRole('dialog', { name: 'Tasks: PAN-3231' })).toBeInTheDocument();
    await screen.findByText('Pending task');

    expect(screen.getByText('Pending task').closest('[data-status-bucket]')).toHaveAttribute('data-status-bucket', 'upcoming');
    expect(screen.getByText('Running task').closest('[data-status-bucket]')).toHaveAttribute('data-status-bucket', 'working');
    expect(screen.getByText('Completed task').closest('[data-status-bucket]')).toHaveAttribute('data-status-bucket', 'done');
  });

  it('preserves the list/graph toggle and graph item drill-in', async () => {
    installFetch();
    render(<TasksDialog issueId="PAN-3231" isOpen onClose={vi.fn()} />, { wrapper });

    await screen.findByTitle('DAG graph view');
    fireEvent.click(screen.getByTitle('DAG graph view'));
    fireEvent.click(await screen.findByRole('button', { name: 'Open graph item' }));

    await waitFor(() => {
      const details = screen.getByText('Keep working').closest('div.rounded');
      expect(details).not.toBeNull();
      expect(within(details!).getByText('Running task')).toBeInTheDocument();
    });
  });

  it('closes from the close button and scrim', () => {
    installFetch();
    const onClose = vi.fn();
    const { container } = render(<TasksDialog issueId="PAN-3231" isOpen onClose={onClose} />, { wrapper });

    fireEvent.click(screen.getByRole('button', { name: 'Close tasks viewer' }));
    fireEvent.click(container.querySelector('.absolute.inset-0')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

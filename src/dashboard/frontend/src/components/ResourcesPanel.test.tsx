import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ResourcesPanel } from './ResourcesPanel';
import type { ResourcesSnapshot } from '../types';

// Mock hooks and sub-components to keep tests focused
vi.mock('../hooks/useResourceStats', () => ({
  useResourceStats: vi.fn(),
}));

vi.mock('./ResourceCard', () => ({
  ContainerCard: ({ container, onClick }: any) => (
    <div
      data-testid={`container-card-${container.id}`}
      onClick={() => onClick(container)}
    >
      {container.name}
    </div>
  ),
  AgentCard: ({ agent, onNavigate }: any) => (
    <div
      data-testid={`agent-card-${agent.id}`}
      onClick={() => onNavigate(agent.id)}
    >
      {agent.issueId ?? agent.id}
    </div>
  ),
}));

vi.mock('./ContainerDetailPanel', () => ({
  ContainerDetailPanel: ({ container, onClose }: any) => (
    <div data-testid="detail-panel">
      <span>{container.name}</span>
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

global.fetch = vi.fn();

const mockSnapshot: ResourcesSnapshot = {
  containers: [
    {
      id: 'abc123def456',
      name: 'feature-pan-100-api',
      cpuPercent: 15,
      memoryUsage: 100 * 1024 ** 2,
      memoryLimit: 512 * 1024 ** 2,
      memoryPercent: 19.5,
      networkIn: 0,
      networkOut: 0,
      status: 'running',
    },
    {
      id: 'def456abc789',
      name: 'feature-pan-100-db',
      cpuPercent: 5,
      memoryUsage: 50 * 1024 ** 2,
      memoryLimit: 256 * 1024 ** 2,
      memoryPercent: 19.5,
      networkIn: 0,
      networkOut: 0,
      status: 'running',
    },
  ],
  agents: [
    {
      id: 'agent-pan-100',
      issueId: 'PAN-100',
      runtime: 'claude-code',
      model: 'claude-sonnet-4-5',
      status: 'healthy',
      startedAt: new Date().toISOString(),
      consecutiveFailures: 0,
      killCount: 0,
    },
  ],
  updatedAt: new Date().toISOString(),
};

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('ResourcesPanel', () => {
  beforeEach(() => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSnapshot),
    } as Response);
  });

  it('renders toolbar with group-by controls', async () => {
    renderWithQuery(<ResourcesPanel onNavigateToAgents={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Issue')).toBeTruthy());
    expect(screen.getByText('Type')).toBeTruthy();
    expect(screen.getByText('Status')).toBeTruthy();
  });

  it('renders container cards when data loads', async () => {
    renderWithQuery(<ResourcesPanel onNavigateToAgents={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('container-card-abc123def456')).toBeTruthy());
    expect(screen.getByTestId('container-card-def456abc789')).toBeTruthy();
  });

  it('renders agent cards', async () => {
    renderWithQuery(<ResourcesPanel onNavigateToAgents={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('agent-card-agent-pan-100')).toBeTruthy());
  });

  it('shows total item count', async () => {
    renderWithQuery(<ResourcesPanel onNavigateToAgents={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('3 items')).toBeTruthy());
  });

  it('opens detail panel when container is clicked', async () => {
    renderWithQuery(<ResourcesPanel onNavigateToAgents={vi.fn()} />);
    await waitFor(() => screen.getByTestId('container-card-abc123def456'));
    fireEvent.click(screen.getByTestId('container-card-abc123def456'));
    expect(screen.getByTestId('detail-panel')).toBeTruthy();
  });

  it('closes detail panel when close is clicked', async () => {
    renderWithQuery(<ResourcesPanel onNavigateToAgents={vi.fn()} />);
    await waitFor(() => screen.getByTestId('container-card-abc123def456'));
    fireEvent.click(screen.getByTestId('container-card-abc123def456'));
    fireEvent.click(screen.getByText('Close'));
    expect(screen.queryByTestId('detail-panel')).toBeNull();
  });

  it('calls onNavigateToAgents when agent card is clicked', async () => {
    const onNavigate = vi.fn();
    renderWithQuery(<ResourcesPanel onNavigateToAgents={onNavigate} />);
    await waitFor(() => screen.getByTestId('agent-card-agent-pan-100'));
    fireEvent.click(screen.getByTestId('agent-card-agent-pan-100'));
    expect(onNavigate).toHaveBeenCalledWith('agent-pan-100');
  });

  it('shows "running only" filter button', async () => {
    renderWithQuery(<ResourcesPanel onNavigateToAgents={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Running only')).toBeTruthy());
  });

  it('filters stopped containers when "running only" is selected', async () => {
    const withStopped: ResourcesSnapshot = {
      ...mockSnapshot,
      containers: [
        ...mockSnapshot.containers,
        { ...mockSnapshot.containers[0], id: 'stopped123abc', name: 'stopped-svc', status: 'stopped' },
      ],
    };
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(withStopped),
    } as Response);

    renderWithQuery(<ResourcesPanel onNavigateToAgents={vi.fn()} />);
    await waitFor(() => screen.getByTestId('container-card-stopped123abc'));

    fireEvent.click(screen.getByText('Running only'));
    expect(screen.queryByTestId('container-card-stopped123abc')).toBeNull();
  });

  it('shows empty state when no resources', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ containers: [], agents: [], updatedAt: new Date().toISOString() }),
    } as Response);
    renderWithQuery(<ResourcesPanel onNavigateToAgents={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/no containers or agents/i)).toBeTruthy());
  });

  it('shows error message on fetch failure', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    } as Response);
    renderWithQuery(<ResourcesPanel onNavigateToAgents={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/failed to load/i)).toBeTruthy());
  });
});

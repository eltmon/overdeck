import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContainerCard, AgentCard } from './ResourceCard';
import type { ContainerStats, ContainerHistory, Agent } from '../types';

vi.mock('./Sparkline', () => ({
  Sparkline: () => <div data-testid="sparkline" />,
}));

vi.mock('./ResourceBar', () => ({
  ResourceBar: ({ label, value }: { label?: string; value: number }) => (
    <div data-testid="resource-bar">{label}: {value}</div>
  ),
}));

const mockContainer: ContainerStats = {
  id: 'abc123def456',
  name: 'my-service',
  cpuPercent: 25,
  memoryUsage: 100 * 1024 ** 2,
  memoryLimit: 512 * 1024 ** 2,
  memoryPercent: 19.5,
  networkIn: 1024,
  networkOut: 2048,
  status: 'running',
};

const mockHistory: ContainerHistory = {
  timestamps: [1, 2, 3],
  cpuPercent: [10, 20, 25],
  memoryPercent: [5, 10, 15],
};

const mockAgent: Agent = {
  id: 'agent-pan-123',
  issueId: 'PAN-123',
  runtime: 'claude-code',
  model: 'claude-sonnet-4-5',
  status: 'healthy',
  startedAt: new Date().toISOString(),
  consecutiveFailures: 0,
  killCount: 0,
};

describe('ContainerCard', () => {
  it('renders container name', () => {
    render(<ContainerCard container={mockContainer} onClick={vi.fn()} />);
    expect(screen.getByText('my-service')).toBeTruthy();
  });

  it('shows running status', () => {
    render(<ContainerCard container={mockContainer} onClick={vi.fn()} />);
    expect(screen.getByText('running')).toBeTruthy();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<ContainerCard container={mockContainer} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledWith(mockContainer);
  });

  it('renders sparkline when history has > 1 sample', () => {
    render(<ContainerCard container={mockContainer} history={mockHistory} onClick={vi.fn()} />);
    expect(screen.getByTestId('sparkline')).toBeTruthy();
  });

  it('does not render sparkline when history has 1 sample', () => {
    const shortHistory: ContainerHistory = { timestamps: [1], cpuPercent: [10], memoryPercent: [5] };
    render(<ContainerCard container={mockContainer} history={shortHistory} onClick={vi.fn()} />);
    expect(screen.queryByTestId('sparkline')).toBeNull();
  });

  it('shows stopped status with red dot', () => {
    const stopped = { ...mockContainer, status: 'stopped' as const };
    const { container } = render(<ContainerCard container={stopped} onClick={vi.fn()} />);
    expect(screen.getByText('stopped')).toBeTruthy();
    expect(container.querySelector('.bg-destructive')).toBeTruthy();
  });

  it('shows unhealthy status with yellow dot', () => {
    const unhealthy = { ...mockContainer, status: 'unhealthy' as const };
    const { container } = render(<ContainerCard container={unhealthy} onClick={vi.fn()} />);
    expect(container.querySelector('.bg-warning')).toBeTruthy();
  });
});

describe('AgentCard', () => {
  it('renders issue ID', () => {
    render(<AgentCard agent={mockAgent} onNavigate={vi.fn()} />);
    expect(screen.getByText('PAN-123')).toBeTruthy();
  });

  it('renders agent status', () => {
    render(<AgentCard agent={mockAgent} onNavigate={vi.fn()} />);
    expect(screen.getByText('healthy')).toBeTruthy();
  });

  it('renders model name', () => {
    render(<AgentCard agent={mockAgent} onNavigate={vi.fn()} />);
    expect(screen.getByText('claude-sonnet-4-5')).toBeTruthy();
  });

  it('calls onNavigate with agent id when clicked', () => {
    const onNavigate = vi.fn();
    render(<AgentCard agent={mockAgent} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onNavigate).toHaveBeenCalledWith('agent-pan-123');
  });

  it('shows consecutive failures when > 0', () => {
    const failing = { ...mockAgent, consecutiveFailures: 3 };
    render(<AgentCard agent={failing} onNavigate={vi.fn()} />);
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('does not show failures section when 0', () => {
    render(<AgentCard agent={mockAgent} onNavigate={vi.fn()} />);
    expect(screen.queryByText('Failures')).toBeNull();
  });

  it('falls back to agent.id when issueId is undefined', () => {
    const noIssue = { ...mockAgent, issueId: undefined };
    render(<AgentCard agent={noIssue} onNavigate={vi.fn()} />);
    expect(screen.getByText('agent-pan-123')).toBeTruthy();
  });
});

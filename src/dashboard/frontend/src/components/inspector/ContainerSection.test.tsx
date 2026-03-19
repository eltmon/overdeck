import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContainerSection } from './ContainerSection';
import type { ContainerStatus } from './types';

function makeContainers(overrides: Record<string, Partial<ContainerStatus>> = {}): Record<string, ContainerStatus> {
  return {
    postgres: { running: true, uptime: '2h', ...overrides.postgres },
    api: { running: true, uptime: '1h', ...overrides.api },
  };
}

const defaultProps = {
  startPending: false,
  containersStarting: false,
  containerControlPending: false,
  controllingContainer: undefined,
  containerMenu: null,
  onContainerContextMenu: vi.fn(),
  onSetContainerMenu: vi.fn(),
  onContainerControl: vi.fn(),
  onRefreshDb: vi.fn(),
  refreshDbPending: false,
  confirm: vi.fn().mockResolvedValue(true),
};

describe('ContainerSection', () => {
  it('renders running containers with green style', () => {
    render(<ContainerSection {...defaultProps} containers={makeContainers()} />);
    expect(screen.getByText('postgres')).toBeInTheDocument();
    expect(screen.getByText('api')).toBeInTheDocument();
  });

  it('shows uptime for running containers', () => {
    render(<ContainerSection {...defaultProps} containers={makeContainers()} />);
    expect(screen.getByText('2h')).toBeInTheDocument();
    expect(screen.getByText('1h')).toBeInTheDocument();
  });

  it('calls onContainerContextMenu on right click', () => {
    const onContextMenu = vi.fn();
    render(
      <ContainerSection
        {...defaultProps}
        containers={makeContainers()}
        onContainerContextMenu={onContextMenu}
      />
    );
    fireEvent.contextMenu(screen.getByText('postgres'));
    expect(onContextMenu).toHaveBeenCalledOnce();
  });

  it('renders context menu when containerMenu is set for running container', () => {
    render(
      <ContainerSection
        {...defaultProps}
        containers={makeContainers()}
        containerMenu={{ x: 100, y: 200, containerName: 'postgres', isRunning: true }}
      />
    );
    expect(screen.getByText('Restart')).toBeInTheDocument();
    expect(screen.getByText('Stop')).toBeInTheDocument();
    expect(screen.getByText('Refresh DB')).toBeInTheDocument();
  });

  it('renders Start option for stopped container in context menu', () => {
    render(
      <ContainerSection
        {...defaultProps}
        containers={makeContainers({ api: { running: false, uptime: null } })}
        containerMenu={{ x: 100, y: 200, containerName: 'api', isRunning: false }}
      />
    );
    expect(screen.getByText('Start')).toBeInTheDocument();
    expect(screen.queryByText('Stop')).not.toBeInTheDocument();
  });

  it('calls onContainerControl with correct args when Restart clicked', () => {
    const onContainerControl = vi.fn();
    render(
      <ContainerSection
        {...defaultProps}
        containers={makeContainers()}
        containerMenu={{ x: 100, y: 200, containerName: 'api', isRunning: true }}
        onContainerControl={onContainerControl}
      />
    );
    fireEvent.click(screen.getByText('Restart'));
    expect(onContainerControl).toHaveBeenCalledWith('api', 'restart');
  });

  it('shows failed status for exited containers', () => {
    const containers = makeContainers({ api: { running: false, uptime: null, status: 'exited(1)' } });
    render(<ContainerSection {...defaultProps} containers={containers} />);
    expect(screen.getByText('exited(1)')).toBeInTheDocument();
  });
});

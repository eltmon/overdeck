import { act, render, screen } from '@testing-library/react';
import type { DomainEvent, ProjectDeploySnapshot } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDashboardStore } from '../../../lib/store';
import { ProjectDeployChip } from '../ProjectDeployChip';

const PROJECT_KEY = 'overdeck';
const T0 = Date.parse('2026-09-24T12:00:00.000Z');

function deploy(overrides: Partial<ProjectDeploySnapshot> = {}): ProjectDeploySnapshot {
  return {
    projectKey: PROJECT_KEY,
    trigger: 'pan reload',
    phase: 'building',
    pid: 4242,
    startedAt: new Date(T0).toISOString(),
    ...overrides,
  };
}

function push(deploys: Record<string, ProjectDeploySnapshot>) {
  // The same path a /ws/rpc event takes into the store.
  act(() => {
    useDashboardStore.getState().applyEvent({
      type: 'project.deploy_changed',
      sequence: -1,
      timestamp: new Date(T0).toISOString(),
      payload: { deploys },
    } as DomainEvent);
  });
}

describe('ProjectDeployChip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 83_000);
    useDashboardStore.setState({ deployByProjectKey: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when the project has no deploy in flight', () => {
    const { container } = render(<ProjectDeployChip projectKey={PROJECT_KEY} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a live building indicator with elapsed time and the log tail', async () => {
    render(<ProjectDeployChip projectKey={PROJECT_KEY} />);
    push({ [PROJECT_KEY]: deploy({ logPath: '/home/u/.overdeck/logs/composer-reload-1.log', logTail: ['Building dashboard from origin/main…'] }) });

    const chip = screen.getByTestId('project-deploy-chip');
    expect(chip).toHaveAttribute('data-deploy-phase', 'building');
    expect(chip).toHaveTextContent('Deploying 1m 23s');
    expect(chip.style.color).toBe('var(--info)');
    expect(chip.title).toContain('log: /home/u/.overdeck/logs/composer-reload-1.log');
    expect(chip.title).toContain('Building dashboard from origin/main…');

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(chip).toHaveTextContent('Deploying 1m 25s');
  });

  it('reflects waiting for the operator once the reload requests the restart gate', () => {
    render(<ProjectDeployChip projectKey={PROJECT_KEY} />);
    push({ [PROJECT_KEY]: deploy({ phase: 'awaiting-approval' }) });

    const chip = screen.getByTestId('project-deploy-chip');
    expect(chip).toHaveTextContent('Deploy: approve restart');
    expect(chip.title).toContain('Waiting for the operator');
    expect(chip.style.color).toBe('var(--warning)');
  });

  it('surfaces the error on failure', () => {
    render(<ProjectDeployChip projectKey={PROJECT_KEY} />);
    push({ [PROJECT_KEY]: deploy({ phase: 'failed', pid: undefined, error: 'build failed — old dashboard left running' }) });

    const chip = screen.getByTestId('project-deploy-chip');
    expect(chip).toHaveTextContent('Deploy ✗');
    expect(chip.title).toContain('build failed — old dashboard left running');
    expect(chip.style.color).toBe('var(--destructive)');
  });

  it('shows only the owning project, and clears when the projection empties', () => {
    render(<ProjectDeployChip projectKey="myn" />);
    push({ [PROJECT_KEY]: deploy() });
    expect(screen.queryByTestId('project-deploy-chip')).toBeNull();

    const { container } = render(<ProjectDeployChip projectKey={PROJECT_KEY} />);
    expect(screen.getByTestId('project-deploy-chip')).toBeInTheDocument();
    push({});
    expect(container).toBeEmptyDOMElement();
  });
});

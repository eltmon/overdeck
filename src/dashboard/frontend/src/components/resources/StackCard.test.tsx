import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { pipelineChipFor } from '../CommandDeck/pipeline-helpers';
import { StacksSection } from './StacksSection';
import type { ResourceStack } from '../../types';

describe('StacksSection', () => {
  it('renders stack cards grouped by issue and expands service rows', () => {
    render(<StacksSection stacks={[stack('PAN-1'), stack('PAN-2'), stack('PAN-3')]} filter="" groupBy="workspace" />);

    expect(screen.getAllByTestId('stack-card')).toHaveLength(3);
    fireEvent.click(screen.getByText('PAN-1'));
    expect(screen.getByTestId('stack-services')).toBeTruthy();
    expect(screen.getByText('pan-1-api')).toBeTruthy();
  });

  it('uses the same review chip label and classes as pipelineChipFor', () => {
    const expected = pipelineChipFor({ phase: 'review', feature: { id: 'PAN-1', title: 'Review stack' } as any, reviewStatus: undefined });
    render(<StacksSection stacks={[stack('PAN-1', { phase: 'review' })]} filter="" groupBy="workspace" />);

    const chip = screen.getByText(expected.label);
    expect(chip).toHaveClass(expected.textClass);
    expect(chip).toHaveClass(expected.bgClass);
  });

  it('renders red and amber memory limit states with OOM count', () => {
    render(<StacksSection stacks={[stack('PAN-1', {
      services: [
        service('pan-1-api', 95, 2),
        service('pan-1-worker', 87, 0),
      ],
    })]} filter="" groupBy="workspace" />);

    fireEvent.click(screen.getByText('PAN-1'));
    expect(screen.getByText('95% limit · 2 OOM')).toHaveAttribute('data-limit-level', 'red');
    expect(screen.getByText('87% limit')).toHaveAttribute('data-limit-level', 'amber');
    expect(screen.getByText('Raise limit')).toBeTruthy();
    expect(screen.getByText('Create issue')).toBeTruthy();
  });

  it('renders idle-honesty pause hint only for idle memory-heavy stacks', () => {
    render(<StacksSection stacks={[
      stack('PAN-1', { idleMinutes: 180, memoryBytes: 2.9 * 1024 ** 3 }),
      stack('PAN-2', { idleMinutes: 10, memoryBytes: 2.9 * 1024 ** 3 }),
    ]} filter="" groupBy="workspace" />);

    expect(screen.getByText('Idle stack holding 2.9 GB')).toBeTruthy();
  });
});

function stack(issueId: string, overrides: Partial<ResourceStack> & { memoryBytes?: number } = {}): ResourceStack {
  const services = overrides.services ?? [service(`${issueId.toLowerCase()}-api`, 50, 0)];
  const memoryBytes = overrides.memoryBytes ?? services.reduce((sum, item) => sum + item.memoryUsage, 0);
  return {
    id: issueId,
    issueId,
    issueTitle: `${issueId} stack`,
    composeProject: `feature-${issueId.toLowerCase()}`,
    serviceCount: services.length,
    services,
    aggregates: {
      cpuPercent: 12,
      memoryBytes,
      diskBytes: 2 * 1024 ** 3,
    },
    phase: 'work',
    ...overrides,
  };
}

function service(name: string, limitPercent: number, oomKills24h: number) {
  return {
    id: name,
    name,
    cpuPercent: 1,
    memoryUsage: limitPercent,
    memoryLimit: 100,
    memoryPercent: limitPercent,
    networkIn: 0,
    networkOut: 0,
    status: 'running' as const,
    memLimitBytes: 100,
    memPercentOfLimit: limitPercent,
    oomKills24h,
  };
}

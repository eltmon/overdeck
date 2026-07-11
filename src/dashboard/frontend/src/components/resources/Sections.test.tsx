import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AgentsSection } from './AgentsSection';
import { CoreServicesSection } from './CoreServicesSection';
import { HostProcessesSection } from './HostProcessesSection';
import type { Agent, CoreServiceResource, HostProcessResource } from '../../types';

describe('Machine Room sections', () => {
  it('renders agent resource stats including subscription-covered hypothetical burn', () => {
    render(<AgentsSection agents={[agentFixture()]} filter="" onFocusRow={() => undefined} />);

    expect(screen.getByText('working')).toBeTruthy();
    expect(screen.getByText('12.5% CPU')).toBeTruthy();
    expect(screen.getByText('$0.00/h · $3.50')).toHaveAttribute('title', 'Hypothetical $1.80/h');
  });

  it('renders core services and expands support fleet members', () => {
    render(<CoreServicesSection services={coreServicesFixture()} filter="" onFocusRow={() => undefined} />);

    expect(screen.getByText('event-loop p99 42ms')).toBeTruthy();
    expect(screen.getByText('tick age 90s')).toBeTruthy();
    fireEvent.click(screen.getByText('Support fleet'));
    expect(screen.getByText('traefik')).toBeTruthy();
    expect(screen.getByText('pty-supervisor')).toBeTruthy();
  });

  it('renders retained host process rows dimmed with peak and caused-spike note', () => {
    render(<HostProcessesSection processes={[processFixture()]} filter="" onFocusRow={() => undefined} />);

    expect(screen.getByText('0% now · 160% peak')).toBeTruthy();
    expect(screen.getByText('caused spike: Load 45')).toBeTruthy();
  });
});

function agentFixture(): Agent {
  return {
    id: 'agent-pan-2464',
    issueId: 'PAN-2464',
    runtime: 'codex',
    model: 'codex-test',
    status: 'running',
    startedAt: '2026-07-07T11:00:00.000Z',
    consecutiveFailures: 0,
    killCount: 0,
    role: 'work',
    resourceStats: {
      id: 'agent-pan-2464',
      issueId: 'PAN-2464',
      role: 'work',
      model: 'codex-test',
      status: 'running',
      statusChip: { state: 'working', idleMinutes: 1, fanOut: false },
      rootPid: 100,
      processCount: 4,
      cpuPercent: 12.5,
      memoryBytes: 1024 ** 3,
      burnUsdPerHour: 0,
      hypotheticalUsdPerHour: 1.8,
      totalUsd: 3.5,
    },
  };
}

function coreServicesFixture(): CoreServiceResource[] {
  return [
    { id: 'dashboard', label: 'Dashboard server', status: 'running', cpuPercent: 1, memoryBytes: 1, memberCount: 1, eventLoopP99Ms: 42 },
    { id: 'deacon', label: 'Deacon', status: 'running', cpuPercent: 0, memoryBytes: 0, memberCount: 1, lastTickAgeSeconds: 90 },
    { id: 'support-fleet', label: 'Support fleet', status: 'running', cpuPercent: 2, memoryBytes: 2, memberCount: 2, members: ['traefik', 'pty-supervisor'] },
  ];
}

function processFixture(): HostProcessResource {
  return {
    id: 'vitest:agent-pan-2464',
    family: 'vitest workers',
    label: 'vitest workers',
    owner: { label: 'spawned by agent-pan-2464', agentId: 'agent-pan-2464' },
    pidCount: 4,
    cpuPercent: 0,
    memoryBytes: 0,
    peakCpuPercent: 160,
    peakMemoryBytes: 2 * 1024 ** 3,
    retainedUntil: '2026-07-07T13:00:00.000Z',
    note: 'caused spike: Load 45',
  };
}

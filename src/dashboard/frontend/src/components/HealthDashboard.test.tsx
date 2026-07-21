import type {
  AgentHealthSnapshot,
  AgentHealthStatus,
  SystemHealthSnapshot,
} from '@overdeck/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthDashboard } from './HealthDashboard';

const { hookState } = vi.hoisted(() => ({
  hookState: {
    current: undefined as SystemHealthSnapshot | undefined,
  },
}));

vi.mock('../hooks/useSystemHealth', () => ({
  useSystemHealth: () => ({
    data: hookState.current,
    isLoading: false,
    error: null,
  }),
}));

vi.mock('./CommandDeck/DeaconStatus', () => ({
  DeaconStatus: () => <section aria-label="Deacon status">Deacon</section>,
}));

const GIB = 1024 ** 3;

function createAgent(
  id: string,
  status: AgentHealthStatus,
  overrides: Partial<AgentHealthSnapshot> = {},
): AgentHealthSnapshot {
  return {
    id,
    status,
    reasons: [],
    ...overrides,
  };
}

function createSnapshot(agents: AgentHealthSnapshot[] = []): SystemHealthSnapshot {
  return {
    version: 2,
    state: 'healthy',
    updatedAt: '2026-07-17T04:00:00.000Z',
    nextPollMs: 15_000,
    host: {
      state: 'healthy',
      platform: 'linux',
      reasons: [],
      metrics: {
        cpuPercent: 12.5,
        loadAverage1m: 1.2,
        loadPerCore1m: 0.15,
        totalMemoryBytes: 64 * GIB,
        usedMemoryBytes: 24 * GIB,
        availableMemoryBytes: 40 * GIB,
        memoryUsedPercent: 37.5,
        memoryPressureSomeAvg10: 0,
        memoryPressureFullAvg10: 0,
        memoryPressureFreePercent: null,
        swapTotalBytes: 8 * GIB,
        swapUsedBytes: 0,
        swapUsedPercent: 0,
        swapActivityBytesPerMinute: 0,
        committedMemoryBytes: 24 * GIB,
        commitLimitBytes: 72 * GIB,
        virtualCommitmentPercent: 33.3,
      },
    },
    admission: {
      state: 'open',
      availableMemoryBytes: 40 * GIB,
      admittedWorkAgentCount: agents.length,
      reasons: [],
    },
    agents,
    services: [],
    topConsumers: [],
    summary: {
      cpuPercent: 12.5,
      loadAverage1m: 1.2,
      loadPerCore1m: 0.15,
      totalMemoryBytes: 64 * GIB,
      usedMemoryBytes: 24 * GIB,
      availableMemoryBytes: 40 * GIB,
      memoryUsedPercent: 37.5,
      swapTotalBytes: 8 * GIB,
      swapUsedBytes: 0,
      swapUsedPercent: 0,
      committedMemoryBytes: 24 * GIB,
      commitLimitBytes: 72 * GIB,
      overcommitPercent: 33.3,
      agentCount: agents.length,
      workAgentCount: agents.length,
      planningAgentCount: 0,
      specialistSessionCount: agents.filter((agent) => agent.kind === 'specialist').length,
      leakedSpecialistCount: agents.filter((agent) => agent.lifecycle === 'orphaned').length,
      containerCount: 0,
      containerMemoryBytes: 0,
      overdeckMemoryBytes: 0,
      overdeckMemoryPercent: 0,
      smeeRelay: {
        configured: false,
        running: false,
        status: 'unknown',
        message: 'Webhook relay health is unavailable.',
      },
    },
  };
}

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <HealthDashboard />
    </QueryClientProvider>,
  );
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function stubServiceQueries(projectSpecialists: unknown[] = []) {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/health/agents') {
      return Promise.resolve(jsonResponse(hookState.current?.agents ?? []));
    }
    if (url === '/api/services/tldr/status') {
      return Promise.resolve(jsonResponse({ daemons: [] }));
    }
    if (url === '/api/specialists/projects') {
      return Promise.resolve(jsonResponse(projectSpecialists));
    }
    return Promise.reject(new Error(`Unexpected request: ${url}`));
  }));
}

describe('HealthDashboard', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    hookState.current = createSnapshot();
    stubServiceQueries();
  });

  it('keeps host, Deacon, and optional TLDR visible with no agents', async () => {
    renderDashboard();

    expect(screen.getByRole('heading', { name: 'Host health' })).toBeInTheDocument();
    expect(screen.getByLabelText('Deacon status')).toBeInTheDocument();
    expect(await screen.findByText('TLDR · Not configured (optional)')).toBeInTheDocument();
    expect(screen.getByText('No agents to monitor')).toBeInTheDocument();

    const tldrStatus = screen.getByText('TLDR · Not configured (optional)').parentElement;
    expect(tldrStatus?.querySelector('.lucide-database')).toBeInTheDocument();
    expect(tldrStatus?.querySelector('.lucide-circle-x')).not.toBeInTheDocument();
  });

  it('renders every accepted status and falls unknown future statuses back to unavailable', async () => {
    const agents = [
      createAgent('agent-healthy', 'healthy'),
      createAgent('agent-idle', 'idle', { lifecycle: 'warm', kind: 'specialist' }),
      createAgent('agent-waiting', 'waiting'),
      createAgent('agent-warning', 'warning'),
      createAgent('agent-stalled', 'stalled'),
      createAgent('agent-wedged', 'wedged'),
      createAgent('agent-dead', 'dead'),
      createAgent('agent-unavailable', 'unavailable'),
      {
        id: 'agent-future',
        status: 'future-status',
        reasons: [],
      } as unknown as AgentHealthSnapshot,
    ];
    hookState.current = createSnapshot(agents);

    renderDashboard();

    expect(await screen.findByText('TLDR · Not configured (optional)')).toBeInTheDocument();
    expect(screen.getByLabelText('agent-wedged status: Wedged')).toBeInTheDocument();
    expect(screen.getByLabelText('agent-future status: Unavailable')).toBeInTheDocument();
    expect(screen.getByText('Warm · reusable')).toBeInTheDocument();

    for (const [label, count] of [
      ['Healthy', 1],
      ['Idle', 1],
      ['Waiting', 1],
      ['Warning', 1],
      ['Stalled', 1],
      ['Wedged', 1],
      ['Dead', 1],
      ['Unavailable', 2],
    ] as const) {
      expect(screen.getByLabelText(`${label} agents: ${count}`)).toBeInTheDocument();
    }

    expect(screen.getByLabelText('Idle agents: 1')).not.toHaveClass('badge-bg-warning');
    expect(screen.getByLabelText('Waiting agents: 1')).not.toHaveClass('badge-bg-destructive');
  });

  it('lists only orphaned specialists as reclaimable while warm sessions remain reusable', async () => {
    hookState.current = createSnapshot([
      createAgent('specialist-overdeck-PAN-2647-review-agent', 'idle', {
        lifecycle: 'warm',
        kind: 'specialist',
      }),
      createAgent('specialist-overdeck-PAN-2646-test-agent', 'unavailable', {
        lifecycle: 'orphaned',
        kind: 'specialist',
      }),
    ]);

    renderDashboard();

    expect(await screen.findByText('TLDR · Not configured (optional)')).toBeInTheDocument();
    expect(screen.getByText('Warm · reusable')).toBeInTheDocument();
    const reclaimable = screen.getByRole('heading', { name: 'Reclaimable sessions' }).parentElement;
    expect(reclaimable).not.toBeNull();
    expect(within(reclaimable!).getByText('specialist-overdeck-PAN-2646-test-agent')).toBeInTheDocument();
    expect(within(reclaimable!).queryByText('specialist-overdeck-PAN-2647-review-agent')).not.toBeInTheDocument();
  });

  it('preserves the per-project specialist cards', async () => {
    stubServiceQueries([{
      projectKey: 'overdeck',
      specialistType: 'review-agent',
      metadata: {
        runCount: 3,
        lastRunAt: '2026-07-17T04:00:00.000Z',
        lastRunStatus: 'passed',
        currentRun: null,
      },
      isRunning: false,
      tmuxSession: 'specialist-overdeck-review-agent',
    }]);

    renderDashboard();

    expect(await screen.findByRole('heading', { name: /Per-Project Specialists/i })).toBeInTheDocument();
    expect(screen.getByText('OVERDECK')).toBeInTheDocument();
    expect(screen.getByText('review-agent')).toBeInTheDocument();
  });

  it('renders unavailable host measurements honestly instead of as zero', async () => {
    const snapshot = createSnapshot([createAgent('agent-unavailable', 'unavailable')]);
    snapshot.state = 'unavailable';
    snapshot.host.state = 'unavailable';
    snapshot.host.metrics.cpuPercent = null;
    snapshot.host.metrics.availableMemoryBytes = null;
    hookState.current = snapshot;

    renderDashboard();

    expect(await screen.findByText('TLDR · Not configured (optional)')).toBeInTheDocument();
    expect(screen.getByText('CPU unavailable')).toBeInTheDocument();
    expect(screen.getByText('Memory unavailable')).toBeInTheDocument();
    expect(screen.getByLabelText('agent-unavailable status: Unavailable')).toBeInTheDocument();
  });
});

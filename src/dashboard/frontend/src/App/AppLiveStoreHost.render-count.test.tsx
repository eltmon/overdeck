import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DomainEvent } from '@overdeck/contracts';
import { AppLiveStoreHost, countRunningAgents } from './AppLiveStoreHost';
import { useDashboardStore } from '../lib/store';
import {
  applyStoreEvents,
  createRenderCounter,
  resetDashboardStore,
  seedDashboardStore,
} from '../test-utils/renderCounter';

const TIMESTAMP = '2026-10-19T00:00:00.000Z';

function issue(n: number, priority: number) {
  return {
    id: `PAN-${n}`,
    identifier: `PAN-${n}`,
    title: `Issue ${n}`,
    status: 'In Progress',
    canonicalStatus: 'in_progress',
    priority,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    labels: [],
  };
}

function event(type: string, payload: Record<string, unknown>, sequence: number): DomainEvent {
  return { type, sequence, timestamp: TIMESTAMP, payload } as DomainEvent;
}

const runtimeEvent = (sequence: number) =>
  event('agent.activity_changed', { agentId: 'agent-pan-1', activity: 'working', currentTool: 'Read' }, sequence);
const nonTitleIssueEvent = (sequence: number) =>
  event('issues.delta', { length: 2, changes: [{ index: 0, issue: issue(1, 1) }] }, sequence);

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return client;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])));
  seedDashboardStore({
    issuesRaw: [issue(1, 2), issue(2, 2)],
    agentsById: {
      'agent-pan-1': { id: 'agent-pan-1', issueId: 'PAN-1', status: 'running', role: 'work' },
      'agent-pan-2': { id: 'agent-pan-2', issueId: 'PAN-2', status: 'running', role: 'work' },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetDashboardStore();
});

describe('AppLiveStoreHost', () => {
  it('does not re-render for a runtime event or a non-title issue change', async () => {
    const counter = createRenderCounter();
    const client = renderWithClient(
      <counter.Probe id="host">
        <AppLiveStoreHost />
      </counter.Probe>,
    );
    await vi.waitFor(() => expect(client.isFetching()).toBe(0));
    counter.reset();

    applyStoreEvents([runtimeEvent(1)]);
    applyStoreEvents([nonTitleIssueEvent(2)]);

    expect(counter.count('host')).toBe(0);
  });

  it('opens the AskUserQuestion dialog for an agent whose enrichment carries one', async () => {
    const client = renderWithClient(<AppLiveStoreHost />);
    await vi.waitFor(() => expect(client.isFetching()).toBe(0));

    applyStoreEvents([
      event('agent.enrichment_changed', {
        agentId: 'agent-pan-1',
        issueId: 'PAN-1',
        pendingAskUserQuestion: {
          toolUseId: 'tool-1',
          askedAt: TIMESTAMP,
          questions: [{ question: 'Ship the render fixes?', options: [{ label: 'Yes' }, { label: 'No' }] }],
        },
      }, 1),
    ]);

    expect(await screen.findByText('Ship the render fixes?')).toBeInTheDocument();
  });
});

describe('App shell selectors', () => {
  it('do not re-render the shell for a runtime event or an issue change', () => {
    const counter = createRenderCounter();
    function ShellSelectors() {
      const running = useDashboardStore((s) => countRunningAgents(s.agentsById));
      const drawer = useDashboardStore((s) => s.drawer);
      const openIssue = useDashboardStore((s) => s.openIssue);
      return <span data-drawer={drawer.issueId ?? ''} data-open={typeof openIssue}>{running}</span>;
    }
    renderWithClient(
      <counter.Probe id="shell">
        <ShellSelectors />
      </counter.Probe>,
    );

    applyStoreEvents([runtimeEvent(1)]);
    applyStoreEvents([nonTitleIssueEvent(2)]);

    expect(counter.count('shell')).toBe(0);
  });
});

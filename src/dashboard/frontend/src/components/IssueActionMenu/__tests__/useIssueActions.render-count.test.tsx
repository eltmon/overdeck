import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackendPane, DomainEvent } from '@overdeck/contracts';
import { DialogProvider } from '../../DialogProvider';
import { useIssueActions } from '../useIssueActions';
import { applyStoreEvents, resetDashboardStore, seedDashboardStore } from '../../../test-utils/renderCounter';

const TIMESTAMP = '2026-10-19T00:00:00.000Z';

function issue(n: number, title: string) {
  return {
    id: `issue-${n}`,
    identifier: `PAN-${n}`,
    title,
    status: 'In Progress',
    canonicalStatus: 'in_progress',
    priority: 2,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    labels: [],
  };
}

function pane(n: number): BackendPane {
  return { id: `p-${n}`, issue: `PAN-${n}`, role: 'work', harness: 'claude-code', model: 'claude-opus-5-5', state: 'working' };
}

function event(type: string, payload: Record<string, unknown>, sequence: number): DomainEvent {
  return { type, sequence, timestamp: TIMESTAMP, payload } as DomainEvent;
}

function statusChanged(n: number, status: string, sequence: number): DomainEvent {
  return event('agent.status_changed', { agentId: `agent-pan-${n}`, issueId: `PAN-${n}`, status }, sequence);
}

function renderIssueActions(issueId: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <DialogProvider>{children}</DialogProvider>
    </QueryClientProvider>
  );
  const renders = { count: 0 };
  renderHook(() => {
    renders.count += 1;
    return useIssueActions(issueId);
  }, { wrapper });
  return { client, renders };
}

/** Lets the hook's mount-time queries resolve, then zeroes the render count. */
async function settle(client: QueryClient, renders: { count: number }): Promise<void> {
  await vi.waitFor(() => expect(client.isFetching()).toBe(0));
  renders.count = 0;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/orders') return Response.json({ books: [] });
    if (url.includes('/planning-state')) return Response.json({ hasPlan: true, hasTasks: true });
    if (url.includes('/api/workspaces/')) return Response.json({ exists: true });
    return Response.json({});
  }));
  seedDashboardStore({
    issuesRaw: [issue(1, 'First issue'), issue(2, 'Second issue')],
    agentsById: {
      'agent-pan-1': { id: 'agent-pan-1', issueId: 'PAN-1', status: 'running', role: 'work' },
      'agent-pan-2': { id: 'agent-pan-2', issueId: 'PAN-2', status: 'running', role: 'work' },
    },
    backendPanesById: { 'p-1': pane(1), 'p-2': pane(2) },
  });
});

afterEach(() => {
  resetDashboardStore();
  vi.unstubAllGlobals();
});

describe('useIssueActions render isolation', () => {
  it('does not re-render for another issue pane, agent or row', async () => {
    const { client, renders } = renderIssueActions('PAN-1');
    await settle(client, renders);

    applyStoreEvents([event('backend_pane.changed', { pane: { ...pane(2), state: 'idle' } }, 1)]);
    expect(renders.count).toBe(0);

    applyStoreEvents([statusChanged(2, 'stopped', 2)]);
    expect(renders.count).toBe(0);

    applyStoreEvents([event('issues.delta', { length: 2, changes: [{ index: 1, issue: issue(2, 'Renamed second issue') }] }, 3)]);
    expect(renders.count).toBe(0);
  });

  it('re-renders when its own agent changes', async () => {
    const { client, renders } = renderIssueActions('PAN-1');
    await settle(client, renders);

    applyStoreEvents([statusChanged(1, 'stopped', 1)]);

    expect(renders.count).toBeGreaterThanOrEqual(1);
  });
});

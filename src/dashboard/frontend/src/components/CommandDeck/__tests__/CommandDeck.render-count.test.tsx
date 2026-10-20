import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DomainEvent } from '@overdeck/contracts';
import { CommandDeck } from '../index';
import { agentIdsByIssueKey } from '../agentIdsByIssueKey';
import { useCommandDeckSelection } from '../../../lib/commandDeckSelection';
import { usePanesStore } from '../../../lib/panesStore';
import {
  applyStoreEvents,
  createRenderCounter,
  resetDashboardStore,
  seedDashboardStore,
} from '../../../test-utils/renderCounter';

// Children are stubs that never subscribe to the store, so the Probe counts
// only commits CommandDeck itself causes.
vi.mock('../../Stage', () => ({ Stage: () => <div data-testid="stage" /> }));
vi.mock('../../DialogProvider', () => ({ useConfirm: () => async () => true }));
vi.mock('../../sessionFeed/SessionFeedSidebar', () => ({ SessionFeedSidebar: () => <div /> }));
vi.mock('../ZoneBActionStrip', () => ({ ZoneBActionStrip: () => <div /> }));
vi.mock('../SessionView/SessionPanel', () => ({ SessionPanel: () => <div /> }));
vi.mock('../ProjectTree/ProjectNode', () => ({ ProjectNode: () => <div />, ProjectFeature: {} }));
vi.mock('../ConversationList', () => ({ ConversationList: () => <div /> }));
vi.mock('../ProjectOverview', () => ({ ProjectOverview: () => <div /> }));
vi.mock('../FeatureMetadata/BadgeBar', () => ({ BadgeBar: () => <div /> }));
vi.mock('../DeaconStatus', () => ({ DeaconStatus: () => <div /> }));
vi.mock('../../chat/ConversationPanel', () => ({ ConversationPanel: () => <div /> }));
vi.mock('../../TasksDialog', () => ({ TasksDialog: () => <div /> }));
vi.mock('../../chat/ModelPicker', () => ({
  ModelPicker: () => <div />,
  loadStoredModel: () => 'claude-sonnet',
  saveStoredModel: () => {},
  loadStoredHarness: () => 'claude-code',
  saveStoredHarness: () => {},
  onKnownModelsSync: () => () => {},
  MODEL_EFFORT_SUPPORT: {},
}));
vi.mock('../../../lib/wsTransport', () => ({
  getTransport: () => ({ subscribe: () => () => {} }),
  dashboardMutationJsonHeaders: () => ({}),
}));

const TIMESTAMP = '2026-10-19T00:00:00.000Z';

function issue(n: number, priority: number) {
  return {
    id: `issue-${n}`,
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

function agent(n: number) {
  return { id: `agent-pan-${n}`, issueId: `PAN-${n}`, status: 'running' as const, role: 'work' as const };
}

function event(type: string, payload: Record<string, unknown>, sequence: number): DomainEvent {
  return { type, sequence, timestamp: TIMESTAMP, payload } as DomainEvent;
}

async function renderDeck() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const counter = createRenderCounter();
  render(
    <QueryClientProvider client={client}>
      <counter.Probe id="deck">
        <CommandDeck />
      </counter.Probe>
    </QueryClientProvider>,
  );
  await vi.waitFor(() => expect(client.isFetching()).toBe(0));
  counter.reset();
  // Fake timers from here on: the agent-set invalidation debounce must not run on real time.
  vi.useFakeTimers();
  return { counter, client };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])));
  useCommandDeckSelection.getState().clearAll();
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} });
  localStorage.clear();
  seedDashboardStore({
    issuesRaw: [issue(1, 2), issue(2, 2)],
    agentsById: { 'agent-pan-1': agent(1), 'agent-pan-2': agent(2) },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetDashboardStore();
});

describe('CommandDeck root subscriptions', () => {
  it('does not re-render for runtime, status-only or non-title issue changes', async () => {
    const { counter } = await renderDeck();

    applyStoreEvents([event('agent.activity_changed', { agentId: 'agent-pan-1', activity: 'working', currentTool: 'Read' }, 1)]);
    expect(counter.count('deck')).toBe(0);

    applyStoreEvents([event('agent.status_changed', { agentId: 'agent-pan-1', issueId: 'PAN-1', status: 'stopped' }, 2)]);
    expect(counter.count('deck')).toBe(0);

    applyStoreEvents([event('issues.delta', { length: 2, changes: [{ index: 0, issue: issue(1, 1) }] }, 3)]);
    expect(counter.count('deck')).toBe(0);
  });

  it('re-renders and invalidates the projects query when an agent with a new id appears', async () => {
    const { counter, client } = await renderDeck();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    applyStoreEvents([event('agent.created', { agentId: 'agent-pan-3', issueId: 'PAN-3', agent: agent(3) }, 1)]);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(counter.count('deck')).toBeGreaterThanOrEqual(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['command-deck-projects'] });
  });
});

describe('agentIdsByIssueKey', () => {
  it('maps each lowercased issue id to its agent- prefixed agent, as resolveIssue did', () => {
    const map = agentIdsByIssueKey({
      'review-pan-1-a': { id: 'review-pan-1-a', issueId: 'PAN-1' },
      'agent-pan-1': { id: 'agent-pan-1', issueId: 'PAN-1' },
      'planning-pan-2': { id: 'planning-pan-2', issueId: 'PAN-2' },
      'conv-1': { id: 'conv-1' },
    });
    expect(map).toEqual({ 'pan-1': 'agent-pan-1', 'pan-2': 'planning-pan-2' });
  });
});

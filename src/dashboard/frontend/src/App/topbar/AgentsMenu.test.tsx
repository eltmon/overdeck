import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDashboardStore } from '../../lib/store';
import type { AgentsWorking, WorkingRow } from '../../lib/selectors/agentsWorking';
import type { Agent, Issue } from '../../types';

const mocks = vi.hoisted(() => ({
  working: { count: 0, byRole: {}, rows: [] } as unknown as AgentsWorking,
  triggerEmergencyStop: vi.fn(),
}));

vi.mock('../../lib/selectors/agentsWorking', () => ({
  useAgentsWorking: () => mocks.working,
}));

vi.mock('../../components/EmergencyStopOverlay', () => ({
  triggerEmergencyStop: mocks.triggerEmergencyStop,
}));

import { AgentsMenu } from './AgentsMenu';

const CONVERSATIONS = [
  { name: 'fort-fixes', title: 'Fort 3D pop-in fixes', model: 'claude-fable-5-2', createdAt: '2026-07-18T11:00:00.000Z', lastActivityAt: '2026-07-18T11:54:00.000Z' },
];
const PROJECTS = [{ key: 'panopticon-cli', name: 'overdeck', path: '/p/overdeck' }];

function agent(overrides: Partial<Agent>): Agent {
  return {
    id: 'agent-pan-1',
    issueId: 'PAN-1',
    role: 'work',
    runtime: 'claude-code',
    model: 'claude-opus-5-5',
    status: 'running',
    startedAt: '2026-07-18T11:00:00.000Z',
    lastActivity: '2026-07-18T11:48:00.000Z',
    consecutiveFailures: 0,
    killCount: 0,
    ...overrides,
  };
}

function issue(identifier: string, title: string): Issue {
  return {
    id: identifier,
    identifier,
    title,
    status: 'In Progress',
    priority: 2,
    labels: [],
    url: `https://github.com/eltmon/overdeck/issues/${identifier}`,
    createdAt: '2026-07-18T10:00:00.000Z',
    updatedAt: '2026-07-18T11:00:00.000Z',
  };
}

function agentRow(id: string, issueId: string): WorkingRow {
  return { key: `agent:${id}`, kind: 'agent', id, label: issueId, role: 'building', projectKey: 'panopticon-cli', issueId };
}

const CONVERSATION_ROW: WorkingRow = {
  key: 'conversation:fort-fixes',
  kind: 'conversation',
  id: 'fort-fixes',
  label: 'Fort 3D pop-in fixes',
  role: 'conversation',
};

function setWorking(rows: WorkingRow[]) {
  mocks.working = { count: rows.length, byRole: {} as AgentsWorking['byRole'], rows };
}

function renderMenu() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  queryClient.setQueryData(['conversations'], CONVERSATIONS);
  queryClient.setQueryData(['registered-projects'], PROJECTS);
  return render(
    <QueryClientProvider client={queryClient}>
      <AgentsMenu />
    </QueryClientProvider>,
  );
}

describe('AgentsMenu', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-18T12:00:00.000Z'));
    window.history.replaceState(null, '', '/');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes('/api/conversations') ? CONVERSATIONS : url.includes('/api/registered-projects') ? PROJECTS : {};
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    useDashboardStore.setState({
      agentsById: {
        'agent-pan-1': agent({ id: 'agent-pan-1', issueId: 'PAN-1' }),
        'agent-pan-2': agent({ id: 'agent-pan-2', issueId: 'PAN-2', model: 'gpt-6.1', lastActivity: '2026-07-18T11:19:00.000Z' }),
      },
      issuesRaw: [issue('PAN-1', 'First issue'), issue('PAN-2', 'Second issue')],
    } as Parameters<typeof useDashboardStore.setState>[0]);
  });

  afterEach(() => {
    useDashboardStore.setState({ agentsById: {}, issuesRaw: [] } as Parameters<typeof useDashboardStore.setState>[0]);
    mocks.triggerEmergencyStop.mockReset();
    setWorking([]);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each([
    [[], 'No agents working'],
    [[agentRow('agent-pan-1', 'PAN-1')], '1 agent working'],
    [[agentRow('agent-pan-1', 'PAN-1'), agentRow('agent-pan-2', 'PAN-2'), CONVERSATION_ROW], '3 agents working'],
  ] as const)('labels %# rows as "%s" and opens a menu with exactly that many rows', (rows, label) => {
    setWorking([...rows]);
    renderMenu();

    const trigger = screen.getByTestId('agents-menu-trigger');
    expect(trigger).toHaveTextContent(label);
    fireEvent.click(trigger);

    const menu = screen.getByTestId('agents-menu');
    expect(within(menu).queryAllByTestId('agents-menu-row')).toHaveLength(rows.length);
    if (rows.length === 0) expect(menu).toHaveTextContent('Nothing is running.');
  });

  it('shows title, project · role · model and age, newest first', () => {
    setWorking([agentRow('agent-pan-2', 'PAN-2'), CONVERSATION_ROW, agentRow('agent-pan-1', 'PAN-1')]);
    renderMenu();
    fireEvent.click(screen.getByTestId('agents-menu-trigger'));

    const rows = screen.getAllByTestId('agents-menu-row');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Fort 3D pop-in fixesconversation · claude-fable-5-26m ago',
      'PAN-1 — First issueoverdeck · building · claude-opus-5-512m ago',
      'PAN-2 — Second issueoverdeck · building · gpt-6.141m ago',
    ]);
  });

  it('sends a conversation row to /conv/<name> and an issue agent row to /issues/<ID>, closing the menu', () => {
    setWorking([CONVERSATION_ROW, agentRow('agent-pan-1', 'PAN-1')]);
    renderMenu();

    fireEvent.click(screen.getByTestId('agents-menu-trigger'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Fort 3D pop-in fixes/ }));
    expect(window.location.pathname).toBe('/conv/fort-fixes');
    expect(screen.queryByTestId('agents-menu')).toBeNull();

    fireEvent.click(screen.getByTestId('agents-menu-trigger'));
    fireEvent.click(screen.getByRole('menuitem', { name: /PAN-1 — First issue/ }));
    expect(window.location.pathname).toBe('/issues/PAN-1');
    expect(screen.queryByTestId('agents-menu')).toBeNull();
  });

  it('opens the Agents page from its footer row', () => {
    setWorking([agentRow('agent-pan-1', 'PAN-1')]);
    renderMenu();
    fireEvent.click(screen.getByTestId('agents-menu-trigger'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open the Agents page' }));
    expect(window.location.pathname).toBe('/agents');
    expect(screen.queryByTestId('agents-menu')).toBeNull();
  });

  it('calls triggerEmergencyStop once from "Stop all agents…" when agents are working', () => {
    setWorking([agentRow('agent-pan-1', 'PAN-1')]);
    renderMenu();
    fireEvent.click(screen.getByTestId('agents-menu-trigger'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stop all agents…' }));
    expect(mocks.triggerEmergencyStop).toHaveBeenCalledTimes(1);
  });

  it('disables "Stop all agents…" with a reason when nothing is working', () => {
    setWorking([]);
    renderMenu();
    fireEvent.click(screen.getByTestId('agents-menu-trigger'));
    const stop = screen.getByRole('menuitem', { name: 'Stop all agents…' });
    expect(stop).toBeDisabled();
    expect(stop).toHaveAttribute('title', 'No agents are working');
    fireEvent.click(stop);
    expect(mocks.triggerEmergencyStop).not.toHaveBeenCalled();
  });

  it('closes on Escape and on a pointer-down outside', () => {
    setWorking([agentRow('agent-pan-1', 'PAN-1')]);
    renderMenu();
    fireEvent.click(screen.getByTestId('agents-menu-trigger'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('agents-menu')).toBeNull();

    fireEvent.click(screen.getByTestId('agents-menu-trigger'));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('agents-menu')).toBeNull();
  });

  it('paints the trigger dot running-blue when agents work, never emerald', () => {
    setWorking([agentRow('agent-pan-1', 'PAN-1')]);
    const { unmount } = renderMenu();
    const dot = screen.getByTestId('agents-menu-dot');
    expect(dot).toHaveClass('bg-state-live');
    expect(dot.className).not.toMatch(/emerald/);
    unmount();

    setWorking([]);
    renderMenu();
    expect(screen.getByTestId('agents-menu-dot')).toHaveClass('bg-state-waiting');
    expect(screen.getByTestId('agents-menu-dot').className).not.toMatch(/emerald/);
  });
});

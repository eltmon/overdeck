/** PAN-4651 WI-20 (D-4651-15): a linked machine's AskUserQuestion shows in this machine's Needs-You. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DecisionsCount, DecisionsPanel } from '../../components/DecisionsPanel';
import { fetchFleetNeedsYou, fleetDecisions, unreachableMachineDecisions } from '../useDecisions';

const MACHINES = [{
  environmentId: 'env-desk',
  label: 'desk',
  conversations: [{ name: 'conv-q', title: 'Pick a database', pendingInputKinds: ['askUserQuestion'] }],
  agents: [{ id: 'agent-pan-7', issueId: 'PAN-7', pendingInputKinds: ['permissionRequest'] }],
}];

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/fleet/needs-you') return new Response(JSON.stringify({ machines: MACHINES }), { status: 200 });
    if (url === '/api/conversations/pending-input') return new Response('[]', { status: 200 });
    return new Response('{}', { status: 404 });
  }));
});

afterEach(() => vi.unstubAllGlobals());

describe('fleet Needs-You (PAN-4651 WI-20)', () => {
  it('maps rows to @<env>/<name> with the machine label, remote', () => {
    const decisions = fleetDecisions(MACHINES);
    expect(decisions.map((d) => [d.id, d.source, d.machineLabel, d.remote])).toEqual([
      ['@env-desk/conv-q', 'conversation', 'desk', true],
      ['@env-desk/agent-pan-7', 'agent', 'desk', true],
    ]);
    expect(fleetDecisions([{ ...MACHINES[0]!, conversations: 'oops' as never }]).length).toBe(1);
  });

  it('ac20: renders on desk and Open goes to /conv/@<env>/<name>; remote rows offer no inline answer', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><DecisionsPanel /></QueryClientProvider>);
    const row = (await screen.findByText('Pick a database')).closest('[data-decision-id]') as HTMLElement;
    expect(row.getAttribute('data-decision-id')).toBe('@env-desk/conv-q');
    expect(within(row).getByText('· on desk')).toBeTruthy();
    expect(within(row).queryByRole('button', { name: 'Answer' })).toBeNull();
    const pushState = vi.spyOn(window.history, 'pushState');
    fireEvent.click(within(row).getByRole('button', { name: 'Open' }));
    expect(pushState).toHaveBeenCalledWith({}, '', '/conv/@env-desk/conv-q');
    pushState.mockRestore();
    const agentRow = document.querySelector('[data-decision-id="@env-desk/agent-pan-7"]') as HTMLElement;
    expect(within(agentRow).getByText('· on desk')).toBeTruthy();
    expect(within(agentRow).queryByRole('button')).toBeNull();
  });
});

describe('unreachable linked machines (PAN-5111)', () => {
  const AIR = {
    environmentId: 'env-air',
    label: 'Edwards-MacBook-Air.local',
    since: '2026-11-10T11:00:00.000Z',
    reason: 'Secure channel did not open within 10000 ms',
  };

  it('maps a row to a non-blocking Can\'t reach decision', () => {
    expect(unreachableMachineDecisions([AIR])).toEqual([{
      id: 'unreachable:env-air',
      source: 'agent',
      label: "Can't reach Edwards-MacBook-Air.local",
      kinds: ['machineUnreachable'],
      since: AIR.since,
      blocking: false,
      machineLabel: 'Edwards-MacBook-Air.local',
      unreachableMachine: AIR,
    }]);
  });

  it('answers empty lists on a 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'nope' }), { status: 403 })));
    expect(await fetchFleetNeedsYou()).toEqual({ machines: [], unreachable: [] });
  });

  it('renders the card in the System group and counts it', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/fleet/needs-you') return new Response(JSON.stringify({ machines: [], unreachable: [AIR] }), { status: 200 });
      if (url === '/api/conversations/pending-input') return new Response('[]', { status: 200 });
      return new Response('{}', { status: 404 });
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><DecisionsPanel /><DecisionsCount /></QueryClientProvider>);
    const card = await screen.findByTestId('unreachable-machine-card');
    expect(card.textContent).toContain("Can't reach Edwards-MacBook-Air.local; it may have items waiting.");
    expect(card.textContent).toContain('Secure channel did not open within 10000 ms');
    expect(screen.getByText('System').closest('section')?.contains(card)).toBe(true);
    expect(within(card).queryByRole('button', { name: 'Answer' })).toBeNull();
    expect(within(card).getByRole('button', { name: 'Open Machines' })).toBeTruthy();
    expect(screen.getByTestId('decisions-count').textContent).toContain('1');
  });
});

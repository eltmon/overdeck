/** PAN-4651 WI-20 (D-4651-15): a linked machine's AskUserQuestion shows in this machine's Needs-You. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DecisionsPanel } from '../../components/DecisionsPanel';
import { fleetDecisions } from '../useDecisions';

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

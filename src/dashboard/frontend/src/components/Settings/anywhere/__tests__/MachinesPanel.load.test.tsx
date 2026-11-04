/** PAN-4651 WI-9 (FR-6, FR-7): the Machines panel meta lines carry load and tags. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DialogProvider } from '../../../DialogProvider';
import { MachinesPanel } from '../MachinesPanel';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

const GIB = 2 ** 30;
const BASE = {
  environmentId: 'env-desk', fingerprint: 'a1b2-c3d4-e5f6-0718-293a', access: 'operator', state: 'online', stateDetail: null,
  currentRoute: null, routes: [], lastHeartbeatAt: null, incident: null, peerVersion: '0.73.0', createdAt: '2026-11-01T00:00:00.000Z',
};
const MACHINES = {
  self: {
    environmentId: 'env-self', label: 'studio', fingerprint: '1111-2222-3333-4444-5555', shareConversations: true,
    load: { cpuPsiSomeAvg10: 1.2, cpuSaturated: false, memAvailableBytes: 12 * GIB, workingAgents: 0, sampledAt: '2026-11-01T12:00:00.000Z' }, tags: ['linux'], placement: 'auto',
  },
  links: [
    {
      ...BASE, id: 'link-1', label: 'desk',
      load: { cpuPsiSomeAvg10: 3.4, cpuSaturated: false, memAvailableBytes: 41 * GIB + 5, workingAgents: 2, sampledAt: '2026-11-01T12:00:00.000Z' },
      tags: ['docker', 'linux'], placement: 'on-request',
    },
    { ...BASE, id: 'link-2', environmentId: 'env-old', label: 'old' },
  ],
  inbound: [],
};

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) } as Response;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
    const url = input.toString();
    if (url === '/api/machines') return Promise.resolve(jsonResponse(200, MACHINES));
    return Promise.resolve(jsonResponse(404, { error: 'not found' }));
  }));
});

afterEach(() => vi.unstubAllGlobals());

describe('MachinesPanel load and tags (PAN-4651 WI-9)', () => {
  it('ac9: a link with a load sample shows CPU 3% · 41 GB · 2 agents, its tags and reserved', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DialogProvider><MachinesPanel /></DialogProvider></QueryClientProvider>);
    const desk = await screen.findByTestId('machine-link-link-1');
    expect(within(desk).getByTestId('machine-load')).toHaveTextContent('CPU 3% · 41 GB · 2 agents · tags: docker, linux · reserved');
    expect(screen.getByText(/This machine: studio/)).toHaveTextContent('CPU 1% · 12 GB · 0 agents · tags: linux');
  });

  it('a link without a sample renders no load text', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DialogProvider><MachinesPanel /></DialogProvider></QueryClientProvider>);
    const old = await screen.findByTestId('machine-link-link-2');
    expect(within(old).queryByTestId('machine-load')).toBeNull();
  });
});

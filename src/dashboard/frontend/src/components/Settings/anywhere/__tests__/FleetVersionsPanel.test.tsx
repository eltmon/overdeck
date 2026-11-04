import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DialogProvider } from '../../../DialogProvider';
import { FleetVersionsPanel } from '../FleetVersionsPanel';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('../../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

const HARNESSES = [
  { binary: 'claude', label: 'Claude Code', harnesses: ['claude-code'], version: '2.1.5', updatable: true, command: 'claude update', reason: null },
  { binary: 'codex', label: 'Codex CLI', harnesses: ['codex'], version: '0.159.0', updatable: true, command: 'codex update', reason: null },
];

function report(label: string, job: unknown = null) {
  return { environmentId: `env-${label}`, label, overdeck: { version: '0.73.0', installMode: 'npm-global', linkProtocol: 1 }, harnesses: HARNESSES, job };
}

const DONE_JOB = {
  id: 'job-1', mode: 'when-idle', phase: 'done', requestedBy: 'operator', startedAt: '2026-11-01T11:00:00.000Z',
  waitingTurns: 0, waitingSince: null, finishedAt: '2026-11-01T11:05:00.000Z',
  components: [
    { name: 'claude', label: 'Claude Code', before: '2.1.0', after: '2.1.5', status: 'updated', detail: null },
    { name: 'overdeck', label: 'Overdeck', before: '0.73.0', after: null, status: 'skipped', detail: 'development install' },
  ],
};

const WAITING_JOB = { ...DONE_JOB, id: 'job-2', phase: 'waiting', waitingTurns: 2, waitingSince: new Date().toISOString(), finishedAt: null, components: [] };

const ROWS = [
  { environmentId: 'env-studio', label: 'studio', self: true, state: 'self', stateDetail: null, peerVersion: '0.73.0', report: report('studio', DONE_JOB), updateSupported: true, install: null, error: null },
  { environmentId: 'env-desk', label: 'desk', self: false, state: 'online', stateDetail: null, peerVersion: '0.73.0', report: report('desk', WAITING_JOB), updateSupported: true, install: null, error: null },
  {
    environmentId: 'env-attic', label: 'attic', self: false, state: 'unsupported', stateDetail: 'Install Overdeck 0.73.0 on attic', peerVersion: '0.71.0',
    report: null, updateSupported: false, install: { version: '0.73.0', on: 'peer', command: 'npm install -g @overdeck/core@0.73.0' }, error: null,
  },
];

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) } as Response;
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DialogProvider><FleetVersionsPanel /></DialogProvider>
    </QueryClientProvider>,
  );
}

function updateBodies(): unknown[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => input.toString() === '/api/machines/update' && (init as RequestInit | undefined)?.method === 'POST')
    .map(([, init]) => JSON.parse((init as RequestInit).body as string));
}

describe('FleetVersionsPanel (PAN-4654 WI-9)', () => {
  beforeEach(() => {
    fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/machines/versions' && !init?.method) return Promise.resolve(jsonResponse(200, { rows: ROWS }));
      if (url === '/api/machines/update' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse(200, { started: [{ environmentId: 'env-desk', label: 'desk', job: WAITING_JOB }], skipped: [{ environmentId: 'env-attic', label: 'attic', reason: 'attic is unsupported' }] }));
      }
      return Promise.resolve(jsonResponse(404, { error: 'not found' }));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders one row per machine with claude and codex columns and shows 2.1.0 → 2.1.5', async () => {
    renderPanel();
    const studio = await screen.findByTestId('fleet-row-env-studio');
    const panel = screen.getByTestId('fleet-versions-panel');
    const headers = within(panel).getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toEqual(['Machine', 'State', 'Overdeck', 'Claude Code', 'Codex CLI', 'Update']);
    expect(screen.getByTestId('fleet-row-env-desk')).toBeInTheDocument();
    expect(within(studio).getByText('2.1.0 → 2.1.5')).toBeInTheDocument();
    expect(within(studio).getByText(/this machine/)).toBeInTheDocument();
    expect(within(studio).queryByTestId('machine-link-state')).toBeNull();
    expect(within(studio).getByTestId('fleet-job')).toHaveTextContent('Done');
  });

  it('Update all posts { mode: when-idle } after confirm', async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByTestId('fleet-row-env-studio');
    await user.click(screen.getByTestId('fleet-update-all'));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/on 2 online machines\? Each machine waits for its running turns to end\./)).toBeInTheDocument();
    expect(updateBodies()).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Update all' }));
    await waitFor(() => expect(updateBodies()).toEqual([{ mode: 'when-idle' }]));
  });

  it('a waiting row shows "Waiting for 2 turns" and Update now posts { mode: now, environmentIds: [id] }', async () => {
    const user = userEvent.setup();
    renderPanel();
    const desk = await screen.findByTestId('fleet-row-env-desk');
    expect(within(desk).getByTestId('fleet-job')).toHaveTextContent('Waiting for 2 turns');
    await user.click(within(desk).getByTestId('fleet-update-now'));
    await waitFor(() => expect(updateBodies()).toEqual([{ mode: 'now', environmentIds: ['env-desk'] }]));
    await user.click(within(desk).getByTestId('fleet-cancel'));
    await waitFor(() => expect(updateBodies()).toContainEqual({ cancel: true, environmentIds: ['env-desk'] }));
  });

  it('an unsupported row shows the amber badge and the npm install command', async () => {
    renderPanel();
    const attic = await screen.findByTestId('fleet-row-env-attic');
    const badge = within(attic).getByTestId('machine-link-state');
    expect(badge.dataset.state).toBe('unsupported');
    expect(badge.className).toContain('text-warning-foreground');
    expect(screen.getByText('npm install -g @overdeck/core@0.73.0')).toBeInTheDocument();
    expect(screen.getByText(/Install Overdeck 0.73.0 on attic/)).toBeInTheDocument();
  });
});

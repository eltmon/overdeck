/** PAN-4743 WI-9: the Add a Fly machine dialog. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { toast } from 'sonner';
import { AddFlyMachineDialog } from '../AddFlyMachineDialog';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

let fetchMock: ReturnType<typeof vi.fn>;
let routes: Record<string, (init?: RequestInit) => { status: number; body: unknown }>;

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) } as Response;
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function callsTo(url: string) {
  return fetchMock.mock.calls.filter(([input]) => input.toString() === url);
}

beforeEach(() => {
  routes = {
    'GET /api/registered-projects': () => ({ status: 200, body: [{ key: 'overdeck', name: 'Overdeck', path: '/p/overdeck' }] }),
  };
  fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${input.toString()}`;
    const handler = routes[key];
    return Promise.resolve(handler ? jsonResponse(handler(init).status, handler(init).body) : jsonResponse(404, { error: `no route ${key}` }));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('AddFlyMachineDialog (PAN-4743 WI-9)', () => {
  it('ac1: submits { projectKey, region } with a project and region chosen', async () => {
    routes['POST /api/machines/fly'] = () => ({ status: 201, body: { link: { id: 'link-1' }, record: { label: 'fly-m1', appName: 'pan-workspaces', region: 'ord', docker: true } } });
    const onClose = vi.fn();
    renderWithProviders(<AddFlyMachineDialog open onClose={onClose} />);
    await screen.findByRole('option', { name: 'Overdeck' });
    await userEvent.selectOptions(screen.getByLabelText('Project'), 'overdeck');
    await userEvent.click(screen.getByText('Advanced'));
    await userEvent.type(screen.getByLabelText('Region'), 'ord');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(JSON.parse(String((callsTo('/api/machines/fly')[0]![1] as RequestInit).body))).toEqual({ projectKey: 'overdeck', region: 'ord' });
  });

  it('ac1: submits {} with no project and an empty region', async () => {
    routes['POST /api/machines/fly'] = () => ({ status: 201, body: { link: { id: 'link-1' }, record: { label: 'fly-m1', appName: 'pan-workspaces', region: 'iad', docker: true } } });
    const onClose = vi.fn();
    renderWithProviders(<AddFlyMachineDialog open onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(JSON.parse(String((callsTo('/api/machines/fly')[0]![1] as RequestInit).body))).toEqual({});
  });

  it('ac2: a 409 remote-disabled shows the server message and stays open', async () => {
    routes['POST /api/machines/fly'] = () => ({ status: 409, body: { error: 'remote-disabled', message: 'Fly machines need remote turned on: add `enabled = true` under `[remote]` in ~/.overdeck/config.toml.' } });
    const onClose = vi.fn();
    renderWithProviders(<AddFlyMachineDialog open onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Fly machines need remote turned on: add `enabled = true` under `[remote]` in ~/.overdeck/config.toml.');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ac3: a 201 toasts Linked <label> and calls onClose', async () => {
    routes['POST /api/machines/fly'] = () => ({ status: 201, body: { link: { id: 'link-1' }, record: { label: 'fly-m1', appName: 'pan-workspaces', region: 'iad', docker: true } } });
    const onClose = vi.fn();
    renderWithProviders(<AddFlyMachineDialog open onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith('Linked fly-m1 (Fly app pan-workspaces, region iad)');
  });
});

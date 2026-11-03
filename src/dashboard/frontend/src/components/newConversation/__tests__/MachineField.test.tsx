/** PAN-4651 WI-11 (D-4651-23): the Machine and Needs fields of the new-conversation dialog. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));
vi.mock('../../shared/ModelPicker', () => ({
  useAvailableModels: () => ({ groups: [], harnessPolicy: {} }),
  pickerEffortLevels: () => undefined,
  HARNESS_OPTIONS: [{ id: 'claude-code', label: 'Claude Code', description: '' }],
  ModelSelect: ({ value }: { value: string }) => <select aria-label="Model" value={value} onChange={() => undefined}><option value="claude-opus-5-5">Opus</option></select>,
  HarnessSelect: ({ value }: { value: string }) => <select aria-label="Harness" value={value} onChange={() => undefined}><option value="claude-code">Claude Code</option></select>,
}));
vi.mock('../../chat/ModelPicker', () => ({
  loadStoredModel: () => 'claude-opus-5-5',
  loadStoredHarness: () => 'claude-code',
  MODEL_EFFORT_SUPPORT: { 'claude-opus-5-5': [] },
}));

import { toast } from 'sonner';
import { NewConversationDialog } from '../NewConversationDialog';
import { machineCwdHint } from '../MachineField';

const LINK = {
  id: 'link-1', environmentId: 'env-desk', label: 'desk', fingerprint: 'f', access: 'operator', state: 'online', stateDetail: null,
  currentRoute: null, routes: [], lastHeartbeatAt: null, incident: null, peerVersion: '0.73.0', createdAt: '2026-11-01T00:00:00.000Z',
};
const MACHINES = {
  self: { environmentId: 'env-laptop', label: 'laptop', fingerprint: 'f', shareConversations: true },
  links: [LINK, { ...LINK, id: 'link-2', environmentId: 'env-lab', label: 'lab', state: 'offline' }, { ...LINK, id: 'link-3', environmentId: 'env-hid', label: 'hidden-box', hidden: true }],
  inbound: [],
};

let fleetPosts: Array<Record<string, unknown>>;

beforeEach(() => {
  fleetPosts = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/machines') return { ok: true, status: 200, json: async () => MACHINES };
    if (url === '/api/registered-projects') return { ok: true, status: 200, json: async () => [{ key: 'overdeck', name: 'Overdeck', path: '/p/overdeck' }] };
    if (url === '/api/fleet/conversations' && init?.method === 'POST') {
      fleetPosts.push(JSON.parse(String(init.body)));
      return { ok: true, status: 201, json: async () => ({ conversation: '@env-desk/conv-9', machine: { environmentId: 'env-desk', label: 'desk', self: false }, reason: 'Auto → desk (CPU pressure 3%, 41 GB free, 2 agents)' }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }));
});

afterEach(() => vi.unstubAllGlobals());

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><NewConversationDialog onClose={() => undefined} /></QueryClientProvider>);
}

describe('Machine field (PAN-4651 WI-11)', () => {
  it('ac11: offers this machine, Auto, each online visible link, and a Fly entry disabled with no project', async () => {
    renderDialog();
    const select = screen.getByLabelText('Machine') as HTMLSelectElement;
    await waitFor(() => expect(within(select).getByRole('option', { name: 'This machine (laptop)' })).toBeTruthy());
    const options = within(select).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['This machine (laptop)', 'Auto', 'desk', 'Fly (new VM)']);
    const fly = within(select).getByRole('option', { name: 'Fly (new VM)' }) as HTMLOptionElement;
    expect(fly.disabled).toBe(true);
    expect(fly.title).toBe('Fly (new VM) needs a project');
  });

  it('ac1 (PAN-4743): a chosen project enables Fly (new VM)', async () => {
    renderDialog();
    const select = screen.getByLabelText('Machine') as HTMLSelectElement;
    await waitFor(() => expect(within(select).getByRole('option', { name: 'desk' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'overdeck' } });
    const fly = within(select).getByRole('option', { name: 'Fly (new VM)' }) as HTMLOptionElement;
    expect(fly.disabled).toBe(false);
    expect(fly.title).toBe('Starts a new Fly machine, clones the project and runs the conversation there');
  });

  it('ac3 (PAN-4743): clearing the project while Fly (new VM) is chosen resets the Machine field to this machine', async () => {
    renderDialog();
    const select = screen.getByLabelText('Machine') as HTMLSelectElement;
    await waitFor(() => expect(within(select).getByRole('option', { name: 'desk' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'overdeck' } });
    fireEvent.change(select, { target: { value: 'fly' } });
    expect(select.value).toBe('fly');
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: '' } });
    expect(select.value).toBe('');
  });

  it('choosing Auto reveals Needs', async () => {
    renderDialog();
    expect(screen.queryByLabelText('Needs')).toBeNull();
    fireEvent.change(screen.getByLabelText('Machine'), { target: { value: 'auto' } });
    expect(screen.getByLabelText('Needs')).toBeTruthy();
  });

  it('ac11: a remote choice posts /api/fleet/conversations and navigates to /conv/@<env>/<name>', async () => {
    renderDialog();
    const select = screen.getByLabelText('Machine');
    await waitFor(() => expect(within(select).getByRole('option', { name: 'desk' })).toBeTruthy());
    fireEvent.change(select, { target: { value: 'auto' } });
    fireEvent.change(screen.getByLabelText('Needs'), { target: { value: 'Docker, gpu' } });
    fireEvent.change(screen.getByLabelText('First message'), { target: { value: 'hello' } });
    const pushState = vi.spyOn(window.history, 'pushState');
    fireEvent.click(screen.getByRole('button', { name: 'Create conversation' }));
    await waitFor(() => expect(fleetPosts).toHaveLength(1));
    expect(fleetPosts[0]).toEqual({ machine: 'auto', message: 'hello', model: 'claude-opus-5-5', harness: 'claude-code', needs: ['docker', 'gpu'] });
    await waitFor(() => expect(pushState).toHaveBeenCalledWith({}, '', '/conv/@env-desk/conv-9'));
    expect(toast).toHaveBeenCalledWith('Auto → desk (CPU pressure 3%, 41 GB free, 2 agents)');
    pushState.mockRestore();
  });
});

describe('Working directory on another machine (PAN-4872)', () => {
  it('a linked machine empties the field and names it', async () => {
    renderDialog();
    const select = screen.getByLabelText('Machine') as HTMLSelectElement;
    await waitFor(() => expect(within(select).getByRole('option', { name: 'desk' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'overdeck' } });
    fireEvent.change(select, { target: { value: 'env-desk' } });
    const cwdInput = screen.getByLabelText('Working directory') as HTMLInputElement;
    expect(cwdInput.value).toBe('');
    expect(cwdInput.placeholder).toBe('Set by desk: its copy of Overdeck');
    expect(cwdInput.disabled).toBe(true);
  });

  it('switching back restores the edited path', async () => {
    renderDialog();
    const select = screen.getByLabelText('Machine') as HTMLSelectElement;
    await waitFor(() => expect(within(select).getByRole('option', { name: 'desk' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'overdeck' } });
    const cwdInput = screen.getByLabelText('Working directory') as HTMLInputElement;
    fireEvent.change(cwdInput, { target: { value: '/p/overdeck/packages/web' } });
    fireEvent.change(select, { target: { value: 'env-desk' } });
    fireEvent.change(select, { target: { value: '' } });
    expect(cwdInput.value).toBe('/p/overdeck/packages/web');
    expect(cwdInput.disabled).toBe(false);
  });

  it('Auto and Fly name who sets it', async () => {
    renderDialog();
    const select = screen.getByLabelText('Machine') as HTMLSelectElement;
    await waitFor(() => expect(within(select).getByRole('option', { name: 'desk' })).toBeTruthy());
    const cwdInput = screen.getByLabelText('Working directory') as HTMLInputElement;
    fireEvent.change(select, { target: { value: 'auto' } });
    expect(cwdInput.placeholder).toBe('Set by the machine Auto picks: its default working directory');
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'overdeck' } });
    fireEvent.change(select, { target: { value: 'fly' } });
    expect(cwdInput.placeholder).toBe('Set by the new Fly machine: its copy of Overdeck');
  });

  it('a remote create never sends cwd', async () => {
    renderDialog();
    const select = screen.getByLabelText('Machine') as HTMLSelectElement;
    await waitFor(() => expect(within(select).getByRole('option', { name: 'desk' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'overdeck' } });
    fireEvent.change(screen.getByLabelText('Working directory'), { target: { value: '/p/overdeck/packages/web' } });
    fireEvent.change(select, { target: { value: 'env-desk' } });
    fireEvent.change(screen.getByLabelText('First message'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create conversation' }));
    await waitFor(() => expect(fleetPosts).toHaveLength(1));
    expect('cwd' in fleetPosts[0]).toBe(false);
    expect(fleetPosts[0]).toMatchObject({ machine: 'env-desk', projectKey: 'overdeck' });
  });

  it('machineCwdHint: fallback label and this-machine null', () => {
    expect(machineCwdHint('env-gone', null, 'Overdeck')).toBe('Set by the chosen machine: its copy of Overdeck');
    expect(machineCwdHint('', 'x', 'y')).toBe(null);
  });
});

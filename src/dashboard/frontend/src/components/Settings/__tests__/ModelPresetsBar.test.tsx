import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ModelPresetsBar } from '../ModelPresetsBar';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));
vi.mock('../../shared/ModelPicker', () => ({ invalidateAvailableModelsCache: vi.fn() }));

const evidence = { status: 'eval', reportPath: 'docs/model-evals/x.md', summary: 'Opus found 30/60 review blockers.' };

const statusPayload = {
  presets: [
    { id: 'anthropic', label: 'Anthropic defaults', provider: 'anthropic', version: 1, date: '2026-09-29', pilot: false, evidence, updateAvailable: false },
    { id: 'anthropic-cost-saver', label: 'Anthropic cost-saver (pilot)', provider: 'anthropic', version: 1, date: '2026-09-29', pilot: true, evidence, updateAvailable: false },
    { id: 'openai', label: 'OpenAI defaults', provider: 'openai', version: 1, date: '2026-09-29', pilot: false, evidence: { ...evidence, status: 'research' }, updateAvailable: false },
  ],
  undoAvailable: false,
};

const planPayload = {
  presetId: 'anthropic',
  version: 1,
  date: '2026-09-29',
  provider: 'anthropic',
  label: 'Anthropic defaults',
  pilot: false,
  evidence,
  rows: [
    { path: 'workhorses.mid', label: 'Workhorse: mid', group: 'workhorses', before: 'claude-sonnet-5-5', after: 'claude-opus-5-5', status: 'change' },
    { path: 'roles.review.model', label: 'Role review: model', group: 'roles', before: { absent: true }, after: 'workhorse:expensive', status: 'change' },
    { path: 'jev.model', label: 'Jev model', group: 'background', before: { absent: true }, after: { absent: true }, status: 'skipped', reason: 'Third-party judgment service.' },
    { path: 'workhorses.cheap', label: 'Workhorse: cheap', group: 'workhorses', before: 'claude-haiku-4-5', after: 'claude-haiku-4-5', status: 'same' },
  ],
  notes: ['tiered execution has no tiers; nothing to set'],
  digest: 'digest-123',
};

function installFetchMock(opts: { plan?: Record<string, unknown>; applyStatus?: number; status?: typeof statusPayload } = {}) {
  const plan = opts.plan ?? planPayload;
  const status = opts.status ?? statusPayload;
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    if (url === '/api/model-presets') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(status) } as Response);
    }
    if (url === '/api/model-presets/undo' && init?.method === 'POST') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ restored: ['workhorses.mid'], leftAsIs: [{ path: 'roles.work.model', reason: 'changed since apply; left as is' }] }),
      } as Response);
    }
    if (url.endsWith('/plan')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(plan) } as Response);
    }
    if (url.endsWith('/apply') && init?.method === 'POST') {
      const status = opts.applyStatus ?? 200;
      const body = status === 200 ? { applied: [], skipped: [] } : { error: 'config.yaml changed since this preview', code: 'stale-plan' };
      return Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(body) } as Response);
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) } as Response);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function renderBar(onPresetChanged = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ModelPresetsBar onPresetChanged={onPresetChanged} />
    </QueryClientProvider>,
  );
  return { onPresetChanged };
}

describe('ModelPresetsBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders one button per preset', async () => {
    installFetchMock();
    renderBar();
    expect(await screen.findByRole('button', { name: 'Apply Anthropic defaults' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply Anthropic cost-saver (pilot)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply OpenAI defaults' })).toBeTruthy();
  });

  it('opens the diff dialog with change rows and not-set rows', async () => {
    installFetchMock();
    renderBar();
    await userEvent.click(await screen.findByRole('button', { name: 'Apply Anthropic defaults' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Anthropic defaults v1')).toBeTruthy();
    expect(within(dialog).getByText('Changes (2)')).toBeTruthy();
    expect(within(dialog).getByText('Workhorse: mid')).toBeTruthy();
    expect(within(dialog).getByText('claude-opus-5-5')).toBeTruthy();
    expect(within(dialog).getByText('Not set (1)')).toBeTruthy();
    expect(within(dialog).getByText(/Third-party judgment service\./)).toBeTruthy();
    expect(within(dialog).getByText('tiered execution has no tiers; nothing to set')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /Apply 2 changes/ })).toBeTruthy();
  });

  it('confirm POSTs the plan digest and reports success', async () => {
    const fetchMock = installFetchMock();
    const { onPresetChanged } = renderBar();
    await userEvent.click(await screen.findByRole('button', { name: 'Apply Anthropic defaults' }));
    await userEvent.click(await screen.findByRole('button', { name: /Apply 2 changes/ }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith('Applied Anthropic defaults', expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) })));
    const applyCall = fetchMock.mock.calls.find(([url]) => url.toString() === '/api/model-presets/anthropic/apply');
    expect(applyCall).toBeTruthy();
    expect(JSON.parse(String(applyCall![1]!.body))).toEqual({ expectedDigest: 'digest-123' });
    expect((applyCall![1]!.headers as Record<string, string>)['x-overdeck-csrf-token']).toBe('test');
    expect(onPresetChanged).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the server error in the dialog when the apply is refused', async () => {
    installFetchMock({ applyStatus: 409 });
    const { onPresetChanged } = renderBar();
    await userEvent.click(await screen.findByRole('button', { name: 'Apply Anthropic defaults' }));
    await userEvent.click(await screen.findByRole('button', { name: /Apply 2 changes/ }));

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'config.yaml changed since this preview');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(onPresetChanged).not.toHaveBeenCalled();
  });

  it('a blocked plan disables confirm and shows the reason', async () => {
    const blocked = {
      ...planPayload,
      blocked: { reason: 'Anthropic has no credentials. Sign in (claude) or set an API key in Settings → Providers.' },
      rows: planPayload.rows.map((row) => (row.status === 'change' ? { ...row, status: 'skipped', reason: 'blocked' } : row)),
    };
    installFetchMock({ plan: blocked });
    renderBar();
    await userEvent.click(await screen.findByRole('button', { name: 'Apply Anthropic defaults' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Anthropic has no credentials/)).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: /Apply 0 changes/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('the toast Undo action POSTs /api/model-presets/undo and reports what it restored', async () => {
    const fetchMock = installFetchMock();
    const { onPresetChanged } = renderBar();
    await userEvent.click(await screen.findByRole('button', { name: 'Apply Anthropic defaults' }));
    await userEvent.click(await screen.findByRole('button', { name: /Apply 2 changes/ }));
    await waitFor(() => expect(toast).toHaveBeenCalled());

    const options = vi.mocked(toast).mock.calls[0]![1] as { action: { onClick: () => void } };
    onPresetChanged.mockClear();
    options.action.onClick();

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Restored 1 settings; 1 changed since apply were left as is'));
    const undoCall = fetchMock.mock.calls.find(([url]) => url.toString() === '/api/model-presets/undo');
    expect(undoCall?.[1]?.method).toBe('POST');
    expect(onPresetChanged).toHaveBeenCalled();
  });

  it('shows Undo last preset only when an undo record exists', async () => {
    installFetchMock({ status: { ...statusPayload, undoAvailable: true } });
    renderBar();
    await userEvent.click(await screen.findByRole('button', { name: 'Undo last preset' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Restored 1 settings; 1 changed since apply were left as is'));
  });

  it('renders no updated notice and no undo button when nothing was applied', async () => {
    installFetchMock();
    renderBar();
    await screen.findByRole('button', { name: 'Apply Anthropic defaults' });
    expect(screen.queryByText(/updated \(v/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo last preset' })).toBeNull();
  });

  it('the updated notice opens that preset\'s diff dialog', async () => {
    const status = {
      ...statusPayload,
      presets: statusPayload.presets.map((preset) => (preset.id === 'anthropic'
        ? { ...preset, updateAvailable: true, lastApplied: { presetId: 'anthropic', version: 0, appliedAt: '2026-09-01T00:00:00.000Z' } }
        : preset)),
    };
    installFetchMock({ status });
    renderBar();
    const notice = await screen.findByRole('status');
    expect(notice.textContent).toBe('Anthropic defaults updated (v1): review changes');
    await userEvent.click(within(notice).getByRole('button', { name: 'review changes' }));
    expect(within(await screen.findByRole('dialog')).getByText('Anthropic defaults v1')).toBeTruthy();
  });
});

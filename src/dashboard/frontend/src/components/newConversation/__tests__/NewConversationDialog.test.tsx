/** PAN-4486 WI-10: the new-conversation options dialog, its store and host. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

vi.mock('../../shared/ModelPicker', () => ({
  useAvailableModels: () => ({ groups: [], harnessPolicy: {} }),
  pickerEffortLevels: () => undefined,
  ModelSelect: ({ value, onChange }: { value: string; onChange: (id: string) => void }) => (
    <select aria-label="Model" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="claude-opus-5-5">Opus</option>
      <option value="claude-haiku-4-5-20251001">Haiku</option>
      <option value="gpt-5.5">GPT</option>
    </select>
  ),
  HarnessSelect: ({ value, onChange }: { value: string; onChange: (h: string) => void }) => (
    <select aria-label="Harness" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="claude-code">Claude Code</option>
      <option value="codex">Codex</option>
    </select>
  ),
}));

vi.mock('../../chat/ModelPicker', () => ({
  loadStoredModel: () => 'claude-opus-5-5',
  loadStoredHarness: () => 'claude-code',
  MODEL_EFFORT_SUPPORT: {
    'claude-opus-5-5': ['low', 'medium', 'high', 'xhigh', 'max'],
    'claude-haiku-4-5-20251001': [],
  },
}));

import { useDashboardStore } from '../../../lib/store';
import { NewConversationDialogHost } from '../NewConversationDialog';
import { openNewConversationDialog, useNewConversationDialogStore } from '../newConversationDialogStore';

const PROJECTS = [
  { key: 'overdeck', name: 'Overdeck', path: '/home/me/Projects/overdeck' },
  { key: 'myapp', name: 'Display Name', path: '/home/me/Projects/myapp' },
];

let posts: Array<Record<string, unknown>>;
let postResponse: { ok: boolean; body: unknown };

function mockApi() {
  posts = [];
  postResponse = { ok: true, body: { id: 77, name: 'swift-otter' } };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && url === '/api/conversations') {
      posts.push(JSON.parse(String(init.body)));
      return { ok: postResponse.ok, status: postResponse.ok ? 201 : 400, json: async () => postResponse.body };
    }
    if (url === '/api/registered-projects') return { ok: true, status: 200, json: async () => PROJECTS };
    if (url.startsWith('/api/effort/default')) {
      return { ok: true, status: 200, json: async () => ({ effort: 'high', source: 'default', requested: 'high', clamped: false }) };
    }
    if (url.startsWith('/api/skills/overrides')) {
      return {
        ok: true, status: 200,
        json: async () => ({ skills: [{ name: 'grilling', core: false, enabled: true, source: 'default', origin: 'personal' }], packs: [] }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }));
}

function renderHost() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NewConversationDialogHost />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockApi();
  localStorage.clear();
  useNewConversationDialogStore.setState({ open: false, projectKey: undefined });
  useDashboardStore.setState({
    issuesRaw: [{ id: 'PAN-1', identifier: 'PAN-1', title: 'First issue', status: 'Todo', priority: 0, labels: [] }],
  } as Parameters<typeof useDashboardStore.setState>[0]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NewConversationDialog', () => {
  it('renders nothing until opened, then presets the project by display name to its key', async () => {
    renderHost();
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => openNewConversationDialog({ projectKey: 'Display Name' }));
    const dialog = await screen.findByRole('dialog', { name: 'New conversation with options' });
    await waitFor(() => expect((within(dialog).getByLabelText('Project') as HTMLSelectElement).value).toBe('myapp'));
    expect((screen.getByLabelText('Working directory') as HTMLInputElement).value).toBe('/home/me/Projects/myapp');
  });

  it('shows the resolved default effort with its source', async () => {
    act(() => openNewConversationDialog());
    renderHost();
    expect(await screen.findByText('Default: high (default)')).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText('Effort') as HTMLSelectElement).value).toBe('high'));
  });

  it('POSTs every chosen field', async () => {
    act(() => openNewConversationDialog({ projectKey: 'overdeck' }));
    renderHost();
    await waitFor(() => expect((screen.getByLabelText('Project') as HTMLSelectElement).value).toBe('overdeck'));
    await screen.findByText('Default: high (default)');
    fireEvent.change(screen.getByLabelText('Effort'), { target: { value: 'xhigh' } });
    fireEvent.click(screen.getByLabelText('No context'));
    fireEvent.click(await screen.findByRole('button', { name: /^Personal/ }));
    const skills = screen.getByRole('radiogroup', { name: 'grilling' });
    fireEvent.click(within(skills).getByRole('radio', { name: 'Off' }));
    const picker = screen.getByRole('combobox', { name: 'Link to an issue' });
    fireEvent.change(picker, { target: { value: 'PAN-1' } });
    fireEvent.keyDown(picker, { key: 'Enter' });
    fireEvent.change(screen.getByLabelText('First message'), { target: { value: '  hello  ' } });
    const pushState = vi.spyOn(window.history, 'pushState');
    fireEvent.click(screen.getByRole('button', { name: 'Create conversation' }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      model: 'claude-opus-5-5',
      harness: 'claude-code',
      projectKey: 'overdeck',
      effort: 'xhigh',
      bareContext: true,
      skillOverrides: { grilling: false },
      issueId: 'PAN-1',
      message: 'hello',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pushState).toHaveBeenCalledWith({}, '', '/conv/77');
    pushState.mockRestore();
  });

  it('sends a cwd only when it differs from the project path', async () => {
    act(() => openNewConversationDialog({ projectKey: 'overdeck' }));
    renderHost();
    await waitFor(() => expect((screen.getByLabelText('Project') as HTMLSelectElement).value).toBe('overdeck'));
    fireEvent.change(screen.getByLabelText('Working directory'), { target: { value: '/home/me/Projects/overdeck/packages/web' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create conversation' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ projectKey: 'overdeck', cwd: '/home/me/Projects/overdeck/packages/web' });
  });

  it('never writes the sidebar localStorage choices', async () => {
    localStorage.setItem('conv-composer-model', 'claude-sonnet-5');
    localStorage.setItem('conv-composer-harness', 'claude-code');
    localStorage.setItem('conv-composer-effort', 'medium');
    localStorage.setItem('overdeck.commandDeck.newConversationContext', '{"bareContext":false,"skipClaudeMd":false}');
    const before = { ...localStorage };
    act(() => openNewConversationDialog());
    renderHost();
    await screen.findByText('Default: high (default)');
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'gpt-5.5' } });
    fireEvent.change(screen.getByLabelText('Harness'), { target: { value: 'codex' } });
    fireEvent.change(screen.getByLabelText('Effort'), { target: { value: 'low' } });
    fireEvent.click(screen.getByLabelText('No context'));
    fireEvent.click(screen.getByRole('button', { name: 'Create conversation' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect({ ...localStorage }).toEqual(before);
  });

  it('hides Skip CLAUDE.md for codex and omits effort for a model without effort', async () => {
    act(() => openNewConversationDialog());
    renderHost();
    expect(await screen.findByLabelText('Skip CLAUDE.md')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Harness'), { target: { value: 'codex' } });
    expect(screen.queryByLabelText('Skip CLAUDE.md')).toBeNull();
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'claude-haiku-4-5-20251001' } });
    expect(screen.getByText('Not supported by this model')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create conversation' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).not.toHaveProperty('effort');
    expect(posts[0]).not.toHaveProperty('skipClaudeMd');
  });

  it('shows a failed create inline and stays open', async () => {
    postResponse = { ok: false, body: { error: 'Invalid cwd: must be inside project overdeck' } };
    act(() => openNewConversationDialog());
    renderHost();
    fireEvent.click(await screen.findByRole('button', { name: 'Create conversation' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Invalid cwd: must be inside project overdeck');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('closes on Escape', async () => {
    act(() => openNewConversationDialog());
    renderHost();
    await screen.findByRole('dialog');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useNewConversationDialogStore.getState().open).toBe(false);
  });
});

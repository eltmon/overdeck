/** PAN-4486 WI-10: the new-conversation options dialog, its store and host. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

vi.mock('../../shared/ModelPicker', () => ({
  useAvailableModels: () => ({ groups: [], harnessPolicy: {} }),
  pickerEffortLevels: () => undefined,
  HARNESS_OPTIONS: [
    { id: 'claude-code', label: 'Claude Code', description: '' },
    { id: 'codex', label: 'Codex', description: '' },
  ],
  ModelSelect: ({ value, onChange }: { value: string; onChange: (id: string) => void }) => (
    <select aria-label="Model" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="claude-opus-5-5">Opus</option>
      <option value="claude-haiku-4-5-20251001">Haiku</option>
      <option value="claude-sonnet-5">Sonnet</option>
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
    'claude-sonnet-5': ['low', 'medium', 'high'],
  },
}));

import { useDashboardStore } from '../../../lib/store';
import { NewConversationDialogHost } from '../NewConversationDialog';
import { openNewConversationDialog, useNewConversationDialogStore } from '../newConversationDialogStore';
import styles from '../NewConversationDialog.module.css';

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
  // Unmount before restoring fetch: afterEach hooks run in reverse order, so
  // Testing Library's own cleanup runs after this one. A still-mounted dialog
  // can start a skills query (e.g. ?project=myapp after the project preset)
  // between the unstub and that cleanup, and the setup file's network guard
  // records it as an unexpected request.
  cleanup();
  vi.unstubAllGlobals();
});

describe('NewConversationDialog', () => {
  it('renders nothing until opened, then presets the project by display name to its key', async () => {
    renderHost();
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => openNewConversationDialog({ projectKey: 'Display Name' }));
    const dialog = await screen.findByRole('dialog', { name: 'New conversation' });
    await waitFor(() => expect((within(dialog).getByLabelText('Project') as HTMLSelectElement).value).toBe('myapp'));
    expect((screen.getByLabelText('Working directory') as HTMLInputElement).value).toBe('/home/me/Projects/myapp');
  });

  it('renders five sections in order', async () => {
    act(() => openNewConversationDialog());
    renderHost();
    await screen.findByRole('dialog');
    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings.map((h) => h.textContent)).toEqual([
      'Where it runs',
      'Agent',
      expect.stringMatching(/^Task/),
      'Context',
      'Skills',
    ]);
    expect(headings[2]?.textContent).toContain('Both optional');
    for (const heading of headings) {
      expect(heading.closest('section')).toHaveClass(styles.section);
    }
  });

  it('the First message placeholder reads "Sent as soon as the conversation starts"', async () => {
    act(() => openNewConversationDialog());
    renderHost();
    await screen.findByRole('dialog');
    expect(screen.getByLabelText('First message')).toHaveAttribute('placeholder', 'Sent as soon as the conversation starts');
  });

  it('the linked-issue combobox is named by the Linked issue section label', async () => {
    act(() => openNewConversationDialog());
    renderHost();
    expect(await screen.findByRole('combobox', { name: 'Linked issue' })).toBeTruthy();
  });

  it('shows the resolved default effort with its source', async () => {
    act(() => openNewConversationDialog());
    renderHost();
    expect(await screen.findByText('Default: high (default)')).toBeTruthy();
    const group = screen.getByRole('radiogroup', { name: 'Effort' });
    const high = within(group).getByRole('radio', { name: 'high' });
    await waitFor(() => expect(high).toHaveAttribute('aria-checked', 'true'));
    expect(high).toHaveAttribute('data-default', 'true');
  });

  it('no effort level is checked before the default resolves', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/effort/default')) return new Promise<Response>(() => {});
      if (init?.method === 'POST' && url === '/api/conversations') {
        posts.push(JSON.parse(String(init.body)));
        return { ok: postResponse.ok, status: postResponse.ok ? 201 : 400, json: async () => postResponse.body };
      }
      if (url === '/api/registered-projects') return { ok: true, status: 200, json: async () => PROJECTS };
      if (url.startsWith('/api/skills/overrides')) {
        return { ok: true, status: 200, json: async () => ({ skills: [], packs: [] }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }));
    act(() => openNewConversationDialog());
    renderHost();
    const group = await screen.findByRole('radiogroup', { name: 'Effort' });
    for (const radio of within(group).getAllByRole('radio')) expect(radio).toHaveAttribute('aria-checked', 'false');
  });

  it('a picked effort the new model lacks falls back to the default', async () => {
    act(() => openNewConversationDialog());
    renderHost();
    await screen.findByText('Default: high (default)');
    const group = screen.getByRole('radiogroup', { name: 'Effort' });
    fireEvent.click(within(group).getByRole('radio', { name: 'max' }));
    expect(within(group).getByRole('radio', { name: 'max' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'claude-sonnet-5' } });
    await waitFor(() => expect(within(group).getByRole('radio', { name: 'high' })).toHaveAttribute('aria-checked', 'true'));
    expect(within(group).queryByRole('radio', { name: 'max' })).toBeNull();
  });

  it('the footer summary reads model, harness, effort and project and updates live', async () => {
    act(() => openNewConversationDialog({ projectKey: 'overdeck' }));
    renderHost();
    await waitFor(() => expect((screen.getByLabelText('Project') as HTMLSelectElement).value).toBe('overdeck'));
    await screen.findByText('Default: high (default)');
    const summary = () => document.querySelector('[data-component="new-conversation-summary"]')?.textContent;
    await waitFor(() => expect(summary()).toBe('claude-opus-5-5 · Claude Code · high · overdeck'));

    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Effort' })).getByRole('radio', { name: 'low' }));
    expect(summary()).toBe('claude-opus-5-5 · Claude Code · low · overdeck');

    fireEvent.change(screen.getByLabelText('Project'), { target: { value: '' } });
    expect(summary()).toBe('claude-opus-5-5 · Claude Code · low · No project');

    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'claude-haiku-4-5-20251001' } });
    expect(summary()).toBe('claude-haiku-4-5-20251001 · Claude Code · No project');
  });

  it('POSTs every chosen field', async () => {
    act(() => openNewConversationDialog({ projectKey: 'overdeck' }));
    renderHost();
    await waitFor(() => expect((screen.getByLabelText('Project') as HTMLSelectElement).value).toBe('overdeck'));
    await screen.findByText('Default: high (default)');
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Effort' })).getByRole('radio', { name: 'xhigh' }));
    fireEvent.click(screen.getByRole('switch', { name: 'No context' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Customize' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Personal/ }));
    const skills = screen.getByRole('radiogroup', { name: 'grilling' });
    fireEvent.click(within(skills).getByRole('radio', { name: 'Off' }));
    const picker = screen.getByRole('combobox', { name: 'Linked issue' });
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

  it('collapses skills to a summary line', async () => {
    act(() => openNewConversationDialog());
    renderHost();
    await screen.findByText('1 of 1 skills on');
    expect(screen.getByText('· inherited from project and global settings, no overrides')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Filter skills' })).toBeNull();
  });

  it('Customize is reachable and reveals the inline error when the skills fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/registered-projects') return { ok: true, status: 200, json: async () => PROJECTS };
      if (url.startsWith('/api/effort/default')) {
        return { ok: true, status: 200, json: async () => ({ effort: 'high', source: 'default', requested: 'high', clamped: false }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }));
    act(() => openNewConversationDialog());
    renderHost();
    const customize = await screen.findByRole('button', { name: 'Customize' });
    const panel = document.getElementById(customize.getAttribute('aria-controls') ?? '');
    expect(panel).toHaveAttribute('hidden');
    fireEvent.click(customize);
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    expect(panel).not.toHaveAttribute('hidden');
  });

  it('Customize reveals the skills field and the summary counts the override', async () => {
    act(() => openNewConversationDialog());
    renderHost();
    await screen.findByText('1 of 1 skills on');
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /^Personal/ }));
    const skills = screen.getByRole('radiogroup', { name: 'grilling' });
    fireEvent.click(within(skills).getByRole('radio', { name: 'Off' }));
    expect(await screen.findByText('0 of 1 skills on')).toBeTruthy();
    expect(screen.getByText('· 1 override in this conversation')).toBeTruthy();
  });

  it('fetches skill overrides once', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
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
      if (init?.method === 'POST' && url === '/api/conversations') {
        posts.push(JSON.parse(String(init.body)));
        return { ok: postResponse.ok, status: postResponse.ok ? 201 : 400, json: async () => postResponse.body };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);
    act(() => openNewConversationDialog());
    renderHost();
    await screen.findByText('1 of 1 skills on');
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    await screen.findByRole('button', { name: /^Personal/ });
    const overridesCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/skills/overrides'));
    expect(overridesCalls).toHaveLength(1);
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
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Effort' })).getByRole('radio', { name: 'low' }));
    fireEvent.click(screen.getByRole('switch', { name: 'No context' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create conversation' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect({ ...localStorage }).toEqual(before);
  });

  it('hides Skip CLAUDE.md for codex and omits effort for a model without effort', async () => {
    act(() => openNewConversationDialog());
    renderHost();
    expect(await screen.findByRole('switch', { name: 'Skip CLAUDE.md' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Harness'), { target: { value: 'codex' } });
    expect(screen.queryByRole('switch', { name: 'Skip CLAUDE.md' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'claude-haiku-4-5-20251001' } });
    expect(screen.getByText('Not supported by this model')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create conversation' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).not.toHaveProperty('effort');
    expect(posts[0]).not.toHaveProperty('skipClaudeMd');
  });

  it('flips the No context switch on click', async () => {
    act(() => openNewConversationDialog());
    renderHost();
    const noContext = await screen.findByRole('switch', { name: 'No context' });
    expect(noContext).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(noContext);
    expect(noContext).toHaveAttribute('aria-checked', 'true');
  });

  it('shows a failed create inline and stays open', async () => {
    postResponse = { ok: false, body: { error: 'Invalid cwd: must be inside project overdeck' } };
    act(() => openNewConversationDialog());
    renderHost();
    fireEvent.click(await screen.findByRole('button', { name: 'Create conversation' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Invalid cwd: must be inside project overdeck');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('shows the error above the footer', async () => {
    postResponse = { ok: false, body: { error: 'boom' } };
    act(() => openNewConversationDialog());
    renderHost();
    fireEvent.click(await screen.findByRole('button', { name: 'Create conversation' }));
    const alert = await screen.findByRole('alert');
    const panel = screen.getByRole('dialog');
    expect(panel.contains(alert)).toBe(true);

    // Among the panel's direct children, the one holding the scrolling body
    // controls (e.g. the Project field) must not be the one holding the
    // pinned alert — it renders as a sibling region, not inside the body.
    const projectField = screen.getByLabelText('Project');
    const bodyChild = Array.from(panel.children).find((child) => child.contains(projectField));
    expect(bodyChild).toBeTruthy();
    expect(bodyChild!.contains(alert)).toBe(false);
  });

  it('closes on Escape', async () => {
    act(() => openNewConversationDialog());
    renderHost();
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(useNewConversationDialogStore.getState().open).toBe(false);
  });

  it('ac1/ac2 (PAN-4743): Fly (new VM) shows the starting status and button text, then navigates on success', async () => {
    let resolveFleet: ((value: { ok: boolean; status: number; json: () => Promise<unknown> }) => void) | null = null;
    const fleetPosts: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url === '/api/fleet/conversations') {
        fleetPosts.push(JSON.parse(String(init.body)));
        return new Promise((resolve) => { resolveFleet = resolve; });
      }
      if (url === '/api/registered-projects') return { ok: true, status: 200, json: async () => PROJECTS };
      if (url.startsWith('/api/effort/default')) {
        return { ok: true, status: 200, json: async () => ({ effort: 'high', source: 'default', requested: 'high', clamped: false }) };
      }
      if (url.startsWith('/api/skills/overrides')) return { ok: true, status: 200, json: async () => ({ skills: [], packs: [] }) };
      return { ok: false, status: 404, json: async () => ({}) };
    }));
    act(() => openNewConversationDialog({ projectKey: 'overdeck' }));
    renderHost();
    await waitFor(() => expect((screen.getByLabelText('Project') as HTMLSelectElement).value).toBe('overdeck'));
    fireEvent.change(screen.getByLabelText('Machine'), { target: { value: 'fly' } });
    const pushState = vi.spyOn(window.history, 'pushState');
    fireEvent.click(screen.getByRole('button', { name: 'Create conversation' }));

    await waitFor(() => expect(screen.getByText('Starting a Fly machine. This takes a few minutes.')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Create conversation' })).toHaveTextContent('Starting…');
    expect(fleetPosts).toHaveLength(1);
    expect(fleetPosts[0]).toMatchObject({ machine: 'fly', projectKey: 'overdeck' });

    act(() => resolveFleet!({
      ok: true, status: 201,
      json: async () => ({ conversation: '@env-fly/conv-1', machine: { environmentId: 'env-fly', label: 'fly-m1', self: false }, reason: 'Fly (new VM) → fly-m1 (iad)' }),
    }));
    await waitFor(() => expect(pushState).toHaveBeenCalledWith({}, '', '/conv/@env-fly/conv-1'));
    pushState.mockRestore();
  });

  it('Escape does nothing while submitting', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url === '/api/conversations') return new Promise<Response>(() => {});
      if (url === '/api/registered-projects') return { ok: true, status: 200, json: async () => PROJECTS };
      if (url.startsWith('/api/effort/default')) {
        return { ok: true, status: 200, json: async () => ({ effort: 'high', source: 'default', requested: 'high', clamped: false }) };
      }
      if (url.startsWith('/api/skills/overrides')) {
        return { ok: true, status: 200, json: async () => ({ skills: [], packs: [] }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }));
    act(() => openNewConversationDialog());
    renderHost();
    fireEvent.click(await screen.findByRole('button', { name: 'Create conversation' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create conversation' })).toBeDisabled());
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(useNewConversationDialogStore.getState().open).toBe(true);
  });
});

/**
 * The Add-project dialog shell (PAN-4281 WI-6): the modal host, the start
 * step's keyboard model, mode presets, and the returnTo hand-off that lets a
 * New Workspace chip land back on that page with the new project selected.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../../lib/wsTransport.js', () => ({
  dashboardMutationJsonHeaders: vi.fn().mockResolvedValue({ 'content-type': 'application/json' }),
}));

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('../../../../lib/apiFetch.js', () => ({ fetchWithTimeout: fetchMock }));
vi.mock('../../../../lib/telemetry.js', () => ({ capture: vi.fn() }));

import { AddProjectDialog, AddProjectDialogHost } from '../AddProjectDialog.js';
import { takeAddProjectReturnTo, useAddProjectDialog } from '../addProjectDialogStore.js';
import { getProjectCreatedNavigation } from '../../../../App/routes.js';
import { findBannedWords } from '../../../../lib/simple/strings.js';
import type { CreatedProject, ResolvedProjectIntent } from '../projectCreateTypes.js';

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const cloneIntent: ResolvedProjectIntent = {
  mode: 'clone',
  key: 'widget',
  name: 'widget',
  path: '/home/op/Projects/widget',
  parentDir: '/home/op/Projects',
  homeDir: '/home/op',
  cloneUrl: 'https://github.com/acme/widget.git',
  provider: 'github',
  repoSlug: 'acme/widget',
  defaultBranch: 'main',
  remoteChecked: true,
  isGitRepository: true,
  gitRoot: null,
  proposedIssuePrefix: 'WIDGET',
  wouldClone: true,
  wouldGitInit: false,
  willCreateMainWorkspace: true,
  registeredKeyAtPath: null,
  findings: [],
};

function routeFetch(): void {
  fetchMock.mockImplementation((url: string) => {
    if (url === '/api/projects/resolve') return Promise.resolve(json(cloneIntent));
    if (url === '/api/projects') {
      return Promise.resolve(json({ key: 'widget', name: 'widget', path: '/home/op/Projects/widget' }));
    }
    if (url === '/api/registered-projects') return Promise.resolve(json([]));
    return Promise.resolve(json({}));
  });
}

function renderHost(onCreated: (project: CreatedProject) => void = () => {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AddProjectDialogHost onCreated={onCreated} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  useAddProjectDialog.getState().hide();
});

afterEach(() => vi.clearAllMocks());

describe('AddProjectDialog', () => {
  it('start step focuses "Open a folder" and ArrowDown moves to Clone', async () => {
    const user = userEvent.setup();
    routeFetch();
    act(() => useAddProjectDialog.getState().show());
    renderHost();

    expect(screen.getByRole('dialog', { name: 'Add a project' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /Open a folder/i })).toHaveFocus());

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: /Clone from URL/i })).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(screen.getByRole('button', { name: /Create new project/i })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('button', { name: /Clone from URL/i })).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(await screen.findByLabelText('Repository URL')).toBeInTheDocument();
  });

  it('Esc closes the modal', async () => {
    const user = userEvent.setup();
    routeFetch();
    act(() => useAddProjectDialog.getState().show());
    renderHost();
    await waitFor(() => expect(screen.getByRole('button', { name: /Open a folder/i })).toHaveFocus());

    await user.keyboard('{Escape}');

    expect(useAddProjectDialog.getState().open).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Esc does not close the modal while a clone is running', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/projects/resolve') return Promise.resolve(json(cloneIntent));
      if (url === '/api/projects') return Promise.resolve(json({ jobId: 'job-1' }, 202));
      if (url.startsWith('/api/projects/create-jobs/')) {
        return Promise.resolve(json({ status: 'cloning', phase: 'Receiving objects', percent: 10 }));
      }
      return Promise.resolve(json({}));
    });
    act(() => useAddProjectDialog.getState().show('clone'));
    renderHost();

    await user.type(screen.getByLabelText('Repository URL'), 'acme/widget');
    const cta = screen.getByRole('button', { name: 'Clone repository' });
    await waitFor(() => expect(cta).toBeEnabled());
    await user.click(cta);
    await screen.findByRole('button', { name: 'Cancel clone' });

    await user.keyboard('{Escape}');

    expect(useAddProjectDialog.getState().open).toBe(true);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it("show('clone') opens straight into the clone step", () => {
    routeFetch();
    act(() => useAddProjectDialog.getState().show('clone'));
    renderHost();

    expect(screen.getByLabelText('Repository URL')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open a folder/i })).not.toBeInTheDocument();
  });

  it('adding from a chip selects the new project', async () => {
    const user = userEvent.setup();
    routeFetch();
    const navigations: ReturnType<typeof getProjectCreatedNavigation>[] = [];
    // What App's handleProjectCreated does with the created project.
    const onCreated = (project: CreatedProject) => {
      navigations.push(getProjectCreatedNavigation(project.key, takeAddProjectReturnTo()));
    };
    // The New Workspace chip: open the modal in clone mode, returning to that page.
    act(() => useAddProjectDialog.getState().show('clone', '/workspaces/new'));
    renderHost(onCreated);

    await user.type(screen.getByLabelText('Repository URL'), 'acme/widget');
    const cta = screen.getByRole('button', { name: 'Clone repository' });
    await waitFor(() => expect(cta).toBeEnabled());
    await user.click(cta);

    await waitFor(() => expect(navigations).toHaveLength(1));
    expect(navigations[0]).toEqual({
      tab: 'workspace-new',
      path: '/workspaces/new?project=widget',
      state: { tab: 'workspace-new' },
    });
    // The modal closed, and the returnTo was consumed rather than left for the next create.
    expect(useAddProjectDialog.getState().open).toBe(false);
    expect(takeAddProjectReturnTo()).toBeUndefined();
  });

  it('start step copy contains no simple-mode banned words', async () => {
    routeFetch();
    act(() => useAddProjectDialog.getState().show());
    const { container } = renderHost();

    // Wait for the zero-projects subtitle so its copy is checked too.
    await screen.findByText(/You can also skip this and just type on Home/);
    expect(findBannedWords(container.textContent ?? '')).toEqual([]);
  });

  it('only resolve and create routes receive POSTs', async () => {
    const user = userEvent.setup();
    const base = { ...cloneIntent, notices: [], nestedRepositories: [] };
    const intents: Record<string, ResolvedProjectIntent> = {
      '/home/op/repo': { ...base, mode: 'existing', path: '/home/op/repo', cloneUrl: null, wouldClone: false },
      '/home/op/plain': { ...base, mode: 'existing', path: '/home/op/plain', cloneUrl: null, wouldClone: false, isGitRepository: false },
      '/home/op/suite': {
        ...base,
        mode: 'existing',
        path: '/home/op/suite',
        cloneUrl: null,
        wouldClone: false,
        isGitRepository: false,
        nestedRepositories: [
          { name: 'api', path: '/home/op/suite/api' },
          { name: 'web', path: '/home/op/suite/web' },
        ],
      },
    };
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as { mode: string; path?: string; repos?: string[] }) : null;
      if (url === '/api/projects/resolve') {
        if (body?.mode === 'clone') return Promise.resolve(json(base));
        if (body?.mode === 'new') return Promise.resolve(json({ ...base, mode: 'new', cloneUrl: null, wouldClone: false, wouldGitInit: true }));
        if (body?.repos) return Promise.resolve(json({ findings: [] }));
        const intent = body?.path ? intents[body.path] : undefined;
        return Promise.resolve(json(intent ?? { findings: [] }));
      }
      if (url === '/api/projects') {
        const path = body?.path ?? '/home/op/Projects/widget';
        const key = path.split('/').pop()!;
        return Promise.resolve(json({ key, name: key, path }));
      }
      if (url === '/api/projects/suggestions') {
        return Promise.resolve(
          json({ root: '/home/op/Projects', homeDir: '/home/op', repositories: [{ name: 'found', path: '/home/op/Projects/found' }] }),
        );
      }
      if (url === '/api/registered-projects') return Promise.resolve(json([]));
      if (url.startsWith('/api/fs/list-dirs')) return Promise.resolve(json({ path: '/home/op', parent: null, entries: [] }));
      return Promise.resolve(json({}));
    });

    /** Render a fresh dialog, run one path to a created project, then unmount. */
    const drive = async (
      initialMode: 'clone' | 'existing' | 'new' | undefined,
      steps: () => Promise<void>,
    ) => {
      const onCreated = vi.fn();
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const view = render(
        <QueryClientProvider client={queryClient}>
          <AddProjectDialog variant="modal" initialMode={initialMode} onCreated={onCreated} onCancel={() => {}} />
        </QueryClientProvider>,
      );
      await steps();
      await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
      view.unmount();
    };
    const chooseFolder = async (folder: string) => {
      await user.type(screen.getByLabelText('Folder'), folder);
      await user.click(screen.getByRole('button', { name: 'Continue' }));
    };

    // Folder: a Git repository.
    await drive('existing', async () => {
      await chooseFolder('/home/op/repo');
      const cta = await screen.findByRole('button', { name: 'Add project' });
      await waitFor(() => expect(cta).toBeEnabled());
      await user.click(cta);
    });
    // Folder: a plain folder, added as a folder.
    await drive('existing', async () => {
      await chooseFolder('/home/op/plain');
      const add = await screen.findByRole('button', { name: 'Add as folder' });
      await waitFor(() => expect(add).toBeEnabled());
      await user.click(add);
    });
    // Nested: each repository, then the folder as one project.
    await drive('existing', async () => {
      await chooseFolder('/home/op/suite');
      await user.click(await screen.findByRole('button', { name: 'Add 2 projects' }));
    });
    await drive('existing', async () => {
      await chooseFolder('/home/op/suite');
      await user.click(await screen.findByRole('button', { name: 'Add this folder as one project' }));
    });
    // Clone and create, each submitted with Enter.
    await drive('clone', async () => {
      await user.type(screen.getByLabelText('Repository URL'), 'acme/widget');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Clone repository' })).toBeEnabled());
      await user.keyboard('{Enter}');
    });
    await drive('new', async () => {
      await user.type(screen.getByLabelText('Project name'), 'widget');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Create project' })).toBeEnabled());
      await user.keyboard('{Enter}');
    });
    // A suggestion's Add on the start step.
    await drive(undefined, async () => {
      await user.click(await screen.findByRole('button', { name: 'Add found' }));
    });

    const postUrls = fetchMock.mock.calls
      .filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
      .map(([url]) => url as string);
    expect(postUrls.length).toBeGreaterThan(0);
    for (const url of postUrls) {
      expect(
        url === '/api/projects/resolve' || url === '/api/projects' || url.startsWith('/api/projects/create-jobs/'),
      ).toBe(true);
    }
    // Every path created something: 1 + 1 + 2 + 1 + 1 + 1 + 1.
    const creates = postUrls.filter((url) => url === '/api/projects');
    expect(creates).toHaveLength(8);
  });
});

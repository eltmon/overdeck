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

import { AddProjectDialogHost } from '../AddProjectDialog.js';
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
});

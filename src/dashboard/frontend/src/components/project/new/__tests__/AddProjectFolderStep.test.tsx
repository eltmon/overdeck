/**
 * The Add-project folder step (PAN-4281 WI-9, FR-8): after a folder is chosen,
 * a repository-root snap is announced, and a plain folder is explained before
 * it is added.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../../lib/wsTransport.js', () => ({
  dashboardMutationJsonHeaders: vi.fn().mockResolvedValue({ 'content-type': 'application/json' }),
}));

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('../../../../lib/apiFetch.js', () => ({ fetchWithTimeout: fetchMock }));
vi.mock('../../../../lib/telemetry.js', () => ({ capture: vi.fn() }));

import { AddProjectDialog } from '../AddProjectDialog.js';
import { findBannedWords } from '../../../../lib/simple/strings.js';
import type { ResolvedProjectIntent } from '../projectCreateTypes.js';

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function existingIntent(overrides: Partial<ResolvedProjectIntent> = {}): ResolvedProjectIntent {
  return {
    mode: 'existing',
    key: 'notes',
    name: 'notes',
    path: '/home/op/Projects/notes',
    parentDir: '/home/op/Projects',
    homeDir: '/home/op',
    cloneUrl: null,
    provider: null,
    repoSlug: null,
    defaultBranch: null,
    remoteChecked: false,
    isGitRepository: false,
    gitRoot: null,
    proposedIssuePrefix: 'NOTES',
    wouldClone: false,
    wouldGitInit: false,
    willCreateMainWorkspace: true,
    registeredKeyAtPath: null,
    findings: [],
    notices: [],
    nestedRepositories: [],
    ...overrides,
  };
}

/** The picker lists /home/op/Projects; resolve answers `intent` for any chosen path. */
function routeFetch(intent: ResolvedProjectIntent): void {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url === '/api/projects/resolve') {
      const body = JSON.parse(String(init?.body)) as { path?: string };
      // An untouched form has no path yet: answer the way the server does.
      if (!body.path) {
        return Promise.resolve(json(existingIntent({
          path: null,
          findings: [{ field: 'path', code: 'path-not-a-directory', message: 'Choose an existing directory.' }],
        })));
      }
      return Promise.resolve(json(intent));
    }
    if (url.startsWith('/api/fs/list-dirs')) {
      const requested = new URLSearchParams(url.split('?')[1] ?? '').get('path') ?? '/home/op/Projects';
      return Promise.resolve(json({ path: requested, parent: '/home/op', entries: [] }));
    }
    if (url === '/api/projects/suggestions') {
      return Promise.resolve(json({ root: '/home/op/Projects', homeDir: '/home/op', repositories: [] }));
    }
    if (url === '/api/projects') {
      return Promise.resolve(json({ key: 'notes', name: 'notes', path: '/home/op/Projects/notes' }));
    }
    return Promise.resolve(json({}));
  });
}

function renderFolderStep(onCreated = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AddProjectDialog variant="modal" initialMode="existing" onCreated={onCreated} onCancel={() => {}} />
    </QueryClientProvider>,
  );
  return { ...view, onCreated };
}

const creates = () => fetchMock.mock.calls.filter(([url]) => url === '/api/projects');

beforeEach(() => {
  fetchMock.mockReset();
  sessionStorage.clear();
});

afterEach(() => vi.clearAllMocks());

describe('Add-project folder step', () => {
  it('non-git explanation renders with Add as folder and Back', async () => {
    const user = userEvent.setup();
    routeFetch(existingIntent());
    const { onCreated } = renderFolderStep();

    await user.type(screen.getByLabelText('Folder'), '/home/op/Projects/notes');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText(/This folder isn.t a Git repository/)).toBeInTheDocument();
    expect(screen.getByText('~/Projects/notes')).toBeInTheDocument();
    const addAsFolder = screen.getByRole('button', { name: 'Add as folder' });
    await waitFor(() => expect(addAsFolder).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();

    await user.click(addAsFolder);
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(creates()).toHaveLength(1);
  });

  it('Back returns to the picker at the chosen folder', async () => {
    const user = userEvent.setup();
    routeFetch(existingIntent());
    renderFolderStep();

    await user.type(screen.getByLabelText('Folder'), '/home/op/Projects/notes');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('button', { name: 'Back' }));

    expect(await screen.findByTestId('folder-picker-path')).toHaveTextContent('/home/op/Projects/notes');
    expect(creates()).toHaveLength(0);
  });

  it('snap notice renders the repository root', async () => {
    const user = userEvent.setup();
    routeFetch(
      existingIntent({
        key: 'app',
        name: 'app',
        path: '/home/op/code/app',
        isGitRepository: true,
        gitRoot: '/home/op/code/app',
        notices: [
          {
            code: 'using-repository-root',
            message: 'Using the repository root /home/op/code/app.',
            detail: '/home/op/code/app',
          },
        ],
      }),
    );
    renderFolderStep();

    await user.type(screen.getByLabelText('Folder'), '/home/op/code/app/src');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Using the repository root ~/code/app.');
    // A Git repository reviews in the form, ready to add.
    expect(screen.getByRole('button', { name: 'Add project' })).toBeInTheDocument();
  });

  it('a picker selection reaches resolve', async () => {
    const user = userEvent.setup();
    routeFetch(existingIntent({ isGitRepository: true }));
    renderFolderStep();

    await user.click(await screen.findByTestId('folder-picker-select'));

    await waitFor(() => {
      const resolves = fetchMock.mock.calls.filter(([url]) => url === '/api/projects/resolve');
      expect(JSON.parse(String((resolves.at(-1)![1] as RequestInit).body)).path).toBe('/home/op/Projects');
    });
    expect(await screen.findByRole('button', { name: 'Add project' })).toBeInTheDocument();
  });

  it('folder step copy contains no simple-mode banned words', async () => {
    const user = userEvent.setup();
    routeFetch(existingIntent());
    const { container } = renderFolderStep();

    await screen.findByTestId('folder-picker-select');
    expect(findBannedWords(container.textContent ?? '')).toEqual([]);

    await user.type(screen.getByLabelText('Folder'), '/home/op/Projects/notes');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText(/This folder isn.t a Git repository/);
    expect(findBannedWords(container.textContent ?? '')).toEqual([]);
  });
});

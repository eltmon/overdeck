/**
 * The nested step (PAN-4281 WI-10): a folder of repositories is added as one
 * project per checked repository, or as one multi-repo project.
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

const FOLDER = '/home/op/suite';
const REPOS = [
  { name: 'api', path: `${FOLDER}/api` },
  { name: 'docs', path: `${FOLDER}/docs` },
  { name: 'web', path: `${FOLDER}/web` },
];

const folderIntent: ResolvedProjectIntent = {
  mode: 'existing',
  key: 'suite',
  name: 'suite',
  path: FOLDER,
  parentDir: '/home/op/Projects',
  homeDir: '/home/op',
  cloneUrl: null,
  provider: null,
  repoSlug: null,
  defaultBranch: null,
  remoteChecked: false,
  isGitRepository: false,
  gitRoot: null,
  proposedIssuePrefix: 'SUITE',
  wouldClone: false,
  wouldGitInit: false,
  willCreateMainWorkspace: true,
  registeredKeyAtPath: null,
  findings: [],
  notices: [],
  nestedRepositories: REPOS,
};

type Body = { mode: string; path?: string; repos?: string[] };

/** `failPath`, when set, makes that repository's resolve report a finding. */
function routeFetch(failPath?: string): void {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Body) : null;
    if (url === '/api/projects/resolve') {
      if (body?.path === FOLDER && !body.repos) return Promise.resolve(json(folderIntent));
      if (body?.path && body.path === failPath) {
        return Promise.resolve(json({ findings: [{ field: 'name', code: 'project-exists', message: 'docs is taken.' }] }));
      }
      if (!body?.path) return Promise.resolve(json({ ...folderIntent, path: null, nestedRepositories: [] }));
      return Promise.resolve(json({ findings: [] }));
    }
    if (url === '/api/projects') {
      const key = body!.path!.split('/').pop()!;
      return Promise.resolve(json({ key, name: key, path: body!.path }));
    }
    if (url.startsWith('/api/fs/list-dirs')) {
      return Promise.resolve(json({ path: '/home/op', parent: null, entries: [] }));
    }
    return Promise.resolve(json({}));
  });
}

async function openNested(user: ReturnType<typeof userEvent.setup>, onCreated = vi.fn(), onCancel = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AddProjectDialog variant="modal" initialMode="existing" onCreated={onCreated} onCancel={onCancel} />
    </QueryClientProvider>,
  );
  await user.type(screen.getByLabelText('Folder'), FOLDER);
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByText(/Found 3 repositories in/);
  return { ...view, onCreated, onCancel };
}

const createBodies = () =>
  fetchMock.mock.calls
    .filter(([url]) => url === '/api/projects')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Body);

beforeEach(() => {
  fetchMock.mockReset();
  sessionStorage.clear();
});

afterEach(() => vi.clearAllMocks());

describe('Add-project nested step', () => {
  it('nested step creates each checked repo by calling create once per repo', async () => {
    const user = userEvent.setup();
    routeFetch();
    const { onCreated } = await openNested(user);

    await user.click(screen.getByRole('checkbox', { name: /docs/ }));
    await user.click(screen.getByRole('button', { name: 'Add 2 projects' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(onCreated).toHaveBeenCalledWith({ key: 'web', name: 'web', path: `${FOLDER}/web` });
    expect(createBodies().map((body) => body.path)).toEqual([`${FOLDER}/api`, `${FOLDER}/web`]);
  });

  it('a failing row does not stop the rest and the dialog stays open', async () => {
    const user = userEvent.setup();
    routeFetch(`${FOLDER}/docs`);
    const { onCreated } = await openNested(user);

    await user.click(screen.getByRole('button', { name: 'Add 3 projects' }));

    expect(await screen.findByText('docs is taken.')).toBeInTheDocument();
    await waitFor(() => expect(createBodies().map((body) => body.path)).toEqual([`${FOLDER}/api`, `${FOLDER}/web`]));
    expect(screen.getAllByText('Added')).toHaveLength(2);
    expect(onCreated).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onCreated).toHaveBeenCalledWith({ key: 'web', name: 'web', path: `${FOLDER}/web` });
  });

  it('Add this folder as one project posts one create with repos', async () => {
    const user = userEvent.setup();
    routeFetch();
    const { onCreated } = await openNested(user);

    await user.click(screen.getByRole('checkbox', { name: /api/ }));
    await user.click(screen.getByRole('button', { name: 'Add this folder as one project' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(createBodies()).toEqual([
      expect.objectContaining({ mode: 'existing', path: FOLDER, repos: ['docs', 'web'] }),
    ]);
  });

  it('nested step copy contains no simple-mode banned words', async () => {
    const user = userEvent.setup();
    routeFetch();
    const { container } = await openNested(user);

    expect(findBannedWords(container.textContent ?? '')).toEqual([]);
  });
});

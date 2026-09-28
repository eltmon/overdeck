/**
 * Plain Enter submits the clone URL and the create Name (PAN-4281 WI-7, FR-6),
 * but only once resolve has cleared the form.
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
import type { AddProjectMode } from '../addProjectDialogStore.js';
import type { ResolvedProjectIntent } from '../projectCreateTypes.js';

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function intentFixture(overrides: Partial<ResolvedProjectIntent> = {}): ResolvedProjectIntent {
  return {
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
    ...overrides,
  };
}

function routeFetch(intent: ResolvedProjectIntent): void {
  fetchMock.mockImplementation((url: string) => {
    if (url === '/api/projects/resolve') return Promise.resolve(json(intent));
    if (url === '/api/projects') {
      return Promise.resolve(json({ key: 'widget', name: 'widget', path: '/home/op/Projects/widget' }));
    }
    return Promise.resolve(json({}));
  });
}

function renderStep(initialMode: AddProjectMode, onCreated = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AddProjectDialog variant="modal" initialMode={initialMode} onCreated={onCreated} onCancel={() => {}} />
    </QueryClientProvider>,
  );
  return { onCreated };
}

const creates = () => fetchMock.mock.calls.filter(([url]) => url === '/api/projects');

beforeEach(() => {
  fetchMock.mockReset();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

afterEach(() => vi.clearAllMocks());

describe('Enter submits clone and create', () => {
  it('Enter in the clone URL submits when there are no findings', async () => {
    const user = userEvent.setup();
    routeFetch(intentFixture());
    const { onCreated } = renderStep('clone');

    const field = screen.getByLabelText('Repository URL');
    expect(field).toHaveFocus();
    await user.type(field, 'acme/widget');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Clone repository' })).toBeEnabled());
    await user.keyboard('{Enter}');

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(creates()).toHaveLength(1);
  });

  it('Enter in the clone URL does nothing while findings exist', async () => {
    const user = userEvent.setup();
    routeFetch(
      intentFixture({
        findings: [{ field: 'url', code: 'url-invalid', message: 'Enter a GitHub or GitLab URL, or owner/repo.' }],
      }),
    );
    renderStep('clone');

    await user.type(screen.getByLabelText('Repository URL'), 'not a url');
    await screen.findByText('Enter a GitHub or GitLab URL, or owner/repo.');
    await user.keyboard('{Enter}');

    expect(creates()).toHaveLength(0);
  });

  it('Enter in the create name submits', async () => {
    const user = userEvent.setup();
    routeFetch(intentFixture({ mode: 'new', cloneUrl: null, wouldClone: false, wouldGitInit: true }));
    const { onCreated } = renderStep('new');

    const field = screen.getByLabelText('Project name');
    expect(field).toHaveFocus();
    await user.type(field, 'widget');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create project' })).toBeEnabled());
    await user.keyboard('{Enter}');

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(creates()).toHaveLength(1);
  });
});

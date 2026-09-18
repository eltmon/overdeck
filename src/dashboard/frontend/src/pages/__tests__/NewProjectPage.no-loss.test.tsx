/**
 * No-loss audit for the project-creation surface (PAN-3836 WI-5, AC-5).
 *
 * The old `NewProjectModal` was deleted, and this file is the gate that makes
 * that deletion safe. Every row of the WI-5 inventory is exercised here as a
 * real interaction against the real page and the real hook, with only the
 * network mocked — the previous version asserted static strings and a fully
 * mocked hook, which is how two affordances (the folder picker and the
 * `project_created` telemetry) went missing while the audit stayed green.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../lib/wsTransport.js', () => ({
  dashboardMutationJsonHeaders: vi.fn().mockResolvedValue({ 'content-type': 'application/json' }),
}));

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('../../lib/apiFetch.js', () => ({ fetchWithTimeout: fetchMock }));

const captureMock = vi.hoisted(() => vi.fn());
vi.mock('../../lib/telemetry.js', () => ({ capture: captureMock }));

import { NewProjectPage } from '../NewProjectPage.js';
import type { ResolvedProjectIntent } from '../../components/project/new/projectCreateTypes.js';

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

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

/** Resolve always answers; other calls go to `handler`. */
function routeFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response> = () => json({}),
  intent: ResolvedProjectIntent = intentFixture(),
): void {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url === '/api/projects/resolve') return Promise.resolve(json(intent));
    if (url.startsWith('/api/fs/list-dirs')) {
      return Promise.resolve(
        json({
          path: '/home/op/Projects',
          parent: '/home/op',
          entries: [{ name: 'widget', path: '/home/op/Projects/widget' }],
        }),
      );
    }
    return Promise.resolve(handler(url, init));
  });
}

function renderPage(props: Partial<React.ComponentProps<typeof NewProjectPage>> = {}) {
  return render(
    <NewProjectPage onCancel={props.onCancel ?? (() => {})} onCreated={props.onCreated ?? (() => {})} />,
  );
}

/** Walk the entry view into a mode, the way an operator does. */
async function enterMode(user: ReturnType<typeof userEvent.setup>, label: string): Promise<void> {
  await user.click(screen.getByRole('button', { name: new RegExp(label, 'i') }));
}

beforeEach(() => {
  fetchMock.mockReset();
  captureMock.mockReset();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/projects/new');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('WI-5 no-loss inventory', () => {
  it('row 1 — Add existing and New project are reachable entry actions', async () => {
    const user = userEvent.setup();
    routeFetch();
    renderPage();

    expect(screen.getByRole('button', { name: /Open existing folder/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create new project/i })).toBeInTheDocument();

    await enterMode(user, 'Open existing folder');
    expect(screen.getByLabelText('Folder')).toBeInTheDocument();
  });

  it('row 2 — Clone is an entry action, and ?mode=clone still presets it', async () => {
    routeFetch();
    window.history.replaceState({}, '', '/projects/new?mode=clone');
    renderPage();

    // The preset skips the chooser, exactly as the workspace chips rely on.
    expect(screen.getByLabelText('Repository URL')).toBeInTheDocument();
  });

  it('row 3 — the existing-mode folder picker browses and its selection reaches resolve', async () => {
    const user = userEvent.setup();
    routeFetch(() => json({}), intentFixture({ mode: 'existing' }));
    renderPage();
    await enterMode(user, 'Open existing folder');

    await user.click(screen.getByRole('button', { name: /Browse server folders/i }));
    const select = await screen.findByTestId('folder-picker-select');
    await user.click(select);

    await waitFor(() =>
      expect((screen.getByLabelText('Folder') as HTMLInputElement).value).toBe('/home/op/Projects'),
    );
    // And it is a real control, not a decorative button: the path is submitted.
    await waitFor(() => {
      const resolveCalls = fetchMock.mock.calls.filter(([url]) => url === '/api/projects/resolve');
      const last = JSON.parse((resolveCalls.at(-1)![1] as RequestInit).body as string);
      expect(last.path).toBe('/home/op/Projects');
    });
  });

  it('row 4 — the clone parent picker is real and updates the destination', async () => {
    const user = userEvent.setup();
    routeFetch();
    window.history.replaceState({}, '', '/projects/new?mode=clone');
    renderPage();

    await user.type(screen.getByLabelText('Repository URL'), 'acme/widget');
    await user.click(screen.getByRole('button', { name: /^Browse$/i }));
    await user.click(await screen.findByTestId('folder-picker-select'));

    await waitFor(() =>
      expect((screen.getByLabelText('Parent folder') as HTMLInputElement).value).toBe(
        '/home/op/Projects',
      ),
    );
  });

  it('row 4b — a picker button never submits the form', async () => {
    const user = userEvent.setup();
    routeFetch();
    window.history.replaceState({}, '', '/projects/new?mode=clone');
    renderPage();
    await user.type(screen.getByLabelText('Repository URL'), 'acme/widget');

    await user.click(screen.getByRole('button', { name: /^Browse$/i }));
    await user.click(await screen.findByTestId('folder-picker-entry'));

    // Navigating inside the picker must not have created anything.
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/projects')).toHaveLength(0);
  });

  it('row 5 — the name input keeps its old test id and is editable', async () => {
    const user = userEvent.setup();
    routeFetch();
    window.history.replaceState({}, '', '/projects/new?mode=new');
    renderPage();

    const input = screen.getByTestId('new-project-name-input');
    await user.type(input, 'my-project');
    expect((input as HTMLInputElement).value).toContain('my-project');
  });

  it('row 6 — the parent default is a real server value, not a placeholder', async () => {
    const user = userEvent.setup();
    routeFetch();
    window.history.replaceState({}, '', '/projects/new?mode=clone');
    renderPage();
    await user.type(screen.getByLabelText('Repository URL'), 'acme/widget');

    await waitFor(() =>
      expect((screen.getByLabelText('Parent folder') as HTMLInputElement).value).toBe(
        '/home/op/Projects',
      ),
    );
  });

  it('row 7 — the destination summary states the exact target path', async () => {
    const user = userEvent.setup();
    routeFetch();
    window.history.replaceState({}, '', '/projects/new?mode=clone');
    renderPage();
    await user.type(screen.getByLabelText('Repository URL'), 'acme/widget');

    await waitFor(() => expect(screen.getByText(/\/home\/op\/Projects\/widget/)).toBeInTheDocument());
  });

  it('row 8 — an inline finding is shown and the input survives it', async () => {
    const user = userEvent.setup();
    routeFetch(
      () => json({}),
      intentFixture({
        findings: [{ field: 'url', code: 'remote-unreachable', message: 'Could not reach the remote repository.' }],
      }),
    );
    window.history.replaceState({}, '', '/projects/new?mode=clone');
    renderPage();

    await user.type(screen.getByLabelText('Repository URL'), 'acme/widget');

    await waitFor(() =>
      expect(screen.getByText('Could not reach the remote repository.')).toBeInTheDocument(),
    );
    // What was typed is still there to correct.
    expect((screen.getByLabelText('Repository URL') as HTMLInputElement).value).toBe('acme/widget');
  });

  it('row 9 — Cancel navigates away before submit, and Cancel clone appears during one', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    routeFetch((url) =>
      url === '/api/projects'
        ? json({ jobId: 'job-1' }, 202)
        : json({ status: 'cloning', phase: 'Receiving objects', percent: 10 }),
    );
    window.history.replaceState({}, '', '/projects/new?mode=clone');
    renderPage({ onCancel });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();

    await user.type(screen.getByLabelText('Repository URL'), 'acme/widget');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Clone repository' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Clone repository' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Cancel clone' })).toBeInTheDocument(),
    );
  });

  it('rows 10 and 12 — success calls onCreated once and emits project_created once', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    routeFetch((url) =>
      url === '/api/projects'
        ? json({ key: 'widget', name: 'widget', path: '/home/op/Projects/widget' })
        : json({}),
    );
    window.history.replaceState({}, '', '/projects/new?mode=clone');
    renderPage({ onCreated });

    await user.type(screen.getByLabelText('Repository URL'), 'acme/widget');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Clone repository' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Clone repository' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(captureMock).toHaveBeenCalledWith('project_created', { mode: 'clone' });
  });

  it('row 14 — the project-versus-workspace guidance is visible in every mode', async () => {
    const user = userEvent.setup();
    routeFetch();
    renderPage();

    const guide = () => screen.getByText(/A project is a repository or folder/i);
    expect(guide()).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /create a workspace/i })).toHaveAttribute(
      'href',
      '/workspaces/new',
    );

    for (const label of ['Open existing folder', 'Clone repository', 'Create new project']) {
      await enterMode(user, label);
      expect(guide()).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Change' }));
    }
  });

  it('mode action labels are specific, not a generic Create', async () => {
    const user = userEvent.setup();
    routeFetch();
    renderPage();

    for (const [label, cta] of [
      ['Open existing folder', 'Add project'],
      ['Clone repository', 'Clone repository'],
      ['Create new project', 'Create project'],
    ] as const) {
      await enterMode(user, label);
      const actions = screen.getByRole('button', { name: cta });
      expect(actions).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Change' }));
    }
  });

  it('Options is a disclosure that exposes name and prefix', async () => {
    const user = userEvent.setup();
    routeFetch();
    window.history.replaceState({}, '', '/projects/new?mode=clone');
    renderPage();

    const options = screen.getByRole('button', { name: 'Options' });
    expect(options).toHaveAttribute('aria-expanded', 'false');
    await user.click(options);
    expect(options).toHaveAttribute('aria-expanded', 'true');

    const panel = document.getElementById(options.getAttribute('aria-controls')!)!;
    expect(within(panel).getByLabelText('Issue prefix')).toBeInTheDocument();
    expect(within(panel).getByTestId('new-project-name-input')).toBeInTheDocument();
  });

  it('Options opens itself when a finding lands inside it', async () => {
    const user = userEvent.setup();
    routeFetch(
      () => json({}),
      intentFixture({
        findings: [
          { field: 'issuePrefix', code: 'issue-prefix-taken', message: "Prefix 'WIDGET' is taken." },
        ],
      }),
    );
    window.history.replaceState({}, '', '/projects/new?mode=clone');
    renderPage();

    await user.type(screen.getByLabelText('Repository URL'), 'acme/widget');

    // A finding the operator cannot see is a dead end.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Options' })).toHaveAttribute('aria-expanded', 'true'),
    );
    expect(screen.getByText("Prefix 'WIDGET' is taken.")).toBeInTheDocument();
  });
});

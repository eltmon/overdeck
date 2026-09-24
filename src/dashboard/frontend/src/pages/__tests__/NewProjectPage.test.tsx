/**
 * Behaviour of the project-creation page (PAN-3836 WI-4, §6.1).
 *
 * Mounted with the real hook and only the network mocked, because the states
 * this file is about — frozen inputs, truthful progress, lost contact — are
 * exactly the ones a mocked hook cannot get wrong on your behalf.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../lib/wsTransport.js', () => ({
  dashboardMutationJsonHeaders: vi.fn().mockResolvedValue({ 'content-type': 'application/json' }),
}));

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('../../lib/apiFetch.js', () => ({ fetchWithTimeout: fetchMock }));
vi.mock('../../lib/telemetry.js', () => ({ capture: vi.fn() }));

import { NewProjectPage } from '../NewProjectPage.js';
import { BackendConnectionBoundary } from '../../App/BackendConnectionBoundary.js';
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

function routeFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response> = () => json({}),
  intent: ResolvedProjectIntent = intentFixture(),
): void {
  fetchMock.mockImplementation((url: string, init?: RequestInit) =>
    url === '/api/projects/resolve'
      ? Promise.resolve(json(intent))
      : Promise.resolve(handler(url, init)),
  );
}

function renderPage(onCreated = vi.fn(), onCancel = vi.fn()) {
  render(<NewProjectPage onCancel={onCancel} onCreated={onCreated} />);
  return { onCreated, onCancel };
}

/** Type a URL and wait for the CTA to become usable. */
async function readyToClone(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.type(screen.getByLabelText('Repository URL'), 'acme/widget');
  const cta = screen.getByRole('button', { name: 'Clone repository' });
  await waitFor(() => expect(cta).toBeEnabled());
  return cta;
}

beforeEach(() => {
  fetchMock.mockReset();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/projects/new?mode=clone');
});

afterEach(() => vi.clearAllMocks());

describe('entry and focus', () => {
  it('focuses the first action when no mode is preset', async () => {
    window.history.replaceState({}, '', '/projects/new');
    routeFetch();
    renderPage();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Open existing folder/i })).toHaveFocus(),
    );
  });

  it('focuses the first field of a preset mode', async () => {
    routeFetch();
    renderPage();

    await waitFor(() => expect(screen.getByLabelText('Repository URL')).toHaveFocus());
  });

  it('shows no red validation on first load', () => {
    routeFetch();
    renderPage();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('labels and accessibility', () => {
  it('associates every visible field with a label', async () => {
    const user = userEvent.setup();
    routeFetch();
    renderPage();

    expect(screen.getByLabelText('Repository URL')).toBeInTheDocument();
    expect(screen.getByLabelText('Parent folder')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Options' }));
    expect(screen.getByLabelText('Issue prefix')).toBeInTheDocument();
  });

  it('marks a field invalid and points at its message', async () => {
    const user = userEvent.setup();
    routeFetch(
      () => json({}),
      intentFixture({
        findings: [{ field: 'url', code: 'url-invalid', message: 'Enter a GitHub or GitLab URL.' }],
      }),
    );
    renderPage();

    await user.type(screen.getByLabelText('Repository URL'), 'nope');

    await waitFor(() =>
      expect(screen.getByLabelText('Repository URL')).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a GitHub or GitLab URL.');
  });
});

describe('submission states', () => {
  it('freezes the fields and the mode switch while a clone runs', async () => {
    const user = userEvent.setup();
    routeFetch((url) =>
      url === '/api/projects'
        ? json({ jobId: 'job-1' }, 202)
        : json({ status: 'cloning', phase: 'Receiving objects', percent: 20 }),
    );
    renderPage();

    await user.click(await readyToClone(user));

    await waitFor(() => expect(screen.getByLabelText('Repository URL')).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Change' })).toBeDisabled();
  });

  it('reports phase-local progress with real progressbar semantics', async () => {
    const user = userEvent.setup();
    routeFetch((url) =>
      url === '/api/projects'
        ? json({ jobId: 'job-1' }, 202)
        : json({ status: 'cloning', phase: 'Receiving objects', percent: 20 }),
    );
    renderPage();
    await user.click(await readyToClone(user));

    const bar = await screen.findByRole('progressbar');
    await waitFor(() => expect(bar).toHaveAttribute('value', '20'));
  });

  it('shows an indeterminate bar without inventing a value', async () => {
    const user = userEvent.setup();
    routeFetch((url) =>
      url === '/api/projects'
        ? json({ jobId: 'job-1' }, 202)
        : json({ status: 'preparing', phase: 'preparing', percent: null }),
    );
    renderPage();
    await user.click(await readyToClone(user));

    const bar = await screen.findByRole('progressbar');
    expect(bar).not.toHaveAttribute('value');
  });

  it('says setup must finish instead of offering a fake abort', async () => {
    const user = userEvent.setup();
    routeFetch((url) =>
      url === '/api/projects'
        ? json({ jobId: 'job-1' }, 202)
        : json({ status: 'registering', phase: 'registering', percent: null }),
    );
    renderPage();
    await user.click(await readyToClone(user));

    await waitFor(() => expect(screen.getByText(/Finishing project setup/i)).toBeInTheDocument());
  });

  it('keeps the operation and says so when contact is lost', async () => {
    const user = userEvent.setup();
    let polls = 0;
    routeFetch((url) => {
      if (url === '/api/projects') return json({ jobId: 'job-1' }, 202);
      polls += 1;
      return polls === 1
        ? json({ status: 'cloning', phase: 'Receiving objects', percent: 42 })
        : json({ error: 'unavailable' }, 503);
    });
    renderPage();
    await user.click(await readyToClone(user));

    await waitFor(() =>
      expect(screen.getByText(/Connection interrupted/i)).toBeInTheDocument(),
    );
    // Stale progress is labelled, and there is no live bar claiming otherwise.
    expect(screen.getByText(/Last update:/i)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clone repository' })).toBeDisabled();
  });

  it('offers Finish setup, not another clone, when setup did not complete', async () => {
    const user = userEvent.setup();
    routeFetch((url) =>
      url === '/api/projects'
        ? json({ jobId: 'job-1' }, 202)
        : json({
            status: 'failed',
            phase: 'failed',
            percent: null,
            failure: {
              code: 'setup-incomplete',
              message: 'The repository is available at /home/op/Projects/widget, but project setup did not finish.',
              retrySafe: false,
              recovery: { action: 'finish-setup', key: 'widget', path: '/home/op/Projects/widget' },
            },
          }),
    );
    renderPage();
    await user.click(await readyToClone(user));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Finish setup' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Clone repository' })).toBeDisabled();
  });

  it('preserves what was typed after a terminal failure', async () => {
    const user = userEvent.setup();
    routeFetch((url) =>
      url === '/api/projects'
        ? json({ failure: { code: 'internal-error', message: 'Project setup failed on the server.', retrySafe: true } }, 500)
        : json({}),
    );
    renderPage();
    await user.click(await readyToClone(user));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/failed on the server/i));
    expect((screen.getByLabelText('Repository URL') as HTMLInputElement).value).toBe('acme/widget');
  });
});

describe('keyboard', () => {
  it('submits once for Ctrl+Enter', async () => {
    const user = userEvent.setup();
    routeFetch((url) =>
      url === '/api/projects'
        ? json({ jobId: 'job-1' }, 202)
        : json({ status: 'cloning', phase: 'x', percent: 1 }),
    );
    renderPage();
    await readyToClone(user);

    await user.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/projects')).toHaveLength(1),
    );
  });

  it('does not submit while an IME composition is in flight', async () => {
    routeFetch((url) => (url === '/api/projects' ? json({ jobId: 'j' }, 202) : json({})));
    renderPage();
    const user = userEvent.setup();
    await readyToClone(user);

    const field = screen.getByLabelText('Repository URL');
    // A composing Enter is the IME committing a character, not a submit.
    field.dispatchEvent(
      Object.assign(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
        { isComposing: true },
      ),
    );

    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/projects')).toHaveLength(0);
  });
});

describe('keystrokes typed before the first resolve lands (PAN-3867)', () => {
  /** What the server answers for an untouched `new` form. */
  const emptyNewForm = intentFixture({
    mode: 'new',
    key: null,
    name: '',
    path: null,
    findings: [{ field: 'name', code: 'name-invalid', message: 'Name must contain a letter or number.' }],
  });

  it('keeps a name typed while the initial resolve is still in flight', async () => {
    window.history.replaceState({}, '', '/projects/new?mode=new');
    const pending: Array<(response: Response) => void> = [];
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => pending.push(resolve)));
    renderPage();
    const user = userEvent.setup();

    // The first resolve is on the wire before the operator types.
    await waitFor(() => expect(pending).toHaveLength(1));
    await user.type(screen.getByTestId('new-project-name-input'), 'widget');

    // The late answer describes the empty form it was asked about.
    await act(async () => pending[0]!(json(emptyNewForm)));

    expect((screen.getByTestId('new-project-name-input') as HTMLInputElement).value).toBe('widget');
    expect(screen.queryByText('Name must contain a letter or number.')).not.toBeInTheDocument();
  });

  it('ignores a stale resolve whose body arrives after a newer edit', async () => {
    window.history.replaceState({}, '', '/projects/new?mode=new');
    let releaseStaleBody!: (body: unknown) => void;
    const staleBody = new Promise<unknown>((resolve) => {
      releaseStaleBody = resolve;
    });
    let calls = 0;
    fetchMock.mockImplementation(() => {
      calls += 1;
      // The first response's headers arrive at once; its body is slow.
      if (calls === 1) {
        return Promise.resolve({ ok: true, status: 200, json: () => staleBody } as Response);
      }
      return Promise.resolve(json(intentFixture({ mode: 'new' })));
    });
    renderPage();
    const user = userEvent.setup();

    await waitFor(() => expect(calls).toBe(1));
    await user.type(screen.getByTestId('new-project-name-input'), 'widget');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create project' })).toBeEnabled());

    await act(async () => releaseStaleBody(emptyNewForm));

    expect(screen.queryByText('Name must contain a letter or number.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create project' })).toBeEnabled();
  });

  it('keeps typed fields through a backend-health blip right after load', async () => {
    const user = userEvent.setup();
    routeFetch();
    const page = <NewProjectPage onCancel={vi.fn()} onCreated={vi.fn()} />;
    const { rerender } = render(
      <BackendConnectionBoundary backendDown={false} restarting={false}>{page}</BackendConnectionBoundary>,
    );
    await user.type(screen.getByLabelText('Repository URL'), 'acme/widget');

    // A loaded server misses two health polls, then answers again.
    rerender(<BackendConnectionBoundary backendDown restarting={false}>{page}</BackendConnectionBoundary>);
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for backend data');
    rerender(<BackendConnectionBoundary backendDown={false} restarting={false}>{page}</BackendConnectionBoundary>);

    expect((screen.getByLabelText('Repository URL') as HTMLInputElement).value).toBe('acme/widget');
  });
});

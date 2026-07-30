/**
 * PAN-3331 WI-5 (FR-7, D-7, D-8, D-9): the workspace quick-action band —
 * git card states and degradations, kind-correct Pull, run command edit/run/
 * stop, the config-gated open-in menu, and the view-scoped poll cadence.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceActionBand, rememberRunSession, useRunSession, type WorkspaceGitState } from '../WorkspaceActionBand';

function gitState(overrides: Partial<WorkspaceGitState> = {}): WorkspaceGitState {
  return {
    branch: 'main',
    detached: false,
    dirtyFiles: 0,
    ahead: 0,
    behind: 0,
    hasUpstream: true,
    upstreamRef: 'origin/main',
    recentRemoteCommits: [],
    fetchedAt: 1,
    ...overrides,
  };
}

interface RenderOptions {
  kind?: 'main' | 'issue' | 'scratch';
  issueId?: string | null;
  isGitRepository?: boolean;
  git?: WorkspaceGitState | null;
  runCommand?: string | null;
  runCommandDefault?: string | null;
  runCommandOptions?: Array<{ name: string; command: string }>;
  openInEditorConfigured?: boolean;
  runSessionName?: string | null;
  responses?: Record<string, { status: number; body: unknown }>;
}

function renderBand(options: RenderOptions = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onRunSessionChange = vi.fn();

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const override = options.responses?.[`${method} ${url.split('?')[0]}`];
    if (override) {
      return new Response(JSON.stringify(override.body), {
        status: override.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.startsWith('/api/workspace-registry/ws-1/git')) {
      return Response.json({ git: options.git !== undefined ? options.git : gitState() });
    }
    return Response.json({});
  });
  vi.stubGlobal('fetch', fetchMock);

  render(
    <QueryClientProvider client={client}>
      <WorkspaceActionBand
        workspaceId="ws-1"
        kind={options.kind ?? 'main'}
        issueId={options.issueId ?? null}
        isGitRepository={options.isGitRepository !== false}
        runCommand={options.runCommand ?? null}
        runCommandDefault={options.runCommandDefault ?? null}
        runCommandOptions={options.runCommandOptions ?? []}
        openInEditorConfigured={options.openInEditorConfigured === true}
        runSessionName={options.runSessionName ?? null}
        onRunSessionChange={onRunSessionChange}
      />
    </QueryClientProvider>,
  );

  return { fetchMock, onRunSessionChange, client };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('git card (ac1)', () => {
  it('renders the branch and an up-to-date, clean checkout', async () => {
    renderBand();

    // The card renders its shell before the first response lands, so wait for
    // the branch to arrive rather than for the element to exist.
    await waitFor(() => expect(screen.getByTestId('workspace-band-git-branch')).toHaveTextContent('main'));
    expect(await screen.findByTestId('workspace-band-git-even')).toHaveTextContent('up to date');
    expect(await screen.findByTestId('workspace-band-git-dirty')).toHaveTextContent('clean');
  });

  it('renders behind, ahead, and dirty counts', async () => {
    renderBand({ git: gitState({ behind: 3, ahead: 2, dirtyFiles: 4 }) });

    expect(await screen.findByTestId('workspace-band-git-behind')).toHaveTextContent('3');
    expect(await screen.findByTestId('workspace-band-git-ahead')).toHaveTextContent('2');
    expect(await screen.findByTestId('workspace-band-git-dirty')).toHaveTextContent('4 uncommitted');
  });

  it('shows a detached-HEAD chip instead of the Pull action', async () => {
    renderBand({ git: gitState({ branch: null, detached: true }) });

    expect(await screen.findByTestId('workspace-band-git-detached')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-band-git-pull')).toBeNull();
  });

  it('labels the fallback comparison when the branch has no upstream', async () => {
    renderBand({ git: gitState({ hasUpstream: false, upstreamRef: 'origin/HEAD' }) });

    expect(await screen.findByTestId('workspace-band-git-upstream')).toHaveTextContent('no upstream');
  });

  it('hides the git card entirely for a non-git workspace', async () => {
    renderBand({ isGitRepository: false });

    expect(await screen.findByTestId('workspace-band-run')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-band-git')).toBeNull();
  });

  it('asks the server to fetch on the first read only', async () => {
    const { fetchMock, client } = renderBand();

    await screen.findByTestId('workspace-band-git-branch');
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/workspace-registry/ws-1/git?fetch=1');

    await act(async () => {
      await client.refetchQueries({ queryKey: ['workspace-registry', 'ws-1', 'git'] });
    });

    const gitCalls = fetchMock.mock.calls.map((call) => String(call[0])).filter((url) => url.includes('/git'));
    expect(gitCalls[1]).toBe('/api/workspace-registry/ws-1/git?fetch=0');
  });

  it('forces a fetch when the operator hits Refresh', async () => {
    const { fetchMock } = renderBand();

    await screen.findByTestId('workspace-band-git-branch');
    fireEvent.click(screen.getByTestId('workspace-band-git-refresh'));

    await waitFor(() => {
      const gitCalls = fetchMock.mock.calls.map((call) => String(call[0])).filter((url) => url.includes('/git'));
      expect(gitCalls.at(-1)).toBe('/api/workspace-registry/ws-1/git?fetch=1');
    });
  });
});

describe('pull (ac2)', () => {
  it('calls the registry pull route for a main workspace', async () => {
    const { fetchMock } = renderBand({ kind: 'main', git: gitState({ behind: 1 }) });

    fireEvent.click(await screen.findByTestId('workspace-band-git-pull'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/workspace-registry/ws-1/pull', expect.objectContaining({ method: 'POST' }));
    });
  });

  it('calls sync-main for an issue workspace and never the pull route', async () => {
    const { fetchMock } = renderBand({ kind: 'issue', issueId: 'PAN-9001', git: gitState({ behind: 1 }) });

    fireEvent.click(await screen.findByTestId('workspace-band-git-pull'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/issues/PAN-9001/sync-main', expect.objectContaining({ method: 'POST' }));
    });
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.endsWith('/pull'))).toBe(false);
  });

  it('surfaces a refusal reason verbatim', async () => {
    renderBand({
      git: gitState({ behind: 1 }),
      responses: {
        'POST /api/workspace-registry/ws-1/pull': {
          status: 409,
          body: { error: '2 uncommitted files — commit or discard before pulling.', reason: 'dirty' },
        },
      },
    });

    fireEvent.click(await screen.findByTestId('workspace-band-git-pull'));

    expect(await screen.findByTestId('workspace-band-git-message'))
      .toHaveTextContent('2 uncommitted files — commit or discard before pulling.');
  });

  it('lists the incoming remote commits behind an expander', async () => {
    renderBand({
      git: gitState({
        behind: 2,
        recentRemoteCommits: [
          { sha: 'a'.repeat(40), subject: 'first incoming', author: 'Test', date: '2026-07-30T00:00:00Z' },
          { sha: 'b'.repeat(40), subject: 'second incoming', author: 'Test', date: '2026-07-30T00:00:00Z' },
        ],
      }),
    });

    fireEvent.click(await screen.findByTestId('workspace-band-git-commits-toggle'));

    const list = await screen.findByTestId('workspace-band-git-commits');
    expect(list).toHaveTextContent('first incoming');
    expect(list).toHaveTextContent('second incoming');
    expect(list).toHaveTextContent('aaaaaaa');
  });
});

describe('run card (ac3)', () => {
  it('shows the project default when no override is stored', async () => {
    renderBand({ runCommandDefault: 'npm run dev' });

    expect(await screen.findByTestId('workspace-band-run-command')).toHaveTextContent('npm run dev');
  });

  it('persists an edited command through the run-command route', async () => {
    const { fetchMock } = renderBand({ runCommandDefault: 'npm run dev' });

    fireEvent.click(await screen.findByTestId('workspace-band-run-edit'));
    fireEvent.change(screen.getByTestId('workspace-band-run-input'), { target: { value: 'bun run dev' } });
    fireEvent.click(screen.getByTestId('workspace-band-run-save'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspace-registry/ws-1/run-command',
        expect.objectContaining({ method: 'PUT', body: JSON.stringify({ command: 'bun run dev' }) }),
      );
    });
  });

  it('clears the override when the edited command is emptied', async () => {
    const { fetchMock } = renderBand({ runCommand: 'bun run dev' });

    fireEvent.click(await screen.findByTestId('workspace-band-run-edit'));
    fireEvent.change(screen.getByTestId('workspace-band-run-input'), { target: { value: '  ' } });
    fireEvent.click(screen.getByTestId('workspace-band-run-save'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspace-registry/ws-1/run-command',
        expect.objectContaining({ body: JSON.stringify({ command: null }) }),
      );
    });
  });

  it('fills the editor from a configured service option', async () => {
    renderBand({ runCommandOptions: [{ name: 'api', command: './run-dev.sh' }] });

    fireEvent.click(await screen.findByTestId('workspace-band-run-edit'));
    fireEvent.click(screen.getByTestId('workspace-band-run-option-api'));

    expect(screen.getByTestId('workspace-band-run-input')).toHaveValue('./run-dev.sh');
  });

  it('starts a run session and hands the session name up to the view', async () => {
    const { onRunSessionChange } = renderBand({
      runCommand: 'npm run dev',
      responses: {
        'POST /api/workspace-registry/ws-1/run': { status: 200, body: { sessionName: 'ws-run-abc12345', command: 'npm run dev' } },
      },
    });

    fireEvent.click(await screen.findByTestId('workspace-band-run-start'));

    await waitFor(() => expect(onRunSessionChange).toHaveBeenCalledWith('ws-run-abc12345'));
  });

  it('re-focuses the live session when the server answers 409', async () => {
    const { onRunSessionChange } = renderBand({
      runCommand: 'npm run dev',
      responses: {
        'POST /api/workspace-registry/ws-1/run': {
          status: 409,
          body: { sessionName: 'ws-run-abc12345', command: 'npm run dev', alreadyRunning: true },
        },
      },
    });

    fireEvent.click(await screen.findByTestId('workspace-band-run-start'));

    await waitFor(() => expect(onRunSessionChange).toHaveBeenCalledWith('ws-run-abc12345'));
    expect(await screen.findByTestId('workspace-band-run-message')).toHaveTextContent('Already running');
  });

  it('stops the live session through the terminals route', async () => {
    const { fetchMock, onRunSessionChange } = renderBand({
      runCommand: 'npm run dev',
      runSessionName: 'ws-run-abc12345',
    });

    fireEvent.click(await screen.findByTestId('workspace-band-run-stop'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/terminals/ws-run-abc12345', expect.objectContaining({ method: 'DELETE' }));
    });
    await waitFor(() => expect(onRunSessionChange).toHaveBeenCalledWith(null));
  });

  it('offers Restart rather than Run while a session is live', async () => {
    renderBand({ runCommand: 'npm run dev', runSessionName: 'ws-run-abc12345' });

    expect(await screen.findByTestId('workspace-band-run-start')).toHaveTextContent('Restart');
  });

  // Review finding: Restart used to call the plain run route, which the server
  // answers 409 for a live session — the process was never replaced.
  it('Restart kills the live session before starting a new one', async () => {
    const { fetchMock, onRunSessionChange } = renderBand({
      runCommand: 'npm run dev',
      runSessionName: 'ws-run-abc12345',
      responses: {
        'DELETE /api/terminals/ws-run-abc12345': { status: 200, body: { ok: true } },
        'POST /api/workspace-registry/ws-1/run': { status: 200, body: { sessionName: 'ws-run-abc12345', command: 'npm run dev' } },
      },
    });

    fireEvent.click(await screen.findByTestId('workspace-band-run-start'));

    await waitFor(() => expect(onRunSessionChange).toHaveBeenCalledWith('ws-run-abc12345'));
    const calls = fetchMock.mock.calls.map((call) => `${(call[1] as RequestInit | undefined)?.method ?? 'GET'} ${String(call[0])}`);
    const killIndex = calls.indexOf('DELETE /api/terminals/ws-run-abc12345');
    const runIndex = calls.indexOf('POST /api/workspace-registry/ws-1/run');
    expect(killIndex).toBeGreaterThanOrEqual(0);
    expect(runIndex).toBeGreaterThan(killIndex);
    // Dropped in between so the terminal unmounts instead of staying attached
    // to a dead pane, then re-set for the fresh session.
    expect(onRunSessionChange.mock.calls.map((c) => c[0])).toEqual([null, 'ws-run-abc12345']);
  });

  it('reports a Restart whose new session could not start', async () => {
    renderBand({
      runCommand: 'npm run dev',
      runSessionName: 'ws-run-abc12345',
      responses: {
        'DELETE /api/terminals/ws-run-abc12345': { status: 200, body: { ok: true } },
        'POST /api/workspace-registry/ws-1/run': {
          status: 409,
          body: { sessionName: 'ws-run-abc12345', alreadyRunning: true },
        },
      },
    });

    fireEvent.click(await screen.findByTestId('workspace-band-run-start'));

    expect(await screen.findByTestId('workspace-band-run-message')).toHaveTextContent('still shutting down');
  });

  it('does not start a new session when the stop genuinely fails', async () => {
    const { fetchMock } = renderBand({
      runCommand: 'npm run dev',
      runSessionName: 'ws-run-abc12345',
      responses: {
        'DELETE /api/terminals/ws-run-abc12345': { status: 500, body: { error: 'tmux unreachable' } },
      },
    });

    fireEvent.click(await screen.findByTestId('workspace-band-run-start'));

    await screen.findByTestId('workspace-band-run-message');
    const ran = fetchMock.mock.calls.some((call) => String(call[0]).endsWith('/run'));
    expect(ran).toBe(false);
  });

  // Review cycle 2: a run process that exits on its own leaves a remembered
  // session name behind. Stop is idempotent server-side, so Restart recovers.
  it('restarts a remembered session whose process already exited', async () => {
    const { fetchMock, onRunSessionChange } = renderBand({
      runCommand: 'npm run dev',
      runSessionName: 'ws-run-abc12345',
      responses: {
        'DELETE /api/terminals/ws-run-abc12345': { status: 200, body: { ok: true, alreadyStopped: true } },
        'POST /api/workspace-registry/ws-1/run': { status: 200, body: { sessionName: 'ws-run-abc12345', command: 'npm run dev' } },
      },
    });

    fireEvent.click(await screen.findByTestId('workspace-band-run-start'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/workspace-registry/ws-1/run', expect.objectContaining({ method: 'POST' }));
    });
    expect(onRunSessionChange.mock.calls.map((c) => c[0])).toEqual([null, 'ws-run-abc12345']);
  });

  it('clears a remembered session that had already exited when Stop is pressed', async () => {
    const { onRunSessionChange } = renderBand({
      runCommand: 'npm run dev',
      runSessionName: 'ws-run-abc12345',
      responses: {
        'DELETE /api/terminals/ws-run-abc12345': { status: 200, body: { ok: true, alreadyStopped: true } },
      },
    });

    fireEvent.click(await screen.findByTestId('workspace-band-run-stop'));

    await waitFor(() => expect(onRunSessionChange).toHaveBeenCalledWith(null));
  });

  it('disables Run when nothing is configured', async () => {
    renderBand();

    expect(await screen.findByTestId('workspace-band-run-start')).toBeDisabled();
  });
});

describe('open-in menu and cadence (ac4)', () => {
  it('hides the editor entry until the config gate reports it available', async () => {
    renderBand();

    expect(await screen.findByTestId('workspace-band-open-file-manager')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-band-open-editor')).toBeNull();
  });

  it('shows the editor entry when configured and posts the editor target', async () => {
    const { fetchMock } = renderBand({ openInEditorConfigured: true });

    fireEvent.click(await screen.findByTestId('workspace-band-open-editor'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspace-registry/ws-1/open',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ target: 'editor' }) }),
      );
    });
  });

  it('reveals the workspace in the file manager', async () => {
    const { fetchMock } = renderBand();

    fireEvent.click(await screen.findByTestId('workspace-band-open-file-manager'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspace-registry/ws-1/open',
        expect.objectContaining({ body: JSON.stringify({ target: 'file-manager' }) }),
      );
    });
  });

  it('polls the git state every 30 seconds while mounted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { fetchMock } = renderBand();

    await screen.findByTestId('workspace-band-git-branch');
    const before = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/git')).length;

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });

    const after = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/git')).length;
    expect(after).toBeGreaterThan(before);
  });
});

// Review finding: the run session used to live in once-seeded local state, so
// navigating between workspaces showed the wrong terminal and a palette start
// for the mounted workspace never appeared.
describe('run-session store (keyed and reactive)', () => {
  function Probe({ workspaceId }: { workspaceId: string }) {
    const session = useRunSession(workspaceId);
    return <span data-testid="probe">{session ?? 'none'}</span>;
  }

  afterEach(() => {
    rememberRunSession('ws-a', null);
    rememberRunSession('ws-b', null);
  });

  it('returns the session of the workspace it was asked about', () => {
    rememberRunSession('ws-a', 'ws-run-aaaa');
    rememberRunSession('ws-b', 'ws-run-bbbb');

    const { rerender } = render(<Probe workspaceId="ws-a" />);
    expect(screen.getByTestId('probe')).toHaveTextContent('ws-run-aaaa');

    // Same component instance, different workspace — exactly what the router
    // does, and what once-seeded state got wrong.
    rerender(<Probe workspaceId="ws-b" />);
    expect(screen.getByTestId('probe')).toHaveTextContent('ws-run-bbbb');
  });

  it('re-renders when a session is started elsewhere, such as from the palette', async () => {
    render(<Probe workspaceId="ws-a" />);
    expect(screen.getByTestId('probe')).toHaveTextContent('none');

    act(() => { rememberRunSession('ws-a', 'ws-run-aaaa'); });

    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('ws-run-aaaa'));
  });

  it('reports none for a workspace with no run session', () => {
    rememberRunSession('ws-a', 'ws-run-aaaa');

    render(<Probe workspaceId="ws-b" />);

    expect(screen.getByTestId('probe')).toHaveTextContent('none');
  });
});

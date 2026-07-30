/**
 * PAN-3331 WI-5 (FR-7, D-7, D-8, D-9): the workspace quick-action band —
 * git card states and degradations, kind-correct Pull, run command edit/run/
 * stop, the config-gated open-in menu, and the view-scoped poll cadence.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceActionBand, type WorkspaceGitState } from '../WorkspaceActionBand';

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

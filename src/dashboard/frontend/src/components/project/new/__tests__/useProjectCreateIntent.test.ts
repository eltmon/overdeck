/**
 * Tests for useProjectCreateIntent (PAN-3836 WI-4).
 *
 * The centrepiece is the HTTP 503 regression. The reviewed hook did
 * `setCreating(false)` on a failed poll, so a transient error while a clone was
 * still running re-enabled Create, kept a stale 42% on screen, and showed an
 * error — three contradictory things at once, and an invitation to start a
 * second clone. That case is written here against the real hook.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../../../../lib/wsTransport.js', () => ({
  dashboardMutationJsonHeaders: vi.fn().mockResolvedValue({ 'content-type': 'application/json' }),
}));

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('../../../../lib/apiFetch.js', () => ({ fetchWithTimeout: fetchMock }));

const captureMock = vi.hoisted(() => vi.fn());
vi.mock('../../../../lib/telemetry.js', () => ({ capture: captureMock }));

import {
  useProjectCreateIntent,
  RESOLVE_DEBOUNCE_MS,
  POLL_INTERVAL_MS,
  OBSERVATION_STORAGE_KEY,
} from '../useProjectCreateIntent.js';
import type { ResolvedProjectIntent } from '../projectCreateTypes.js';

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

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/** Answer the resolve call, and route everything else through `handler`. */
function route(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url === '/api/projects/resolve') return Promise.resolve(jsonResponse(intentFixture()));
    return Promise.resolve(handler(url, init));
  });
}

async function settleResolve(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(RESOLVE_DEBOUNCE_MS);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fetchMock.mockReset();
  captureMock.mockReset();
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('resolve', () => {
  it('debounces and exposes server-resolved defaults as real values', async () => {
    route(() => jsonResponse({}));
    const { result } = renderHook(() => useProjectCreateIntent({ initialMode: 'clone' }));

    act(() => result.current.setUrl('acme/widget'));
    expect(fetchMock).not.toHaveBeenCalled(); // not until it settles

    await settleResolve();
    await waitFor(() => expect(result.current.intent).not.toBeNull());

    // Defaults are values, not placeholders (D-4).
    expect(result.current.parentDir).toBe('/home/op/Projects');
    expect(result.current.name).toBe('widget');
    expect(result.current.issuePrefix).toBe('WIDGET');
  });

  it('keeps an explicit edit when the source changes (D-17)', async () => {
    route(() => jsonResponse({}));
    const { result } = renderHook(() => useProjectCreateIntent({ initialMode: 'clone' }));

    act(() => result.current.setUrl('acme/widget'));
    await settleResolve();
    await waitFor(() => expect(result.current.intent).not.toBeNull());

    act(() => result.current.setName('my-own-name'));
    act(() => result.current.setUrl('acme/other'));
    await settleResolve();

    // The proposal changed underneath; the typed name did not.
    expect(result.current.name).toBe('my-own-name');
    expect(result.current.hasOverrides).toBe(true);

    act(() => result.current.resetOverrides());
    await waitFor(() => expect(result.current.name).toBe('widget'));
  });

  it('shows no findings before the operator has typed anything', () => {
    route(() => jsonResponse({}));
    const { result } = renderHook(() => useProjectCreateIntent({ initialMode: 'clone' }));

    expect(result.current.findingsFor('url')).toHaveLength(0);
    expect(result.current.canCreate).toBe(false);
  });
});

describe('submission', () => {
  async function readyHook() {
    const { result } = renderHook(() => useProjectCreateIntent({ initialMode: 'clone' }));
    act(() => result.current.setUrl('acme/widget'));
    await settleResolve();
    await waitFor(() => expect(result.current.canCreate).toBe(true));
    return result;
  }

  it('starts one operation for two submits in the same tick', async () => {
    route((url) =>
      url === '/api/projects'
        ? jsonResponse({ jobId: 'job-1' }, 202)
        : jsonResponse({ status: 'cloning', phase: 'Receiving objects', percent: 10 }),
    );
    const result = await readyHook();

    await act(async () => {
      // No await between them: the synchronous guard is the only thing that can
      // stop the second.
      void result.current.submit();
      void result.current.submit();
    });

    const creates = fetchMock.mock.calls.filter(([url]) => url === '/api/projects');
    expect(creates).toHaveLength(1);
  });

  it('sends one stable operationId so a retry can attach server-side', async () => {
    route((url) =>
      url === '/api/projects'
        ? jsonResponse({ jobId: 'job-1' }, 202)
        : jsonResponse({ status: 'cloning', phase: 'x', percent: 1 }),
    );
    const result = await readyHook();
    await act(async () => {
      await result.current.submit();
    });

    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/projects')!;
    expect(JSON.parse((init as RequestInit).body as string).operationId).toEqual(expect.any(String));
  });

  it('folds a 422 back into field findings and stays editable', async () => {
    route((url) =>
      url === '/api/projects'
        ? jsonResponse({ findings: [{ field: 'url', code: 'remote-unreachable', message: 'nope' }] }, 422)
        : jsonResponse({}),
    );
    const result = await readyHook();
    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.submission.kind).toBe('editing');
    expect(result.current.findingsFor('url')).toHaveLength(1);
  });

  it('treats a 202 without a job id as unknown, never as a retry invitation', async () => {
    route((url) => (url === '/api/projects' ? jsonResponse({}, 202) : jsonResponse({})));
    const result = await readyHook();
    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.submission.kind).toBe('connection-lost');
    expect(result.current.canCreate).toBe(false);
  });

  it('emits project_created exactly once and calls onCreated once', async () => {
    const onCreated = vi.fn();
    route((url) =>
      url === '/api/projects'
        ? jsonResponse({ key: 'widget', name: 'widget', path: '/home/op/Projects/widget' })
        : jsonResponse({}),
    );
    const { result } = renderHook(() =>
      useProjectCreateIntent({ initialMode: 'existing', onCreated }),
    );
    act(() => result.current.setPath('/home/op/Projects/widget'));
    await settleResolve();
    await waitFor(() => expect(result.current.canCreate).toBe(true));

    await act(async () => {
      await result.current.submit();
    });

    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(captureMock).toHaveBeenCalledWith('project_created', { mode: 'existing' });
  });
});

describe('polling and lost contact', () => {
  async function runningHook() {
    const { result } = renderHook(() => useProjectCreateIntent({ initialMode: 'clone' }));
    act(() => result.current.setUrl('acme/widget'));
    await settleResolve();
    await waitFor(() => expect(result.current.canCreate).toBe(true));
    await act(async () => {
      await result.current.submit();
    });
    return result;
  }

  it('REGRESSION: an HTTP 503 poll keeps the operation instead of re-enabling Create', async () => {
    // The reviewed hook set creating = false here, which produced a stale
    // percentage, an error, and an enabled Create button simultaneously.
    let polls = 0;
    route((url) => {
      if (url === '/api/projects') return jsonResponse({ jobId: 'job-1' }, 202);
      polls += 1;
      if (polls === 1) return jsonResponse({ status: 'cloning', phase: 'Receiving objects', percent: 42 });
      return jsonResponse({ error: 'unavailable' }, 503);
    });

    const result = await runningHook();
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS * 2);
    });

    await waitFor(() => expect(result.current.submission.kind).toBe('connection-lost'));
    // The three things the old hook got wrong, asserted together:
    expect(result.current.canCreate).toBe(false); // Create stayed enabled before
    if (result.current.submission.kind === 'connection-lost') {
      // Progress is kept, but as an explicitly stale "last update", and the page
      // renders no live progress bar for it.
      expect(result.current.submission.lastProgress?.percent).toBe(42);
      expect(result.current.submission.exhausted).toBe(false); // still retrying
    }
  });

  it('reconciles exactly once on a 404 rather than resubmitting', async () => {
    let reconciles = 0;
    route((url) => {
      if (url === '/api/projects') return jsonResponse({ jobId: 'job-1' }, 202);
      if (url === '/api/projects/create-jobs/reconcile') {
        reconciles += 1;
        return jsonResponse({ status: 'unknown', reason: 'no proof' });
      }
      return jsonResponse({ error: 'Unknown job' }, 404);
    });

    const result = await runningHook();
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });

    await waitFor(() => expect(reconciles).toBe(1));
    // Unknown is not success and not a retry.
    expect(result.current.submission.kind).toBe('connection-lost');
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/projects')).toHaveLength(1);
  });

  it('resumes polling when reconcile says the server still owns the job', async () => {
    let polls = 0;
    route((url) => {
      if (url === '/api/projects') return jsonResponse({ jobId: 'job-1' }, 202);
      if (url === '/api/projects/create-jobs/reconcile') {
        return jsonResponse({ status: 'job', job: { id: 'job-2', phase: 'cloning', percent: 42 } });
      }
      if (url === '/api/projects/create-jobs/job-2') {
        polls += 1;
        return jsonResponse({ status: 'cloning', phase: 'cloning', percent: 60 });
      }
      return jsonResponse({ error: 'Unknown job' }, 404);
    });

    const result = await runningHook();
    // The first job id 404s, so the hook reconciles — and gets a live job back.
    // Treating that as exhausted would strand the operator while a clone runs.
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });

    await waitFor(() => expect(result.current.submission.kind).toBe('running'));
    await waitFor(() => expect(polls).toBeGreaterThan(0));
  });

  it('surfaces a completed reconcile as success', async () => {
    route((url) => {
      if (url === '/api/projects') return jsonResponse({ jobId: 'job-1' }, 202);
      if (url === '/api/projects/create-jobs/reconcile') {
        return jsonResponse({
          status: 'completed',
          key: 'widget',
          path: '/home/op/Projects/widget',
          mainWorkspaceId: 'ws-1',
        });
      }
      return jsonResponse({ error: 'Unknown job' }, 404);
    });

    const result = await runningHook();
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });

    await waitFor(() => expect(result.current.submission.kind).toBe('done'));
  });

  it('offers repair without cloning again when setup did not finish', async () => {
    route((url) => {
      if (url === '/api/projects') return jsonResponse({ jobId: 'job-1' }, 202);
      return jsonResponse({
        status: 'failed',
        phase: 'failed',
        percent: null,
        failure: {
          code: 'setup-incomplete',
          message: 'setup did not finish',
          retrySafe: false,
          recovery: { action: 'finish-setup', key: 'widget', path: '/home/op/Projects/widget' },
        },
      });
    });

    const result = await runningHook();
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });

    await waitFor(() => expect(result.current.submission.kind).toBe('needs-setup'));
    expect(result.current.canCreate).toBe(false);
  });

  it('suspends automatic retries on an auth failure', async () => {
    route((url) =>
      url === '/api/projects'
        ? jsonResponse({ jobId: 'job-1' }, 202)
        : jsonResponse({ error: 'unauthorized' }, 401),
    );

    const result = await runningHook();
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });

    await waitFor(() => {
      expect(result.current.submission.kind).toBe('connection-lost');
      if (result.current.submission.kind === 'connection-lost') {
        expect(result.current.submission.exhausted).toBe(true);
      }
    });
  });
});

describe('observation across a reload', () => {
  it('stores a safe observation while an operation runs', async () => {
    route((url) =>
      url === '/api/projects'
        ? jsonResponse({ jobId: 'job-1' }, 202)
        : jsonResponse({ status: 'cloning', phase: 'x', percent: 1 }),
    );
    const { result } = renderHook(() => useProjectCreateIntent({ initialMode: 'clone' }));
    act(() => result.current.setUrl('acme/widget'));
    await settleResolve();
    await waitFor(() => expect(result.current.canCreate).toBe(true));
    await act(async () => {
      await result.current.submit();
    });

    const stored = JSON.parse(sessionStorage.getItem(OBSERVATION_STORAGE_KEY)!);
    expect(stored).toMatchObject({ version: 1, jobId: 'job-1', expectedKey: 'widget' });
    // Never the transport URL: it can carry a token.
    expect(JSON.stringify(stored)).not.toContain('github.com');
  });

  it('resumes observing a stored operation on mount', async () => {
    sessionStorage.setItem(
      OBSERVATION_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        operationId: 'op-1',
        jobId: 'job-9',
        mode: 'clone',
        expectedKey: 'widget',
        expectedPath: '/home/op/Projects/widget',
      }),
    );
    route(() => jsonResponse({ status: 'cloning', phase: 'Receiving objects', percent: 5 }));

    const { result } = renderHook(() => useProjectCreateIntent({ initialMode: 'clone' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/projects/create-jobs/job-9', expect.anything()),
    );
    expect(result.current.canCreate).toBe(false);
  });
});

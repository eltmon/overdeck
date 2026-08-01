/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/apiFetch.js', () => ({ fetchWithTimeout: vi.fn() }));
vi.mock('../../../../lib/wsTransport.js', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({
    'Content-Type': 'application/json',
    'x-overdeck-csrf-token': 'test-csrf',
  })),
}));

import { fetchWithTimeout } from '../../../../lib/apiFetch.js';
import {
  RESOLVE_DEBOUNCE_MS,
  type ResolvedWorkspaceIntent,
  useWorkspaceCreateIntent,
} from '../useWorkspaceCreateIntent.js';

const mockFetch = fetchWithTimeout as ReturnType<typeof vi.fn>;

function ok(data: unknown, status = 200): Response {
  return { ok: true, status, json: () => Promise.resolve(data) } as unknown as Response;
}

function err(status: number, data: unknown): Response {
  return { ok: false, status, json: () => Promise.resolve(data) } as unknown as Response;
}

function resolvedIntent(overrides: Partial<ResolvedWorkspaceIntent> = {}): ResolvedWorkspaceIntent {
  return {
    projectId: 'overdeck',
    kind: 'scratch',
    name: 'lens',
    path: '/repo',
    branchName: null,
    parentBranch: 'main',
    parentBranchGuessed: true,
    isGitRepository: true,
    wouldCreateWorktree: false,
    unregisteredTargetPath: false,
    findings: [],
    ...overrides,
  };
}

function resolveBodies(): Array<Record<string, unknown>> {
  return mockFetch.mock.calls
    .filter(([url]) => url === '/api/workspace-registry/resolve')
    .map(([, init]) => JSON.parse((init as RequestInit).body as string) as Record<string, unknown>);
}

async function settleResolve() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(RESOLVE_DEBOUNCE_MS);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mockFetch.mockReset();
  mockFetch.mockImplementation((url: string) => {
    if (url === '/api/workspace-registry/resolve') return Promise.resolve(ok(resolvedIntent()));
    if (url === '/api/workspace-registry') return Promise.resolve(ok({ id: 'ws-new' }, 201));
    return Promise.resolve(ok({}));
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useWorkspaceCreateIntent', () => {
  it('fires exactly one resolve after rapid edits settle for 300ms', async () => {
    const { result } = renderHook(() => useWorkspaceCreateIntent());

    act(() => result.current.setName('l'));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    act(() => result.current.setName('le'));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    act(() => result.current.setName('lens'));

    expect(resolveBodies()).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(RESOLVE_DEBOUNCE_MS - 1); });
    expect(resolveBodies()).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });

    expect(resolveBodies()).toEqual([
      expect.objectContaining({ name: 'lens' }),
    ]);
  });

  it('marks a changed intent stale until its successful resolve finishes', async () => {
    const { result } = renderHook(() => useWorkspaceCreateIntent());
    await settleResolve();
    expect(result.current.stale).toBe(false);
    expect(result.current.canCreate).toBe(true);

    let releaseResolve!: (response: Response) => void;
    const pendingResolve = new Promise<Response>((resolve) => { releaseResolve = resolve; });
    mockFetch.mockImplementationOnce(() => pendingResolve);

    act(() => result.current.setName('changed'));
    expect(result.current.stale).toBe(true);
    expect(result.current.canCreate).toBe(false);
    expect(result.current.intent).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(RESOLVE_DEBOUNCE_MS); });
    expect(result.current.stale).toBe(true);
    expect(result.current.canCreate).toBe(false);

    await act(async () => { releaseResolve(ok(resolvedIntent({ name: 'changed' }))); });
    expect(result.current.stale).toBe(false);
    expect(result.current.canCreate).toBe(true);
  });

  it('surfaces create findings without reporting a created workspace', async () => {
    const onCreated = vi.fn();
    const { result } = renderHook(() => useWorkspaceCreateIntent({ onCreated }));
    await settleResolve();
    mockFetch.mockImplementationOnce(() => Promise.resolve(err(422, {
      findings: [{ field: 'name', code: 'invalid-name', message: 'Use a valid workspace name.' }],
    })));

    await act(async () => {
      expect(await result.current.submitIntent()).toBeNull();
    });

    expect(result.current.findingsFor('name')).toEqual([
      expect.objectContaining({ code: 'invalid-name' }),
    ]);
    expect(result.current.canCreate).toBe(false);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('omits targetPath from isolated resolve requests', async () => {
    const { result } = renderHook(() => useWorkspaceCreateIntent({ initialProjectKey: 'overdeck' }));

    act(() => {
      result.current.setTargetPath('/repo');
      result.current.setMode('isolated');
    });
    await settleResolve();

    const body = resolveBodies().at(-1);
    expect(body).toMatchObject({ project: 'overdeck', isolated: true });
    expect(body?.targetPath).toBeUndefined();
  });

  it('posts the current clean intent and reports the created workspace id', async () => {
    const onCreated = vi.fn();
    const { result } = renderHook(() => useWorkspaceCreateIntent({
      initialProjectKey: 'overdeck',
      onCreated,
    }));
    act(() => result.current.setName('lens'));
    await settleResolve();

    let createdId: string | null = null;
    await act(async () => {
      createdId = await result.current.submitIntent();
    });

    const createCall = mockFetch.mock.calls.find(([url]) => url === '/api/workspace-registry');
    expect(JSON.parse((createCall?.[1] as RequestInit).body as string)).toMatchObject({
      project: 'overdeck',
      name: 'lens',
      isolated: false,
    });
    expect(createdId).toBe('ws-new');
    expect(onCreated).toHaveBeenCalledWith('ws-new');
  });
});

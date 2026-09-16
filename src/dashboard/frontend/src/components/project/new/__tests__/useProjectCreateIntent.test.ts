/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock API fetches — mock fetchWithTimeout to avoid AbortSignal.timeout() blocking under fake timers
vi.mock('../../../../lib/apiFetch.js', () => ({
  fetchWithTimeout: vi.fn(),
}));

import { fetchWithTimeout } from '../../../../lib/apiFetch.js';
import { useProjectCreateIntent, RESOLVE_DEBOUNCE_MS } from '../useProjectCreateIntent.js';

const mockFetch = fetchWithTimeout as ReturnType<typeof vi.fn>;

const mockDashboardHeaders = vi.fn().mockResolvedValue({ 'Content-Type': 'application/json' });
vi.mock('../../../../lib/wsTransport.js', () => ({
  dashboardMutationJsonHeaders: () => mockDashboardHeaders(),
}));

describe('useProjectCreateIntent (PAN-3836)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('WI-4.1: debounces resolve on rapid field changes', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        mode: 'clone',
        key: 'test-proj',
        name: 'Test Proj',
        path: '/home/test/test-proj',
        findings: [],
        isGitRepository: true,
        wouldClone: true,
        wouldGitInit: false,
        willCreateMainWorkspace: false,
        cloneUrl: 'https://github.com/o/r.git',
        provider: 'github',
        repoSlug: 'o/r',
        defaultBranch: 'main',
        remoteChecked: true,
        proposedIssuePrefix: 'TR',
      }),
    });

    const { result } = renderHook(() => useProjectCreateIntent());

    // Rapid edits wrapped in act — start without awaiting, advance timers, then check
    act(() => {
      result.current.setUrl('https://github.com');
      result.current.setUrl('https://github.com/');
      result.current.setUrl('https://github.com/o');
      result.current.setUrl('https://github.com/o/r');
    });

    // No resolve yet
    expect(mockFetch).not.toHaveBeenCalled();

    // After debounce — advance timers to trigger resolve, wrapped in act
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESOLVE_DEBOUNCE_MS + 10);
    });

    // Should have resolved only once
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/projects/resolve',
      expect.objectContaining({ method: 'POST' })
    );

    // Advance timers to allow json() promise to settle
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current.intent?.key).toBe('test-proj');
  });

  it('WI-4.2: 202 response triggers polling', async () => {
    const onCreated = vi.fn();

    // First: resolve
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        mode: 'clone',
        key: 'orca',
        name: 'Orca',
        path: '/home/test/orca',
        findings: [],
        isGitRepository: true,
        wouldClone: true,
        wouldGitInit: false,
        willCreateMainWorkspace: false,
        cloneUrl: 'https://github.com/stablyai/orca.git',
        provider: 'github',
        repoSlug: 'stablyai/orca',
        defaultBranch: 'main',
        remoteChecked: true,
        proposedIssuePrefix: 'ORCA',
      }),
    });

    // Second: create project (returns 202 with jobId)
    mockFetch.mockResolvedValueOnce({
      status: 202,
      ok: false,
      json: async () => ({ jobId: 'job-123' }),
    });

    // Third: poll job (running)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'job-123',
        status: 'running',
        phase: 'Receiving objects',
        percent: 50,
      }),
    });

    // Fourth: poll job (done)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'job-123',
        status: 'done',
        result: {
          key: 'orca',
          name: 'Orca',
          path: '/home/test/orca',
          mainWorkspaceId: 'ws-123',
        },
      }),
    });

    const { result } = renderHook(() => useProjectCreateIntent({ onCreated }));

    act(() => {
      result.current.setUrl('stablyai/orca');
      result.current.setMode('clone');
    });

    // Wait for resolve
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESOLVE_DEBOUNCE_MS + 10);
    });

    // Submit WITHOUT awaiting — start async call, advance timers, THEN await
    const submitPromise = result.current.submit();

    // Advance to allow /api/projects POST to resolve
    await vi.advanceTimersByTimeAsync(0);
    expect(mockFetch).toHaveBeenCalledWith('/api/projects', expect.objectContaining({ method: 'POST' }));

    // Advance for first poll (running) at 750ms
    await vi.advanceTimersByTimeAsync(760);
    expect(result.current.progress?.phase).toBe('Receiving objects');
    expect(result.current.progress?.percent).toBe(50);

    // Advance for second poll (done) at 750ms
    await vi.advanceTimersByTimeAsync(760);

    // NOW await the submit promise which has been progressing in the background
    await submitPromise;

    // Advance for final state update
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'orca',
        path: '/home/test/orca',
      })
    );
  });

  it('WI-4.3: 422 response folds findings into intent', async () => {
    // First: resolve succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        mode: 'existing',
        key: 'test-proj',
        name: 'Test Proj',
        path: '/home/test/test-proj',
        findings: [],
        isGitRepository: false,
        wouldClone: false,
        wouldGitInit: false,
        willCreateMainWorkspace: false,
        cloneUrl: null,
        provider: null,
        repoSlug: null,
        defaultBranch: null,
        remoteChecked: false,
        proposedIssuePrefix: null,
      }),
    });

    // Second: create fails with 422 (duplicate)
    mockFetch.mockResolvedValueOnce({
      status: 422,
      ok: false,
      json: async () => ({
        findings: [
          {
            field: 'name',
            code: 'project-exists',
            message: 'Project already exists',
          },
        ],
      }),
    });

    const { result } = renderHook(() => useProjectCreateIntent());

    act(() => {
      result.current.setPath('/home/test/test-proj');
      result.current.setMode('existing');
    });

    // Wait for resolve
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESOLVE_DEBOUNCE_MS + 10);
    });

    // Submit WITHOUT awaiting — start async call, advance timers, THEN await
    const submitPromise = result.current.submit();

    // Allow the async submit to progress
    await vi.advanceTimersByTimeAsync(0);

    // Await the submit promise which has been progressing
    await submitPromise;

    // Advance for final state update
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current.intent?.findings.length).toBeGreaterThan(0);
    expect(result.current.intent?.findings[0].code).toBe('project-exists');
    expect(result.current.error).toContain('already exists');
  });
});

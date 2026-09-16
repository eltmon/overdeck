import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useProjectCreateIntent, RESOLVE_DEBOUNCE_MS } from '../useProjectCreateIntent.js';

// Mock API fetches
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

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

  it.skip('WI-4.1: debounces resolve on rapid field changes', async () => {
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

    // Rapid edits
    result.current.setUrl('https://github.com');
    result.current.setUrl('https://github.com/');
    result.current.setUrl('https://github.com/o');
    result.current.setUrl('https://github.com/o/r');

    // No resolve yet
    expect(mockFetch).not.toHaveBeenCalled();

    // After debounce
    await vi.advanceTimersByTimeAsync(RESOLVE_DEBOUNCE_MS + 10);

    // Should have resolved only once
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/projects/resolve',
      expect.objectContaining({ method: 'POST' })
    );

    await waitFor(() => {
      expect(result.current.intent?.key).toBe('test-proj');
    });
  });

  it.skip('WI-4.2: 202 response triggers polling', async () => {
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

    result.current.setUrl('stablyai/orca');
    result.current.setMode('clone');

    // Wait for resolve
    await vi.advanceTimersByTimeAsync(RESOLVE_DEBOUNCE_MS + 10);
    await waitFor(() => expect(result.current.intent).not.toBeNull());

    // Submit
    await result.current.submit();

    // Should have 202 response
    expect(mockFetch).toHaveBeenCalledWith('/api/projects', expect.objectContaining({ method: 'POST' }));

    // Wait for first poll (running)
    await vi.advanceTimersByTimeAsync(750 + 10);
    await waitFor(() => expect(result.current.progress).not.toBeNull());
    expect(result.current.progress?.phase).toBe('Receiving objects');
    expect(result.current.progress?.percent).toBe(50);

    // Wait for second poll (done)
    await vi.advanceTimersByTimeAsync(750 + 10);
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'orca',
        path: '/home/test/orca',
      })
    );
  });

  it.skip('WI-4.3: 422 response folds findings into intent', async () => {
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

    result.current.setPath('/home/test/test-proj');
    result.current.setMode('existing');

    // Wait for resolve
    await vi.advanceTimersByTimeAsync(RESOLVE_DEBOUNCE_MS + 10);
    await waitFor(() => expect(result.current.intent).not.toBeNull());

    // Submit
    await result.current.submit();

    // Findings should be folded into intent
    await waitFor(() => {
      expect(result.current.intent?.findings.length).toBeGreaterThan(0);
    });
    expect(result.current.intent?.findings[0].code).toBe('project-exists');
    expect(result.current.error).toContain('already exists');
  });
});

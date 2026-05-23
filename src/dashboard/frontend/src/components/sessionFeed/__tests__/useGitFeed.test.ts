import { useQuery } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchGitFeedEntries, mapGitActivityToFeedEntry, useGitFeed, type GitActivityEntry } from '../useGitFeed';

vi.mock('react', () => ({
  useMemo: (factory: () => unknown) => factory(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
}));

const useQueryMock = vi.mocked(useQuery);

function gitEntry(overrides: Partial<GitActivityEntry> = {}): GitActivityEntry {
  return {
    id: 'git-1',
    timestamp: '2026-05-23T01:00:00.000Z',
    source: 'git',
    level: 'info',
    message: 'Committed changes',
    details: null,
    issueId: 'PAN-1389',
    category: 'commit',
    triggeringEvent: null,
    ...overrides,
  };
}

describe('mapGitActivityToFeedEntry', () => {
  it('maps git activity rows to git SessionFeedEntry rows', () => {
    expect(mapGitActivityToFeedEntry(gitEntry())).toEqual({
      kind: 'git',
      id: 'git-1',
      timestamp: '2026-05-23T01:00:00.000Z',
      workspaceId: null,
      issueId: 'PAN-1389',
      source: 'git',
      level: 'info',
      message: 'Committed changes',
      details: null,
      category: 'commit',
      triggeringEvent: null,
    });
  });

  it('sets issueId to null when the git activity row has no issueId', () => {
    expect(mapGitActivityToFeedEntry(gitEntry({ issueId: undefined })).issueId).toBeNull();
  });
});

describe('fetchGitFeedEntries', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns entries from /api/git-activity when the endpoint succeeds', async () => {
    const entries = [gitEntry()];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => entries }));

    await expect(fetchGitFeedEntries()).resolves.toEqual({ entries, error: null });
    expect(fetch).toHaveBeenCalledWith('/api/git-activity');
  });

  it('returns an empty array and an error when the endpoint is non-OK', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    const result = await fetchGitFeedEntries();

    expect(result.entries).toEqual([]);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe('Failed to fetch git activity');
  });
});

describe('useGitFeed', () => {
  it('returns git entries, loading state, and error from the react-query result', () => {
    useQueryMock.mockReturnValue({
      data: { entries: [gitEntry()], error: null },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useQuery>);

    const result = useGitFeed();

    expect(result.entries).toEqual([expect.objectContaining({ kind: 'git', id: 'git-1' })]);
    expect(result.isLoading).toBe(false);
    expect(result.error).toBeNull();
    expect(useQueryMock).toHaveBeenCalledWith(expect.objectContaining({
      queryKey: ['session-feed-git'],
      refetchInterval: 15_000,
      staleTime: 5_000,
    }));
  });

  it('surfaces a fetch error while returning an empty entry array', () => {
    const error = new Error('Failed to fetch git activity');
    useQueryMock.mockReturnValue({
      data: { entries: [], error },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useQuery>);

    expect(useGitFeed()).toEqual({ entries: [], isLoading: false, error });
  });
});

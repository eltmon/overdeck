/**
 * The server adapter's batch doors (PAN-3925).
 *
 * `loadIssueStatesForProject` hands the shared batch door the stale-while-
 * revalidate PR listing, so board reads never wait on a `gh pr list` while a
 * recent listing exists. `loadIssueStatesForIssues` takes ids from any number
 * of projects and makes one batch per project, in parallel.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DerivedIssueState } from '@overdeck/contracts';

const mocks = vi.hoisted(() => ({
  getTrackerIssue: vi.fn(),
  getBackendPanes: vi.fn(),
  libLoad: vi.fn(),
  staleOk: vi.fn(),
}));

vi.mock('../issue-service-singleton.js', () => ({
  getSharedIssueService: () => ({ getTrackerIssue: mocks.getTrackerIssue }),
}));
vi.mock('../backend-inventory.js', () => ({
  getBackendPanes: mocks.getBackendPanes,
}));
vi.mock('../../../../lib/overdeck/derived-issue-state.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/overdeck/derived-issue-state.js')>()),
  loadIssueStatesForProject: mocks.libLoad,
  listRepoPullRequestsStaleOk: mocks.staleOk,
}));

import { loadIssueStatesForIssues, loadIssueStatesForProject } from '../derived-issue-state.js';

const projectOf: Record<string, string> = { PAN: '/repos/overdeck', MIN: '/repos/myn' };
const resolveProject = (issueId: string) => {
  const path = projectOf[issueId.split('-')[0] ?? ''];
  return path ? { projectPath: path } : null;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getBackendPanes.mockResolvedValue([]);
  mocks.getTrackerIssue.mockReturnValue(null);
  mocks.libLoad.mockImplementation(async (_path: string, ids: readonly string[]) =>
    new Map(ids.map((id) => [id, { issueId: id, state: 'backlog' } as DerivedIssueState])));
});

describe('loadIssueStatesForProject (server adapter)', () => {
  it('reads the PR listing stale-while-revalidate unless the caller supplies one', async () => {
    await loadIssueStatesForProject('/repos/overdeck', ['PAN-1']);
    expect(mocks.libLoad.mock.calls[0]?.[2]?.listPullRequests).toBe(mocks.staleOk);

    const own = vi.fn(async () => []);
    await loadIssueStatesForProject('/repos/overdeck', ['PAN-1'], { listPullRequests: own });
    expect(mocks.libLoad.mock.calls[1]?.[2]?.listPullRequests).toBe(own);
  });
});

describe('loadIssueStatesForIssues', () => {
  it('makes one batch per project over deduplicated, upper-cased ids and one inventory read', async () => {
    const states = await loadIssueStatesForIssues(
      ['pan-1', 'PAN-1', 'PAN-2', 'MIN-7', 'ORPHAN-3'],
      { resolveProject },
    );

    expect(mocks.getBackendPanes).toHaveBeenCalledTimes(1);
    expect(mocks.libLoad).toHaveBeenCalledTimes(2);
    const byPath = Object.fromEntries(mocks.libLoad.mock.calls.map(([path, ids]) => [path, ids]));
    expect(byPath).toEqual({ '/repos/overdeck': ['PAN-1', 'PAN-2'], '/repos/myn': ['MIN-7'] });
    expect([...states.keys()].sort()).toEqual(['MIN-7', 'PAN-1', 'PAN-2']);
  });

  it('runs the projects concurrently rather than one after another', async () => {
    const started: string[] = [];
    const release: Array<() => void> = [];
    mocks.libLoad.mockImplementation((path: string, ids: readonly string[]) => {
      started.push(path);
      return new Promise((resolve) => {
        release.push(() => resolve(new Map(ids.map((id) => [id, { issueId: id, state: 'backlog' }]))));
      });
    });

    const pending = loadIssueStatesForIssues(['PAN-1', 'MIN-7'], { resolveProject });
    await vi.waitFor(() => expect(started).toHaveLength(2));
    for (const done of release) done();
    expect((await pending).size).toBe(2);
  });

  it('drops only the failing project and never calls the batch door for no ids', async () => {
    mocks.libLoad.mockImplementation(async (path: string, ids: readonly string[]) => {
      if (path === '/repos/myn') throw new Error('glab unreachable');
      return new Map(ids.map((id) => [id, { issueId: id, state: 'in-review' } as DerivedIssueState]));
    });

    const states = await loadIssueStatesForIssues(['PAN-1', 'MIN-7'], { resolveProject });
    expect([...states.keys()]).toEqual(['PAN-1']);

    mocks.libLoad.mockClear();
    mocks.getBackendPanes.mockClear();
    expect((await loadIssueStatesForIssues(['ORPHAN-3'], { resolveProject })).size).toBe(0);
    expect(mocks.libLoad).not.toHaveBeenCalled();
    expect(mocks.getBackendPanes).not.toHaveBeenCalled();
  });
});

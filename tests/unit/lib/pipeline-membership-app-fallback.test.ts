/**
 * PAN-4264 Work Item 22: a 404 from an App issue listing marks the repo as
 * App-not-installed for 6 hours and lists through the gh user token instead.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAppFallbackIssueListers, type AppFallbackListerDeps } from '../../../src/lib/pipeline-membership-app-fallback.js';
import { APP_NOT_INSTALLED_TTL_MS, readAppMissingRepos, resetRepoNotesForTests } from '../../../src/lib/github-quota/repo-notes.js';

const NOT_INSTALLED = new Error('GitHub API GET /repos/eltmon/krux/issues?state=open failed: 404 {"message":"Not Found"}');

function deps(): AppFallbackListerDeps & {
  listOpenIssuesViaApp: ReturnType<typeof vi.fn>;
  listLabeledIssuesViaApp: ReturnType<typeof vi.fn>;
  ghListIssues: ReturnType<typeof vi.fn>;
} {
  return {
    listOpenIssuesViaApp: vi.fn().mockRejectedValue(NOT_INSTALLED),
    listLabeledIssuesViaApp: vi.fn().mockRejectedValue(NOT_INSTALLED),
    ghListIssues: vi.fn(async (path: string) => path.includes('labels=')
      ? [{ number: 3, state: 'closed', labels: [{ name: 'in-review' }] }]
      : [{ number: 1, labels: [{ name: 'bug' }] }, { number: 2, pull_request: {}, labels: [] }]),
    now: () => Date.now(),
  };
}

describe('App-not-installed fallback (PAN-4264)', () => {
  const originalHome = process.env.OVERDECK_HOME;
  let home: string;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 8, 27, 15, 0));
    home = mkdtempSync(join(tmpdir(), 'pan-app-fallback-'));
    process.env.OVERDECK_HOME = home;
    resetRepoNotesForTests();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('falls back to gh once after a 404, then skips the App for 6 hours, then tries it again', async () => {
    const d = deps();
    const listers = createAppFallbackIssueListers(d);

    await expect(listers.listOpenIssues('eltmon', 'krux')).resolves.toEqual([{ number: 1, labels: ['bug'] }]);
    expect(d.listOpenIssuesViaApp).toHaveBeenCalledTimes(1);
    expect(d.ghListIssues).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(APP_NOT_INSTALLED_TTL_MS - 60_000);
    await listers.listOpenIssues('eltmon', 'krux');
    await listers.listPhaseLabeledIssues('eltmon', 'krux');
    expect(d.listOpenIssuesViaApp).toHaveBeenCalledTimes(1);
    expect(d.listLabeledIssuesViaApp).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    await listers.listOpenIssues('eltmon', 'krux');
    expect(d.listOpenIssuesViaApp).toHaveBeenCalledTimes(2);
  });

  it('lists phase-labeled issues through gh, one listing per label', async () => {
    const d = deps();
    const listers = createAppFallbackIssueListers(d);

    await expect(listers.listPhaseLabeledIssues('eltmon', 'krux'))
      .resolves.toEqual([{ number: 3, state: 'closed', labels: ['in-review'] }]);
    expect(d.ghListIssues.mock.calls.map(([path]) => path)).toContain(
      'repos/eltmon/krux/issues?state=all&per_page=100&labels=in-review',
    );
  });

  it('records the repo for pan doctor and rethrows errors that are not a 404', async () => {
    const d = deps();
    await createAppFallbackIssueListers(d).listOpenIssues('eltmon', 'krux');
    await vi.waitFor(() => expect(readAppMissingRepos().map((r) => r.repo)).toEqual(['eltmon/krux']));

    const other = deps();
    other.listOpenIssuesViaApp.mockRejectedValue(new Error('GitHub API GET /repos/eltmon/overdeck/issues failed: 500 boom'));
    await expect(createAppFallbackIssueListers(other).listOpenIssues('eltmon', 'overdeck')).rejects.toThrow('500 boom');
    expect(other.ghListIssues).not.toHaveBeenCalled();
  });
});

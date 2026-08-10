import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listProjectsSync: vi.fn(),
  invalidated: null as (() => void) | null,
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  listProjectsSync: () => mocks.listProjectsSync(),
}));

vi.mock('../../../../src/lib/projects-cache-events.js', () => ({
  subscribeProjectsConfigInvalidation: (listener: () => void) => {
    mocks.invalidated = listener;
    return () => {};
  },
}));

import { resolveProjectForRepo } from '../../../../src/lib/ci/project-ci-observation.js';

describe('project CI repository lookup cache', () => {
  beforeEach(() => {
    mocks.invalidated?.();
    mocks.listProjectsSync.mockReset();
    mocks.listProjectsSync.mockReturnValue([{
      key: 'overdeck',
      config: {
        name: 'Overdeck',
        path: '/tmp/overdeck',
        github_repo: 'eltmon/overdeck',
      },
    }]);
  });

  it('builds once outside the webhook hot path and refreshes on config invalidation', () => {
    expect(resolveProjectForRepo('eltmon/overdeck')).toMatchObject({ projectKey: 'overdeck' });
    expect(resolveProjectForRepo('eltmon/overdeck')).toMatchObject({ projectKey: 'overdeck' });
    expect(mocks.listProjectsSync).toHaveBeenCalledTimes(1);

    mocks.listProjectsSync.mockReturnValue([{
      key: 'renamed',
      config: {
        name: 'Renamed',
        path: '/tmp/overdeck',
        github_repo: 'eltmon/overdeck',
      },
    }]);
    mocks.invalidated?.();

    expect(resolveProjectForRepo('eltmon/overdeck')).toMatchObject({ projectKey: 'renamed' });
    expect(mocks.listProjectsSync).toHaveBeenCalledTimes(2);
  });
});

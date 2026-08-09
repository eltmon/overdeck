import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProjectConfig } from '../../projects.js';
import {
  createProjectCiFillState,
  fillAllProjectCi,
  fillProjectCiObservation,
  startProjectCiRefill,
} from '../project-ci-fill.js';

type Project = { key: string; config: ProjectConfig };

const project: Project = {
  key: 'overdeck',
  config: {
    name: 'Overdeck',
    path: '/tmp/overdeck',
    github_repo: 'eltmon/overdeck',
    workspace: { default_branch: 'main' },
  },
};

function run(id: number, overrides: Record<string, unknown> = {}) {
  return {
    head_sha: 'sha-current',
    check_suite_id: id,
    status: 'completed',
    conclusion: 'success',
    html_url: `https://github.com/eltmon/overdeck/actions/runs/${id}`,
    updated_at: '2026-08-04T08:10:00.000Z',
    ...overrides,
  };
}

function ghApiWithRuns(pages: unknown[][], heads = ['sha-current', 'sha-current']) {
  let headCall = 0;
  return vi.fn(async (path: string) => {
    if (path === 'repos/eltmon/overdeck/branches/main') {
      const sha = heads[Math.min(headCall, heads.length - 1)]!;
      headCall += 1;
      return { commit: { sha } };
    }
    const page = Number(new URL(`https://example.test/?${path.split('?')[1]}`).searchParams.get('page'));
    return { workflow_runs: pages[page - 1] ?? [] };
  });
}

describe('fillProjectCiObservation', () => {
  it('anchors the projection to the independently-resolved branch head', async () => {
    const ghApi = ghApiWithRuns([[
      run(101),
      run(99, { head_sha: 'sha-old', conclusion: 'failure' }),
    ]]);

    const observation = await fillProjectCiObservation(project, {
      ghApi,
      now: () => '2026-08-04T08:12:00.000Z',
    });

    expect(ghApi).toHaveBeenNthCalledWith(1, 'repos/eltmon/overdeck/branches/main');
    expect(ghApi).toHaveBeenNthCalledWith(
      2,
      'repos/eltmon/overdeck/actions/runs?branch=main&head_sha=sha-current&per_page=100&page=1',
    );
    expect(ghApi).toHaveBeenNthCalledWith(3, 'repos/eltmon/overdeck/branches/main');
    expect(observation).toEqual({
      projectKey: 'overdeck',
      repo: 'eltmon/overdeck',
      branch: 'main',
      headSha: 'sha-current',
      suites: {
        '101': {
          status: 'completed',
          conclusion: 'success',
          htmlUrl: 'https://github.com/eltmon/overdeck/actions/runs/101',
          observedAt: '2026-08-04T08:10:00.000Z',
        },
      },
      observedAt: '2026-08-04T08:12:00.000Z',
    });
  });

  it('paginates until every workflow run for the head has been collected', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => run(index + 1));
    const secondPage = [run(101), run(102)];
    const ghApi = ghApiWithRuns([firstPage, secondPage]);

    const observation = await fillProjectCiObservation(project, { ghApi });

    expect(Object.keys(observation?.suites ?? {})).toHaveLength(102);
    expect(ghApi).toHaveBeenCalledWith(
      'repos/eltmon/overdeck/actions/runs?branch=main&head_sha=sha-current&per_page=100&page=2',
    );
  });

  it('represents a current head with no Actions runs as an empty suite set', async () => {
    const ghApi = ghApiWithRuns([[]]);

    const observation = await fillProjectCiObservation(project, { ghApi });

    expect(observation).toMatchObject({ headSha: 'sha-current', suites: {} });
  });

  it('drops a projection when the branch advances during pagination', async () => {
    const ghApi = ghApiWithRuns([[run(101)]], ['sha-current', 'sha-new']);

    await expect(fillProjectCiObservation(project, { ghApi })).resolves.toBeNull();
  });

  it('returns null when gh api rejects', async () => {
    const ghApi = vi.fn(async () => { throw new Error('not authenticated'); });

    await expect(fillProjectCiObservation(project, { ghApi })).resolves.toBeNull();
  });

  it('returns null without calling gh api when github_repo is unset', async () => {
    const ghApi = ghApiWithRuns([[run(101)]]);
    const projectWithoutRepo: Project = {
      ...project,
      config: { ...project.config, github_repo: undefined },
    };

    await expect(fillProjectCiObservation(projectWithoutRepo, { ghApi })).resolves.toBeNull();
    expect(ghApi).not.toHaveBeenCalled();
  });
});

describe('fillAllProjectCi', () => {
  it('appends one complete head projection per project', async () => {
    const append = vi.fn(async () => true);
    const ghApi = ghApiWithRuns([[run(101), run(102)]]);

    await expect(fillAllProjectCi({ projects: [project], ghApi, append })).resolves.toBe(1);
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      type: 'project.ci_head_observed',
      payload: expect.objectContaining({
        headSha: 'sha-current',
        suites: expect.objectContaining({ '101': expect.any(Object), '102': expect.any(Object) }),
      }),
    }));
  });

  it('emits zero events on a second identical refill', async () => {
    const append = vi.fn(async () => true);
    const state = createProjectCiFillState();
    const now = () => '2026-08-04T08:12:00.000Z';

    await expect(fillAllProjectCi({
      projects: [project],
      ghApi: ghApiWithRuns([[run(101)]]),
      append,
      state,
      now,
    })).resolves.toBe(1);
    await expect(fillAllProjectCi({
      projects: [project],
      ghApi: ghApiWithRuns([[run(101)]]),
      append,
      state,
      now,
    })).resolves.toBe(0);

    expect(append).toHaveBeenCalledTimes(1);
  });

  it('emits a new projection when a suite state changes', async () => {
    const append = vi.fn(async () => true);
    const state = createProjectCiFillState();
    const now = () => '2026-08-04T08:12:00.000Z';

    await fillAllProjectCi({
      projects: [project], ghApi: ghApiWithRuns([[run(101)]]), append, state, now,
    });
    await fillAllProjectCi({
      projects: [project],
      ghApi: ghApiWithRuns([[run(101, { status: 'in_progress', conclusion: null })]]),
      append,
      state,
      now,
    });

    expect(append).toHaveBeenCalledTimes(2);
  });
});

describe('startProjectCiRefill', () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('runs immediately and again after the configured interval', async () => {
    vi.useFakeTimers();
    const fill = vi.fn(async () => 0);
    startProjectCiRefill(15 * 60 * 1000, { fill });

    expect(fill).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(fill).toHaveBeenCalledTimes(2);
  });

  it('contains rejected fills and continues scheduling later ticks', async () => {
    vi.useFakeTimers();
    const fill = vi.fn(async () => { throw new Error('gh unavailable'); });
    const warn = vi.fn();
    startProjectCiRefill(15 * 60 * 1000, { fill, warn });

    await vi.advanceTimersByTimeAsync(0);
    expect(warn).toHaveBeenCalledWith('[overdeck] Project CI fill failed: gh unavailable');
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(fill).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('does not overlap refill sweeps', async () => {
    vi.useFakeTimers();
    let resolveFill!: (value: number) => void;
    const fill = vi.fn(() => new Promise<number>((resolve) => {
      resolveFill = resolve;
    }));
    startProjectCiRefill(15 * 60 * 1000, { fill });

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(fill).toHaveBeenCalledTimes(1);

    resolveFill(0);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(fill).toHaveBeenCalledTimes(2);
  });

  it('unrefs the interval so it does not keep the process alive', () => {
    const unref = vi.fn();
    const setIntervalFn = vi.fn(() => ({ unref }) as unknown as ReturnType<typeof setInterval>);
    const fill = vi.fn(async () => 0);

    startProjectCiRefill(15 * 60 * 1000, {
      fill,
      setIntervalFn: setIntervalFn as unknown as typeof setInterval,
    });

    expect(unref).toHaveBeenCalledTimes(1);
  });
});

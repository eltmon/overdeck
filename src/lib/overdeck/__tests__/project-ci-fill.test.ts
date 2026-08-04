import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProjectConfig } from '../../projects.js';
import {
  fillAllProjectCi,
  fillProjectCiObservations,
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

function runsResponse() {
  return {
    workflow_runs: [
      {
        head_sha: 'sha-new',
        check_suite_id: 101,
        status: 'completed',
        conclusion: 'success',
        html_url: 'https://github.com/eltmon/overdeck/actions/runs/1',
        updated_at: '2026-08-04T08:10:00.000Z',
      },
      {
        head_sha: 'sha-new',
        check_suite_id: 102,
        status: 'in_progress',
        conclusion: null,
        html_url: 'https://github.com/eltmon/overdeck/actions/runs/2',
        updated_at: '2026-08-04T08:11:00.000Z',
      },
      {
        head_sha: 'sha-old',
        check_suite_id: 99,
        status: 'completed',
        conclusion: 'failure',
        html_url: 'https://github.com/eltmon/overdeck/actions/runs/old',
        updated_at: '2026-08-04T07:00:00.000Z',
      },
    ],
  };
}

describe('fillProjectCiObservations', () => {
  it('keeps every run for the newest head SHA', async () => {
    const ghApi = vi.fn(async () => runsResponse());

    const observations = await fillProjectCiObservations(project, { ghApi });

    expect(ghApi).toHaveBeenCalledWith('repos/eltmon/overdeck/actions/runs?branch=main&per_page=20');
    expect(observations).toHaveLength(2);
    expect(observations).toEqual([
      expect.objectContaining({
        headSha: 'sha-new',
        suiteId: '101',
        htmlUrl: 'https://github.com/eltmon/overdeck/actions/runs/1',
        observedAt: '2026-08-04T08:10:00.000Z',
      }),
      expect.objectContaining({
        headSha: 'sha-new',
        suiteId: '102',
        htmlUrl: 'https://github.com/eltmon/overdeck/actions/runs/2',
        observedAt: '2026-08-04T08:11:00.000Z',
      }),
    ]);
  });

  it('returns an empty array when gh api rejects', async () => {
    const ghApi = vi.fn(async () => { throw new Error('not authenticated'); });

    await expect(fillProjectCiObservations(project, { ghApi })).resolves.toEqual([]);
  });

  it('returns an empty array without calling gh api when github_repo is unset', async () => {
    const ghApi = vi.fn(async () => runsResponse());
    const projectWithoutRepo: Project = {
      ...project,
      config: { ...project.config, github_repo: undefined },
    };

    await expect(fillProjectCiObservations(projectWithoutRepo, { ghApi })).resolves.toEqual([]);
    expect(ghApi).not.toHaveBeenCalled();
  });
});

describe('fillAllProjectCi', () => {
  it('appends one domain event per kept run and returns the appended count', async () => {
    const projects: Project[] = [
      project,
      {
        key: 'krux',
        config: {
          name: 'Krux',
          path: '/tmp/krux',
          github_repo: 'eltmon/krux',
        },
      },
    ];
    const ghApi = vi.fn(async () => runsResponse());
    const append = vi.fn(async () => true);

    await expect(fillAllProjectCi({ projects, ghApi, append })).resolves.toBe(4);
    expect(append).toHaveBeenCalledTimes(4);
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      type: 'project.ci_suite_observed',
      payload: expect.objectContaining({ suiteId: '101' }),
    }));
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

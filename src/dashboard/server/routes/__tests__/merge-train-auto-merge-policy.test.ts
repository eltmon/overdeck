/**
 * PAN-3932: GET /api/merge-train/auto-merge resolves each in-flight issue's
 * routing key from its `auto-merge` / `hold-for-uat` tracker label first, then
 * the project default, then the global `require_uat_before_merge`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const labelsByIssue: Record<string, string[]> = {};
const projectDefaultByIssue: Record<string, 'auto' | 'hold' | undefined> = {};
let globalRequireUat = true;

vi.mock('../../../../lib/activity-logger.js', () => ({ emitActivityTts: vi.fn() }));
vi.mock('../../../../lib/cloister/merge-eligibility.js', () => ({
  gatherMergeEligibility: vi.fn(async () => []),
  isMergeEligible: vi.fn(() => false),
}));
vi.mock('../../../../lib/cloister/merge-blockers.js', () => ({ getMergeBlockersPayload: vi.fn(() => []) }));
vi.mock('../../../../lib/overdeck/control-settings.js', () => ({
  isFlywheelAutoPickupBacklog: vi.fn(() => false),
  isFlywheelRequireUatBeforeMerge: vi.fn(() => globalRequireUat),
  isMergeTrainEnabled: vi.fn(() => true),
  setFlywheelAutoPickupBacklog: vi.fn(),
  setFlywheelRequireUatBeforeMerge: vi.fn(),
  setMergeTrainEnabled: vi.fn(),
}));
const projects = vi.hoisted(() => ({
  list: [{ key: 'overdeck', config: { name: 'Overdeck', path: '/repos/overdeck' } }] as Array<{ key: string; config: { name: string; path: string } }>,
}));
vi.mock('../../../../lib/projects.js', () => ({
  getProjectSync: vi.fn(() => null),
  listProjectsSync: vi.fn(() => projects.list),
  resolveProjectFromIssueSync: vi.fn(() => null),
}));
vi.mock('../../../../lib/cloister/auto-merge-policy.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/cloister/auto-merge-policy.js')>()),
  getProjectAutoMergeDefault: vi.fn((issueId: string) => projectDefaultByIssue[issueId]),
}));
vi.mock('../../services/issue-service-singleton.js', () => ({
  getSharedIssueService: () => ({
    getTrackerIssue: (issueId: string) =>
      labelsByIssue[issueId] ? { open: true, labels: labelsByIssue[issueId] } : null,
  }),
}));
vi.mock('../../services/derived-issue-state.js', () => ({
  getDerivedIssueState: vi.fn(),
  listReadyIssuesForProject: vi.fn(async () => []),
  listRepoPullRequestsStaleOk: vi.fn(async () => [
    { headRefName: 'feature/pan-1' },
    { headRefName: 'feature/pan-2' },
    { headRefName: 'feature/pan-3' },
    { headRefName: 'feature/pan-4' },
  ]),
  issueIdFromBranch: (branch: string) => branch.replace('feature/', '').toUpperCase(),
  loadIssueStatesForProject: vi.fn(async (_path: string, ids: string[]) =>
    new Map(ids.map((id) => [id, { issueId: id, state: 'in-review' }]))),
}));

const { getAutoMergePolicyPayload } = await import('../merge-train.js');
const derivedStateModule = await import('../../services/derived-issue-state.js');

describe('GET /api/merge-train/auto-merge (PAN-3932)', () => {
  beforeEach(() => {
    for (const key of Object.keys(labelsByIssue)) delete labelsByIssue[key];
    for (const key of Object.keys(projectDefaultByIssue)) delete projectDefaultByIssue[key];
    globalRequireUat = true;
    projects.list = [{ key: 'overdeck', config: { name: 'Overdeck', path: '/repos/overdeck' } }];
  });

  it('derives the projects concurrently and skips only a failing one (PAN-3925)', async () => {
    projects.list = [
      { key: 'overdeck', config: { name: 'Overdeck', path: '/repos/overdeck' } },
      { key: 'myn', config: { name: 'MYN', path: '/repos/myn' } },
      { key: 'broken', config: { name: 'Broken', path: '/repos/broken' } },
    ];
    projectDefaultByIssue['PAN-1'] = 'auto';
    const started: string[] = [];
    const release: Array<() => void> = [];
    const load = vi.mocked(derivedStateModule.loadIssueStatesForProject);
    load.mockImplementation((path: string) => {
      started.push(path);
      if (path === '/repos/broken') return Promise.reject(new Error('gh unreachable'));
      const id = path === '/repos/overdeck' ? 'PAN-1' : 'MIN-1';
      return new Promise((resolve) => {
        release.push(() => resolve(new Map([[id, { issueId: id, state: 'in-review' }]]) as never));
      });
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const pending = getAutoMergePolicyPayload();
    await vi.waitFor(() => expect(started).toHaveLength(3));
    for (const done of release) done();
    const { issues } = await pending;

    expect(Object.fromEntries(issues.map((entry) => [entry.issueId, entry.autoMerge]))).toEqual({
      'PAN-1': true,
      'MIN-1': false,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    load.mockImplementation(async (_path: string, ids: string[]) =>
      new Map(ids.map((id) => [id, { issueId: id, state: 'in-review' }])) as never);
  });

  it('lets the issue label beat the project default and the global setting', async () => {
    labelsByIssue['PAN-1'] = ['auto-merge'];
    projectDefaultByIssue['PAN-1'] = 'hold';
    labelsByIssue['PAN-2'] = ['hold-for-uat'];
    projectDefaultByIssue['PAN-2'] = 'auto';
    projectDefaultByIssue['PAN-3'] = 'auto';
    // PAN-4: no label, no project default -> global require-UAT holds it.

    const { issues } = await getAutoMergePolicyPayload();

    expect(Object.fromEntries(issues.map((entry) => [entry.issueId, entry.autoMerge]))).toEqual({
      'PAN-1': true,
      'PAN-2': false,
      'PAN-3': true,
      'PAN-4': false,
    });
  });
});

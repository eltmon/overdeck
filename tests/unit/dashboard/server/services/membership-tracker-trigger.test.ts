/**
 * PAN-5224 FR-5: seedTrackerIssues/noteTrackerIssues diff per identifier
 * (never by array index), enqueue each changed project at most once, and
 * never throw.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveProjectFromIssueSync: vi.fn(),
  listProjectsSync: vi.fn(),
  enqueueProjectsResourceRefresh: vi.fn(),
}));

vi.mock('../../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
  listProjectsSync: mocks.listProjectsSync,
}));

vi.mock('../../../../../src/dashboard/server/services/project-resource-refresh-queue.js', () => ({
  enqueueProjectsResourceRefresh: mocks.enqueueProjectsResourceRefresh,
}));

import {
  noteTrackerIssues,
  resetMembershipTrackerTriggerForTests,
  seedTrackerIssues,
} from '../../../../../src/dashboard/server/services/membership-tracker-trigger.js';

const PAN_PROJECT = { name: 'overdeck', path: '/repos/overdeck' };
const MIN_PROJECT = { name: 'myn', path: '/repos/myn' };

beforeEach(() => {
  vi.resetAllMocks();
  resetMembershipTrackerTriggerForTests();
  mocks.listProjectsSync.mockReturnValue([
    { key: 'overdeck', config: PAN_PROJECT },
    { key: 'myn', config: MIN_PROJECT },
  ]);
  mocks.resolveProjectFromIssueSync.mockImplementation((identifier: string) =>
    identifier.startsWith('PAN-') ? { projectKey: 'overdeck' } : { projectKey: 'myn' });
});

describe('membership tracker trigger (PAN-5224)', () => {
  it('a label change on a seeded issue enqueues its project once (ac1)', () => {
    seedTrackerIssues([{ identifier: 'PAN-7', state: 'open', labels: ['a'] }]);

    noteTrackerIssues([{ identifier: 'PAN-7', state: 'open', labels: ['a', 'b'] }]);

    expect(mocks.enqueueProjectsResourceRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueProjectsResourceRefresh).toHaveBeenCalledWith([PAN_PROJECT], 'tracker:issues-changed');
  });

  it('an issue dropped from the tracker rows enqueues its project (ac2)', () => {
    seedTrackerIssues([{ identifier: 'PAN-7', state: 'open', labels: [] }]);

    noteTrackerIssues([]);

    expect(mocks.enqueueProjectsResourceRefresh).toHaveBeenCalledWith([PAN_PROJECT], 'tracker:issues-changed');
  });

  it('a title-only change, or a reordered array, enqueues nothing (ac3)', () => {
    seedTrackerIssues([
      { identifier: 'PAN-7', title: 'before', state: 'open', labels: ['a'] },
      { identifier: 'PAN-8', title: 'other', state: 'open', labels: [] },
    ]);

    noteTrackerIssues([
      { identifier: 'PAN-8', title: 'other', state: 'open', labels: [] },
      { identifier: 'PAN-7', title: 'after', state: 'open', labels: ['a'] },
    ]);

    expect(mocks.enqueueProjectsResourceRefresh).not.toHaveBeenCalled();
  });

  it('two changed issues in one project enqueue it once; label order does not count as a change', () => {
    seedTrackerIssues([
      { identifier: 'PAN-7', state: 'open', labels: ['a', 'b'] },
      { identifier: 'PAN-8', state: 'open', labels: [] },
    ]);

    noteTrackerIssues([
      { identifier: 'PAN-7', state: 'closed', labels: ['b', 'a'] },
      { identifier: 'PAN-8', state: 'in_review', labels: [] },
    ]);

    expect(mocks.enqueueProjectsResourceRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueProjectsResourceRefresh).toHaveBeenCalledWith([PAN_PROJECT], 'tracker:issues-changed');
  });

  it('noteTrackerIssues with no prior seed seeds only and enqueues nothing (ac4)', () => {
    noteTrackerIssues([{ identifier: 'PAN-7', state: 'open', labels: [] }]);

    expect(mocks.enqueueProjectsResourceRefresh).not.toHaveBeenCalled();

    noteTrackerIssues([{ identifier: 'PAN-7', state: 'closed', labels: [] }]);

    expect(mocks.enqueueProjectsResourceRefresh).toHaveBeenCalledTimes(1);
  });

  it('new issues not previously in the baseline enqueue their project', () => {
    seedTrackerIssues([{ identifier: 'PAN-7', state: 'open', labels: [] }]);

    noteTrackerIssues([
      { identifier: 'PAN-7', state: 'open', labels: [] },
      { identifier: 'MIN-1', state: 'open', labels: [] },
    ]);

    expect(mocks.enqueueProjectsResourceRefresh).toHaveBeenCalledWith([MIN_PROJECT], 'tracker:issues-changed');
  });

  it('never throws when resolveProjectFromIssueSync throws', () => {
    seedTrackerIssues([{ identifier: 'PAN-7', state: 'open', labels: [] }]);
    mocks.resolveProjectFromIssueSync.mockImplementation(() => {
      throw new Error('boom');
    });

    expect(() => noteTrackerIssues([{ identifier: 'PAN-7', state: 'closed', labels: [] }])).not.toThrow();
  });

  it('never throws on malformed issue rows', () => {
    expect(() => seedTrackerIssues([null, 42, { identifier: 7 }, { identifier: 'PAN-9' }])).not.toThrow();
    expect(() => noteTrackerIssues([undefined, 'not-an-issue'])).not.toThrow();
  });
});

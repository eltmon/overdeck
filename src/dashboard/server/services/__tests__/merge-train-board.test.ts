import { describe, expect, it } from 'vitest';

import { getMergeTrainBoard, type BoardDeps, type OpenPr } from '../merge-train-board.js';
import type { PrFacts } from '../../../../lib/cloister/pr-facts.js';
import type { PendingAutoMerge } from '../../../../lib/overdeck/merge-types.js';
import type { ProjectConfig } from '../../../../lib/projects.js';
import type { MergeRun } from '../merge-queue-service.js';
import type { UatGenerationPayload } from '../uat-train.js';

const NOW = Date.parse('2026-11-14T12:00:00.000Z');

const AUTO: ProjectConfig = { name: 'overdeck', path: '/repos/overdeck', github_repo: 'eltmon/overdeck' } as ProjectConfig;
const HOLD: ProjectConfig = { name: 'myn', path: '/repos/myn', github_repo: 'eltmon/myn', auto_merge_default: 'hold' } as ProjectConfig;

function facts(issueId: string, overrides: Partial<PrFacts> = {}): PrFacts {
  return {
    issueId, forge: 'github', url: `https://github.com/eltmon/overdeck/pull/${issueId.split('-')[1]}`,
    number: Number(issueId.split('-')[1]), exists: true, open: true, merged: false, closed: false, draft: false,
    headSha: `head-${issueId}`, headBranch: `feature/${issueId.toLowerCase()}`, reviewDecision: 'APPROVED',
    approved: true, approvedAtHead: true, changesRequested: false, mergeable: true, mergeableState: 'mergeable',
    checks: 'green', testChecks: 'green', ...overrides,
  };
}

function open(issueId: string, overrides: Partial<OpenPr> = {}): OpenPr {
  return {
    issueId, kind: 'feature', branch: `feature/${issueId.toLowerCase()}`, number: Number(issueId.split('-')[1]),
    url: `https://github.com/eltmon/overdeck/pull/${issueId.split('-')[1]}`, title: `Title ${issueId}`,
    headSha: `head-${issueId}`, draft: false, reviewDecided: true, readySince: NOW - 60_000, ...overrides,
  };
}

function row(issueId: string, status: PendingAutoMerge['status'], overrides: Partial<PendingAutoMerge> = {}): PendingAutoMerge {
  return {
    id: 7, issueId, prUrl: `https://github.com/eltmon/overdeck/pull/${issueId.split('-')[1]}`, projectKey: 'overdeck',
    forge: 'github', status, scheduledAt: '2026-11-14T11:58:00.000Z', scheduledMergeAt: '2026-11-14T12:03:00.000Z',
    ...overrides,
  };
}

function batch(name: string, status: UatGenerationPayload['status'], members: string[]): UatGenerationPayload {
  return {
    name, status, baseSha: 'b', createdAt: '', updatedAt: '', heldOut: [], resolutions: [],
    members: members.map((issueId, i) => ({ issueId, title: issueId, branch: `feature/${issueId.toLowerCase()}`, mergeOrder: i + 1, acceptanceCriteria: [] })),
    versionSyncConfigured: false, shipStatus: null, statusReason: null, repos: [],
    stack: { status: 'absent', frontendUrl: '' },
  };
}

interface Fixture {
  projects?: Array<{ key: string; config: ProjectConfig }>;
  open?: OpenPr[];
  facts?: Record<string, PrFacts>;
  rows?: Record<string, PendingAutoMerge>;
  runs?: MergeRun[];
  labels?: Record<string, string[]>;
  batches?: UatGenerationPayload[];
  trainOn?: boolean;
  master?: boolean;
  dropped?: string[];
  listingThrowsFor?: string;
  trackerType?: 'github' | 'linear';
  threads?: Record<number, number>;
  skips?: Array<{ issueId: string; projectKey: string; reason: string; scope?: 'project' }>;
  verdicts?: string[];
}

function deps(f: Fixture): BoardDeps {
  return {
    listProjects: () => f.projects ?? [{ key: 'overdeck', config: AUTO }],
    masterEnabled: () => f.master ?? true,
    projectEnabled: () => f.trainOn ?? true,
    requireUat: () => false,
    forgeOf: () => 'github',
    listing: async (projectPath) => {
      if (f.listingThrowsFor && projectPath.endsWith(f.listingThrowsFor)) throw new Error('gh: bad credentials');
      return { open: projectPath.endsWith('overdeck') ? (f.open ?? []) : [], merged: [] };
    },
    unresolvedThreads: async () => new Map(Object.entries(f.threads ?? {}).map(([k, v]) => [Number(k), v])),
    approvalAtHead: () => undefined,
    facts: async (issueId) => f.facts?.[issueId] ?? null,
    latestAutoMerge: (issueId) => f.rows?.[issueId] ?? null,
    autoMergeRows: () => Object.values(f.rows ?? {}),
    notScheduled: () => f.skips ?? [],
    mergeRuns: () => f.runs ?? [],
    issueLabels: (issueId) => f.labels?.[issueId] ?? [],
    issueTitle: () => null,
    projectKeyOfIssue: () => 'overdeck',
    journal: (issueId) => ((f.verdicts ?? []).includes(issueId)
      ? [{ at: '2026-11-14T11:00:00.000Z', type: 'review.verdict', issueId, data: { verdict: 'APPROVED' } }]
      : []),
    generations: async () => f.batches ?? [],
    promoted: () => [],
    droppedFromBatch: (issueId) => (f.dropped ?? []).includes(issueId),
    lacksBatchCi: () => false,
    trackerType: () => f.trackerType ?? 'github',
    batchSize: () => 3,
    batchWaitMinutes: () => 30,
    now: () => NOW,
  };
}

async function onlyCar(f: Fixture) {
  const board = await getMergeTrainBoard({}, deps(f));
  expect(board.projects[0]!.cars).toHaveLength(1);
  return board.projects[0]!.cars[0]!;
}

describe('getMergeTrainBoard cars (PAN-4753 WI-7)', () => {
  it('merging: a live merge run wins, with its step', async () => {
    const car = await onlyCar({
      open: [open('PAN-1')], facts: { 'PAN-1': facts('PAN-1', { checks: 'red' }) },
      runs: [{ issueId: 'PAN-1', phase: 'merging', step: 'rebasing', updatedAt: '' }],
    });
    expect(car).toMatchObject({ state: 'merging', step: 'rebasing' });
  });

  it('failed: a failed row at the current head carries its reason', async () => {
    const car = await onlyCar({
      open: [open('PAN-1')], facts: { 'PAN-1': facts('PAN-1') },
      rows: { 'PAN-1': row('PAN-1', 'failed', { headSha: 'head-PAN-1', failureReason: 'rebase conflict' }) },
    });
    expect(car).toMatchObject({ state: 'failed', notes: 'rebase conflict' });
  });

  it('blocked: forge blockers, including unresolved threads, with failing check names', async () => {
    const car = await onlyCar({
      open: [open('PAN-1')],
      facts: { 'PAN-1': facts('PAN-1', { checks: 'red', checkFailures: [{ name: 'test (22)', conclusion: 'FAILURE' }] }) },
      threads: { 1: 2 },
    });
    expect(car.state).toBe('blocked');
    expect(car.blockers.map((b) => b.type)).toEqual(['failing_checks', 'unresolved_conversations']);
    expect(car.blockers[0]!.details).toBe('failing: test (22)');
  });

  it('cooldown: a pending row gives mergeAt and the row id', async () => {
    const car = await onlyCar({
      trainOn: false, open: [open('PAN-1')], facts: { 'PAN-1': facts('PAN-1') }, rows: { 'PAN-1': row('PAN-1', 'pending') },
    });
    expect(car).toMatchObject({ state: 'cooldown', mergeAt: '2026-11-14T12:03:00.000Z', autoMergeRowId: 7, route: 'auto-merge' });
  });

  it('held: a ready, batch-routed feature not in a live batch', async () => {
    const car = await onlyCar({ open: [open('PAN-1')], facts: { 'PAN-1': facts('PAN-1') } });
    expect(car).toMatchObject({ state: 'held', route: 'batch', effectivePolicy: 'auto', policy: null });
  });

  it('ready: a per-PR feature not yet scheduled', async () => {
    const car = await onlyCar({ trainOn: false, open: [open('PAN-1')], facts: { 'PAN-1': facts('PAN-1') } });
    expect(car).toMatchObject({ state: 'ready', route: 'auto-merge', readyAt: new Date(NOW - 60_000).toISOString() });
  });

  it('a live-batch member carries liveBatch and is not held', async () => {
    const car = await onlyCar({
      open: [open('PAN-1')], facts: { 'PAN-1': facts('PAN-1') },
      batches: [batch('uat/pan-train-otter-1114-1', 'ready', ['PAN-1'])],
    });
    expect(car).toMatchObject({ state: 'ready', liveBatch: 'uat/pan-train-otter-1114-1' });
  });

  it('routes per R1: hold label batches, critical and dropped go per-PR, train off goes per-PR', async () => {
    const board = await getMergeTrainBoard({}, deps({
      open: ['PAN-1', 'PAN-2', 'PAN-3'].map((id) => open(id)),
      facts: Object.fromEntries(['PAN-1', 'PAN-2', 'PAN-3'].map((id) => [id, facts(id)])),
      labels: { 'PAN-1': ['hold-for-uat', 'critical'], 'PAN-2': ['critical'], 'PAN-3': ['auto-merge'] },
      dropped: ['PAN-3'],
    }));
    const byId = Object.fromEntries(board.projects[0]!.cars.map((c) => [c.issueId, c]));
    expect(byId['PAN-1']).toMatchObject({ route: 'batch', policy: 'hold', effectivePolicy: 'hold' });
    expect(byId['PAN-2']).toMatchObject({ route: 'auto-merge', policy: null });
    expect(byId['PAN-3']).toMatchObject({ route: 'auto-merge', policy: 'auto' });
  });

  it('policyWritable is false for a non-GitHub tracker, and for GitHub until the WI-8 route ships', async () => {
    const linear = await onlyCar({ trackerType: 'linear', open: [open('PAN-1')], facts: { 'PAN-1': facts('PAN-1') } });
    expect(linear.policyWritable).toBe(false);
    const github = await onlyCar({ trackerType: 'github', open: [open('PAN-1')], facts: { 'PAN-1': facts('PAN-1') } });
    expect(github.policyWritable).toBe(false);
  });

  it('finds a marker-approved PR the forge shows no decision for, through its journaled verdict', async () => {
    const pr = open('PAN-1', { reviewDecided: false });
    const none = await getMergeTrainBoard({}, deps({ open: [pr], facts: { 'PAN-1': facts('PAN-1', { checks: 'red' }) } }));
    expect(none.projects[0]!.cars).toEqual([]);
    const car = await onlyCar({ open: [pr], facts: { 'PAN-1': facts('PAN-1', { checks: 'red' }) }, verdicts: ['PAN-1'] });
    expect(car.state).toBe('blocked');
  });

  it('carries the scheduler skip reason on a ready car, and a project-wide skip as a notice', async () => {
    const board = await getMergeTrainBoard({}, deps({
      trainOn: false,
      open: [open('PAN-1', { reviewDecided: false })],
      facts: { 'PAN-1': facts('PAN-1') },
      skips: [
        { issueId: 'PAN-1', projectKey: 'overdeck', reason: 'the Deft human-merge hold applies' },
        { issueId: 'overdeck', projectKey: 'overdeck', reason: 'the PR listing could not be read', scope: 'project' },
        { issueId: 'MIN-1', projectKey: 'myn', reason: 'elsewhere' },
      ],
    }));
    expect(board.projects[0]!.cars[0]).toMatchObject({ issueId: 'PAN-1', state: 'ready', notes: 'Not scheduled: the Deft human-merge hold applies' });
    expect(board.projects[0]!.notices).toEqual(['Not scheduled: the PR listing could not be read']);
  });

  it('skips an open PR nobody approved, and a merged PR', async () => {
    const board = await getMergeTrainBoard({}, deps({
      open: [open('PAN-1'), open('PAN-2')],
      facts: { 'PAN-1': facts('PAN-1', { approved: false, approvedAtHead: undefined }), 'PAN-2': facts('PAN-2', { merged: true, open: false }) },
    }));
    expect(board.projects[0]!.cars).toEqual([]);
  });

  it('reports the batch window: waiting count and when the next batch assembles', async () => {
    const board = await getMergeTrainBoard({}, deps({ open: [open('PAN-1')], facts: { 'PAN-1': facts('PAN-1') } }));
    expect(board.projects[0]!.window).toEqual({
      size: 3, waitMinutes: 30, waiting: 1, nextBatchAt: new Date(NOW - 60_000 + 30 * 60_000).toISOString(),
    });
  });
});

describe('getMergeTrainBoard strikes', () => {
  const strike = (id: string) => open(id, { kind: 'strike', branch: `strike/${id.toLowerCase()}` });

  it('flagged carries the reviewer summary; waiting-uat in a hold project; ready when approved', async () => {
    const d = deps({
      projects: [{ key: 'overdeck', config: AUTO }],
      open: [strike('PAN-5'), strike('PAN-6'), strike('PAN-7'), strike('PAN-8')],
      facts: {
        'PAN-5': facts('PAN-5', { changesRequested: true, approved: false }),
        'PAN-6': facts('PAN-6', { checks: 'pending' }),
        'PAN-7': facts('PAN-7', { approvedAtHead: undefined, approved: false }),
        'PAN-8': facts('PAN-8'),
      },
      labels: { 'PAN-8': ['hold-for-uat'] },
    });
    d.journal = (issueId) => (issueId === 'PAN-5'
      ? [{ at: '', type: 'review.verdict', issueId, data: { verdict: 'CHANGES_REQUESTED', summary: 'drops the health probe' } }]
      : []);
    const board = await getMergeTrainBoard({}, d);
    const byId = Object.fromEntries(board.projects[0]!.strikes.map((s) => [s.issueId, s]));
    expect(byId['PAN-5']).toMatchObject({ state: 'flagged', reviewSummary: 'drops the health probe' });
    expect(byId['PAN-6']!.state).toBe('checks-pending');
    expect(byId['PAN-7']!.state).toBe('reviewing');
    expect(byId['PAN-8']).toMatchObject({ state: 'waiting-uat', route: 'batch' });
  });

  it('an approved strike in an auto project is ready on the auto-merge route', async () => {
    const board = await getMergeTrainBoard({}, deps({ open: [strike('PAN-9')], facts: { 'PAN-9': facts('PAN-9') } }));
    expect(board.projects[0]!.strikes[0]).toMatchObject({ state: 'ready', route: 'auto-merge' });
  });
});

describe('getMergeTrainBoard projects', () => {
  it('one failing project yields an error card while the others render (NFR-7)', async () => {
    const board = await getMergeTrainBoard({}, deps({
      projects: [{ key: 'overdeck', config: AUTO }, { key: 'myn', config: HOLD }],
      listingThrowsFor: 'myn',
    }));
    expect(board.projects.map((p) => [p.projectKey, p.error ?? null])).toEqual([
      ['overdeck', null],
      ['myn', 'gh: bad credentials'],
    ]);
    expect(board.projects[1]).toMatchObject({ mode: 'hold', cars: [], strikes: [], batches: [], recent: [] });
  });

  it('filters to one project and reports mode, override and master flag', async () => {
    const board = await getMergeTrainBoard({ projectKey: 'myn' }, deps({
      master: false,
      projects: [{ key: 'overdeck', config: AUTO }, { key: 'myn', config: { ...HOLD, merge_train: 'disabled' } as ProjectConfig }],
    }));
    expect(board.masterEnabled).toBe(false);
    expect(board.projects).toHaveLength(1);
    expect(board.projects[0]).toMatchObject({
      projectKey: 'myn', mode: 'hold', override: 'disabled', enabled: false, window: null, repo: 'eltmon/myn', cooldownMinutes: 5,
    });
  });
});

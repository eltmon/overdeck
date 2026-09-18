/**
 * PAN-3903 regression: `checkOrphanedCompletions` must not act on an issue
 * whose transition another actor already owns.
 *
 * The real incident (deacon.log, 2026-09-18). PAN-3842's review passed at
 * commit ff31b427; the work agent then pushed more commits, so the
 * post-review-commit patrol marked the row stale at 07:30 —
 * `reviewStaleSince` set, `readyForMerge` false, "no automatic re-dispatch"
 * by design (PAN-3847: only `pan done` or `pan review request` clears it).
 * That row satisfied every condition this patrol checked: review pending,
 * not merged, no unserviced `reviewRequestedAt`, plan complete, PR open. So
 * it "recovered" the issue nine times between 07:36 and 08:17, each time
 * writing a fresh review request on top of the work agent's own re-review.
 *
 * The row is legitimate; the patrol's read simply could not tell that the
 * work agent owned the next transition. These tests lock the owner check.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewStatus } from '../../../../src/lib/review-status-reconcile.js';

const mocks = vi.hoisted(() => ({
  statuses: {} as Record<string, ReviewStatus>,
  setReviewStatusSync: vi.fn(),
  updateIssueRecord: vi.fn(async () => {}),
  readIssueRecordSync: vi.fn(() => ({ pipeline: {} })),
  findWorkspacePath: vi.fn(() => '/project/workspaces/feature-pan-3842'),
  readWorkspacePlanSync: vi.fn(() => ({ plan: { items: [{ status: 'completed' }] } })),
  execStdout: vi.fn((_command: string) => 'https://github.com/eltmon/overdeck/pull/3842\n'),
  logDeaconEventSync: vi.fn(),
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  loadReviewStatuses: () => mocks.statuses,
  getReviewStatusSync: (issueId: string) => mocks.statuses[issueId] ?? null,
  getReviewStatusesSync: (issueIds: string[]) => Object.fromEntries(
    issueIds.map((id) => [id, mocks.statuses[id]]).filter(([, value]) => Boolean(value)),
  ),
  setReviewStatusSync: mocks.setReviewStatusSync,
}));

vi.mock('../../../../src/lib/projects.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/projects.js')>()),
  resolveProjectFromIssueSync: () => ({ projectKey: 'overdeck', projectPath: '/project' }),
  getProjectSync: () => ({ key: 'overdeck', path: '/project', name: 'overdeck' }),
}));

vi.mock('../../../../src/lib/pan-dir/record.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/pan-dir/record.js')>()),
  readIssueRecordSync: mocks.readIssueRecordSync,
}));

vi.mock('../../../../src/lib/pan-dir/record-update.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/pan-dir/record-update.js')>()),
  updateIssueRecord: mocks.updateIssueRecord,
}));

vi.mock('../../../../src/lib/lifecycle/archive-planning.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/lifecycle/archive-planning.js')>()),
  findWorkspacePath: mocks.findWorkspacePath,
}));

vi.mock('../../../../src/lib/xbrief/io.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/xbrief/io.js')>()),
  readWorkspacePlanSync: mocks.readWorkspacePlanSync,
}));

// deacon.ts builds its own `promisify(exec)`, so intercept at the
// child_process boundary. promisify honours the `util.promisify.custom`
// symbol, which is how the real `exec` resolves to `{ stdout, stderr }`
// rather than a bare string — the mock must carry it too.
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const { promisify } = await import('node:util');
  const exec = Object.assign(
    (command: string, ...rest: unknown[]) => {
      const callback = rest.find((arg): arg is (...args: unknown[]) => void => typeof arg === 'function');
      callback?.(null, mocks.execStdout(command), '');
      return undefined as never;
    },
    {
      [promisify.custom]: async (command: string) => ({ stdout: mocks.execStdout(command), stderr: '' }),
    },
  );
  return { ...actual, exec };
});

vi.mock('fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('fs')>()),
  existsSync: () => true,
}));

vi.mock('../../../../src/lib/persistent-logger.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/persistent-logger.js')>()),
  logDeaconEventSync: mocks.logDeaconEventSync,
}));

import { checkOrphanedCompletions } from '../../../../src/lib/cloister/deacon.js';

const ISSUE_ID = 'PAN-3842';
const REVIEWED_AT = 'ff31b427ad3c4e5f6a7b8c9d0e1f2a3b4c5d6e7f';
const STALE_SINCE = '2026-09-18T07:30:12.785Z';

function row(overrides: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId: ISSUE_ID,
    reviewStatus: 'pending',
    testStatus: 'passed',
    readyForMerge: false,
    updatedAt: '2026-09-18T07:35:00.000Z',
    prUrl: 'https://github.com/eltmon/overdeck/pull/3842',
    ...overrides,
  } as ReviewStatus;
}

describe('checkOrphanedCompletions in-flight owner (PAN-3903 / PAN-3842)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-18T07:36:06.116Z'));
    vi.clearAllMocks();
    mocks.statuses = {};
    mocks.readIssueRecordSync.mockReturnValue({ pipeline: {} } as never);
    mocks.readWorkspacePlanSync.mockReturnValue({ plan: { items: [{ status: 'completed' }] } } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('acts on a genuinely orphaned completion (the control)', async () => {
    mocks.statuses = { [ISSUE_ID]: row() };

    const actions = await checkOrphanedCompletions();

    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain(ISSUE_ID);
    expect(mocks.setReviewStatusSync).toHaveBeenCalledWith(ISSUE_ID, expect.objectContaining({
      reviewRequestedAt: expect.any(String),
    }));
  });

  // The nine 07:36–08:17 fires.
  it('takes no action while a stale review leaves the work agent mid-rework', async () => {
    mocks.statuses = {
      [ISSUE_ID]: row({ reviewStaleSince: STALE_SINCE, reviewedAtCommit: REVIEWED_AT }),
    };

    const actions = await checkOrphanedCompletions();

    expect(actions).toEqual([]);
    expect(mocks.setReviewStatusSync).not.toHaveBeenCalled();
    expect(mocks.updateIssueRecord).not.toHaveBeenCalled();
    expect(mocks.logDeaconEventSync).not.toHaveBeenCalled();
  });

  it('never reaches the PR probe for an owned issue', async () => {
    mocks.statuses = { [ISSUE_ID]: row({ reviewStaleSince: STALE_SINCE }) };

    await checkOrphanedCompletions();

    expect(mocks.readWorkspacePlanSync).not.toHaveBeenCalled();
  });

  it('stays silent across a whole patrol interval of repeated passes', async () => {
    mocks.statuses = { [ISSUE_ID]: row({ reviewStaleSince: STALE_SINCE }) };

    const passes: string[][] = [];
    for (let pass = 0; pass < 9; pass += 1) {
      passes.push(await checkOrphanedCompletions());
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    }

    expect(passes.flat()).toEqual([]);
    expect(mocks.setReviewStatusSync).not.toHaveBeenCalled();
  });

  // The brief's shape: the row moves pending -> reviewing -> passed inside one
  // patrol interval. The patrol must stay out of the way at every step.
  it('takes no action as review flips pending -> reviewing -> passed in one interval', async () => {
    const sequence: Array<Partial<ReviewStatus>> = [
      { reviewStatus: 'pending', reviewRequestedAt: '2026-09-18T07:36:00.000Z' },
      { reviewStatus: 'reviewing', reviewSpawnedAt: '2026-09-18T07:38:00.000Z' },
      { reviewStatus: 'passed', reviewedAtCommit: REVIEWED_AT, readyForMerge: true },
    ];

    for (const step of sequence) {
      mocks.statuses = { [ISSUE_ID]: row(step) };
      expect(await checkOrphanedCompletions()).toEqual([]);
      await vi.advanceTimersByTimeAsync(60 * 1000);
    }

    expect(mocks.setReviewStatusSync).not.toHaveBeenCalled();
    expect(mocks.updateIssueRecord).not.toHaveBeenCalled();
  });

  it.each([
    ['a dispatched review convoy', { reviewSpawnedAt: '2026-09-18T07:20:00.000Z' }],
    ['a claimed merge', { mergeStatus: 'merging' as const }],
    ['a running verification', { verificationStatus: 'running' as const }],
    ['a failed verdict routed to the work agent', { verificationStatus: 'failed' as const }],
  ])('takes no action for %s', async (_label, overrides) => {
    mocks.statuses = { [ISSUE_ID]: row(overrides) };

    expect(await checkOrphanedCompletions()).toEqual([]);
    expect(mocks.setReviewStatusSync).not.toHaveBeenCalled();
  });
});

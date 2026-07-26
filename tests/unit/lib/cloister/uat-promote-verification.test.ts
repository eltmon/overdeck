import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReviewStatus } from '../../../../src/lib/review-status.js';
import type { UatGeneration, UatGenerationMember } from '../../../../src/lib/overdeck/merge-types.js';

const mocks = vi.hoisted(() => ({
  getReviewStatusSync: vi.fn(),
  setReviewStatusSync: vi.fn(),
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: mocks.getReviewStatusSync,
  setReviewStatusSync: mocks.setReviewStatusSync,
}));

import {
  buildUatPromotionStamp,
  healUatPromotionVerification,
  recordUatPromotionVerdicts,
  type UatPromotionHealDeps,
} from '../../../../src/lib/cloister/uat-promote-verification.js';

const MEMBER: UatGenerationMember = {
  issueId: 'PAN-1',
  title: 'First',
  branch: 'feature/pan-1',
  headSha: 'a'.repeat(40),
  mergeOrder: 1,
};

function generation(members: UatGenerationMember[]): UatGeneration {
  return {
    name: 'uat/pan-cedar-0726',
    worktreePath: '/project/workspaces/uat-pan-cedar-0726',
    projectRoot: '/project',
    baseSha: 'b'.repeat(40),
    status: 'promoted',
    members,
    heldOut: [],
    resolutions: [],
    stackStartedAt: null,
    createdAt: '2026-07-26T08:00:00.000Z',
    updatedAt: '2026-07-26T08:49:55.000Z',
  };
}

function status(issueId: string, verificationStatus: ReviewStatus['verificationStatus'], verificationNotes?: string): ReviewStatus {
  return {
    issueId,
    reviewStatus: 'passed',
    testStatus: 'passed',
    verificationStatus,
    verificationNotes,
    readyForMerge: false,
    updatedAt: '2026-07-26T08:00:00.000Z',
  };
}

describe('buildUatPromotionStamp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records a passed verdict with the generation and short promote SHA', () => {
    const stamp = buildUatPromotionStamp(
      status('PAN-1', 'pending'),
      MEMBER,
      { generationName: 'uat/pan-cedar-0726', mergeSha: '546d05b989abcdef' },
    );

    expect(stamp).toMatchObject({
      verificationStatus: 'passed',
      verificationNotes: expect.stringContaining('uat-promotion'),
    });
    expect(stamp.verificationNotes).toContain('uat/pan-cedar-0726');
    expect(stamp.verificationNotes).toContain('546d05b98');
  });

  it.each(['passed', 'skipped'] as const)('preserves an existing %s verdict', (terminalVerdict) => {
    expect(buildUatPromotionStamp(
      status('PAN-1', terminalVerdict, 'existing evidence'),
      MEMBER,
      { generationName: 'uat/pan-cedar-0726', mergeSha: '546d05b989abcdef' },
    )).toEqual({});
  });

  it('anchors the verdict to a non-empty member head and omits an empty head', () => {
    const evidence = { generationName: 'uat/pan-cedar-0726', mergeSha: '546d05b989abcdef' };

    expect(buildUatPromotionStamp(null, MEMBER, evidence).lastVerifiedCommit).toBe(MEMBER.headSha);
    expect(buildUatPromotionStamp(null, { ...MEMBER, headSha: '' }, evidence)).not.toHaveProperty('lastVerifiedCommit');
  });
});

describe('recordUatPromotionVerdicts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stamps exactly the non-terminal generation members through the review-status write door', () => {
    const members = [
      MEMBER,
      { ...MEMBER, issueId: 'PAN-2', headSha: 'c'.repeat(40), mergeOrder: 2 },
      { ...MEMBER, issueId: 'PAN-3', headSha: '', mergeOrder: 3 },
      { ...MEMBER, issueId: 'PAN-4', headSha: 'd'.repeat(40), mergeOrder: 4 },
    ];
    const statuses = new Map<string, ReviewStatus | null>([
      ['PAN-1', status('PAN-1', 'passed', 'runner evidence')],
      ['PAN-2', status('PAN-2', 'skipped', 'existing skip')],
      ['PAN-3', status('PAN-3', 'pending')],
      ['PAN-4', null],
    ]);
    mocks.getReviewStatusSync.mockImplementation((issueId: string) => statuses.get(issueId) ?? null);

    expect(recordUatPromotionVerdicts(generation(members), '546d05b989abcdef')).toEqual(['PAN-3', 'PAN-4']);
    expect(mocks.setReviewStatusSync).toHaveBeenCalledTimes(2);
    expect(mocks.setReviewStatusSync).toHaveBeenNthCalledWith(
      1,
      'PAN-3',
      expect.objectContaining({ verificationStatus: 'passed' }),
      statuses.get('PAN-3'),
    );
    expect(mocks.setReviewStatusSync).toHaveBeenNthCalledWith(
      2,
      'PAN-4',
      expect.objectContaining({ verificationStatus: 'passed' }),
      undefined,
    );
  });
});

function makeHealDeps(overrides: Partial<UatPromotionHealDeps> = {}): UatPromotionHealDeps {
  return {
    resolveProject: vi.fn(() => ({ projectPath: '/project' })),
    listGenerations: vi.fn(() => [generation([MEMBER])]),
    getReviewStatus: vi.fn(() => status('PAN-1', 'pending')),
    setReviewStatus: vi.fn((issueId, update, existing) => ({
      ...(existing ?? status(issueId, 'pending')),
      ...update,
      issueId,
    })),
    findMergeSha: vi.fn(async () => '546d05b989abcdef'),
    ...overrides,
  };
}

describe('healUatPromotionVerification', () => {
  it('records the latest promoted membership and returns its recovered merge evidence', async () => {
    const older = { ...generation([MEMBER]), name: 'uat/pan-older-0725', updatedAt: '2026-07-25T08:00:00.000Z' };
    const latest = generation([MEMBER]);
    const deps = makeHealDeps({ listGenerations: vi.fn(() => [older, latest]) });

    await expect(healUatPromotionVerification('PAN-1', deps)).resolves.toEqual({
      generation: 'uat/pan-cedar-0726',
      mergeSha: '546d05b989abcdef',
    });
    expect(deps.setReviewStatus).toHaveBeenCalledWith(
      'PAN-1',
      expect.objectContaining({
        verificationStatus: 'passed',
        verificationNotes: expect.stringContaining('546d05b98'),
        lastVerifiedCommit: MEMBER.headSha,
      }),
      expect.objectContaining({ verificationStatus: 'pending' }),
    );
  });

  it('writes nothing for terminal verdicts, absent memberships, or unresolvable projects', async () => {
    const terminal = makeHealDeps({ getReviewStatus: vi.fn(() => status('PAN-1', 'passed')) });
    const absent = makeHealDeps({ listGenerations: vi.fn(() => [generation([{ ...MEMBER, issueId: 'PAN-2' }])]) });
    const unresolved = makeHealDeps({ resolveProject: vi.fn(() => null) });

    await expect(healUatPromotionVerification('PAN-1', terminal)).resolves.toBeNull();
    await expect(healUatPromotionVerification('PAN-1', absent)).resolves.toBeNull();
    await expect(healUatPromotionVerification('PAN-1', unresolved)).resolves.toBeNull();
    expect(terminal.setReviewStatus).not.toHaveBeenCalled();
    expect(absent.setReviewStatus).not.toHaveBeenCalled();
    expect(unresolved.setReviewStatus).not.toHaveBeenCalled();
  });

  it('still records the verdict when merge-SHA recovery fails', async () => {
    const deps = makeHealDeps({
      findMergeSha: vi.fn(async () => { throw new Error('shallow history'); }),
    });

    await expect(healUatPromotionVerification('PAN-1', deps)).resolves.toEqual({
      generation: 'uat/pan-cedar-0726',
    });
    expect(deps.setReviewStatus).toHaveBeenCalledWith(
      'PAN-1',
      expect.objectContaining({
        verificationStatus: 'passed',
        verificationNotes: 'uat-promotion: operator UAT of batch uat/pan-cedar-0726 promoted to main (PAN-3114)',
      }),
      expect.anything(),
    );
  });
});

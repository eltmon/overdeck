import { Effect } from 'effect';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NOW = new Date('2026-07-27T12:00:00.000Z');
const ISSUE_ID = 'PAN-3206';
const RUN_ID = 'agent-pan-3206-review-abcdef12';
const HEAD = 'a'.repeat(40);

const mocks = vi.hoisted(() => ({
  statuses: {} as Record<string, Record<string, unknown>>,
  workspace: '',
  sessionAlive: false,
  paneDead: false,
  setReviewStatus: vi.fn(),
  messageAgent: vi.fn(),
  snapshotWorkspaceHeads: vi.fn(),
  deliverReviewVerdictFeedback: vi.fn(),
  emitActivityEntry: vi.fn(),
  reviewedHead: 'a'.repeat(40),
  attestReport: vi.fn(),
  verifyContext: vi.fn(),
  recordReviewVerdict: vi.fn(),
  getProvenance: vi.fn(),
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  loadReviewStatuses: () => mocks.statuses,
  setReviewStatusSync: (...args: unknown[]) => mocks.setReviewStatus(...args),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: () => ({ projectPath: '/project' }),
}));

vi.mock('../../../../src/lib/lifecycle/archive-planning.js', () => ({
  findWorkspacePath: () => mocks.workspace,
}));

vi.mock('../../../../src/lib/tmux.js', () => ({
  sessionExistsSync: () => mocks.sessionAlive,
  isPaneDead: () => Effect.succeed(mocks.paneDead),
}));

vi.mock('../../../../src/lib/agents.js', () => ({
  getAgentRuntimeStateSync: vi.fn(() => null),
  getAgentStateSync: vi.fn(() => null),
  listRunningAgents: vi.fn(() => Effect.succeed([])),
  messageAgent: (...args: unknown[]) => mocks.messageAgent(...args),
}));

vi.mock('../../../../src/lib/cloister/specialists.js', () => ({
  getAllProjectSpecialistStatuses: vi.fn(async () => []),
  getTmuxSessionName: vi.fn(() => 'review-agent'),
}));

vi.mock('../../../../src/lib/git-utils.js', () => ({
  rehydrateHeadAnchor: (anchor: string) => anchor,
  snapshotWorkspaceHeadsPromise: (...args: unknown[]) => mocks.snapshotWorkspaceHeads(...args),
}));

vi.mock('../../../../src/lib/cloister/review-verdict-feedback.js', () => ({
  deliverReviewVerdictFeedback: (...args: unknown[]) => mocks.deliverReviewVerdictFeedback(...args),
}));

vi.mock('../../../../src/lib/activity-logger.js', () => ({
  emitActivityEntrySync: (...args: unknown[]) => mocks.emitActivityEntry(...args),
}));

vi.mock('../../../../src/lib/cloister/review-artifact-attestation.js', () => ({
  verifyReviewContextManifest: (...args: unknown[]) => mocks.verifyContext(...args),
  attestReviewReport: (...args: unknown[]) => mocks.attestReport(...args),
}));

vi.mock('../../../../src/lib/cloister/review-verdict-writer.js', () => ({
  recordReviewVerdict: (...args: unknown[]) => mocks.recordReviewVerdict(...args),
}));

vi.mock('../../../../src/lib/overdeck/agent-review-provenance.js', () => ({
  getReviewArtifactProvenanceSync: (...args: unknown[]) => mocks.getProvenance(...args),
}));

import {
  checkCompletedButUnsignaledReviews,
  reconcileUnappliedReviewVerdicts,
} from '../../../../src/lib/cloister/deacon-review-unsignaled.js';

const temporaryDirectories: string[] = [];

async function writeReviewFixture(options: {
  filename?: 'synthesis.md' | 'review.md';
  body: string;
  ageMs?: number;
  headSha?: string;
  repos?: Array<{ repoKey: string; headSha: string }>;
  runId?: string;
}): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'unapplied-review-verdict-'));
  temporaryDirectories.push(workspace);
  mocks.workspace = workspace;
  const reviewDir = join(workspace, '.pan', 'review', options.runId ?? RUN_ID);
  await mkdir(reviewDir, { recursive: true });
  await writeFile(join(reviewDir, 'context.json'), JSON.stringify({
    generatedAt: new Date(NOW.getTime() - 20 * 60 * 1000).toISOString(),
    headSha: options.headSha ?? HEAD,
    ...(options.repos ? { repos: options.repos } : {}),
  }));
  mocks.reviewedHead = options.repos
    ? options.repos.map(repo => `${repo.repoKey}@${repo.headSha}`).join(' ')
    : (options.headSha ?? HEAD);
  const reportPath = join(reviewDir, options.filename ?? 'synthesis.md');
  await writeFile(reportPath, options.body);
  const reportTime = new Date(NOW.getTime() - (options.ageMs ?? 10 * 60 * 1000));
  await utimes(reportPath, reportTime, reportTime);
  return reviewDir;
}

function pendingStatus(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    issueId: ISSUE_ID,
    reviewStatus: 'pending',
    reviewSpawnedAt: new Date(NOW.getTime() - 30 * 60 * 1000).toISOString(),
    prUrl: 'https://github.com/eltmon/overdeck/pull/3206',
    ...overrides,
  };
}

describe('reconcileUnappliedReviewVerdicts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mocks.statuses = {};
    mocks.workspace = '';
    mocks.sessionAlive = false;
    mocks.paneDead = false;
    mocks.setReviewStatus.mockReset();
    mocks.messageAgent.mockReset().mockResolvedValue({ delivered: true });
    mocks.snapshotWorkspaceHeads.mockReset().mockResolvedValue(HEAD);
    mocks.deliverReviewVerdictFeedback.mockReset().mockReturnValue(Effect.succeed({
      prCommentPosted: false,
      agentMessageSent: true,
    }));
    mocks.emitActivityEntry.mockReset();
    mocks.reviewedHead = HEAD;
    mocks.verifyContext.mockReset().mockImplementation(() => ({ reviewedHead: mocks.reviewedHead }));
    mocks.attestReport.mockReset().mockImplementation(() => ({
      filename: 'synthesis.md',
      verdict: 'passed',
      reviewedHead: mocks.reviewedHead,
    }));
    mocks.recordReviewVerdict.mockReset().mockImplementation(
      (issueId: string, input: { verdict: string; notes?: string; evidenceHead?: string }) => {
        mocks.setReviewStatus(issueId, {
          reviewStatus: input.verdict,
          reviewNotes: input.notes,
          ...(input.evidenceHead && (input.verdict === 'passed' || input.verdict === 'blocked')
            ? { reviewedAtCommit: input.evidenceHead }
            : {}),
        });
        return Promise.resolve({ landed: true, classification: 'anchor-match' });
      },
    );
    mocks.getProvenance.mockReset().mockImplementation(() => ({
      workspace: mocks.workspace,
      reviewRunId: RUN_ID,
    }));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })));
  });

  it('applies a settled approved synthesis stranded in pending and emits an attributed activity', async () => {
    await writeReviewFixture({ body: '## Verdict: APPROVED\n\nNo blockers.' });
    mocks.statuses[ISSUE_ID] = pendingStatus();

    await expect(reconcileUnappliedReviewVerdicts()).resolves.toEqual([
      expect.stringContaining('reconcileUnappliedReviewVerdicts deacon sweep applied passed'),
    ]);

    expect(mocks.setReviewStatus).toHaveBeenCalledWith(ISSUE_ID, {
      reviewStatus: 'passed',
      reviewNotes: 'Review passed applied by deacon sweep from on-disk synthesis.md',
      reviewedAtCommit: HEAD,
    });
    const recoveredAnchor = mocks.setReviewStatus.mock.calls[0]?.[1]?.reviewedAtCommit;
    expect(recoveredAnchor).toBe(HEAD);
    mocks.snapshotWorkspaceHeads.mockResolvedValueOnce('b'.repeat(40));
    const subsequentHead = await mocks.snapshotWorkspaceHeads();
    expect(subsequentHead).not.toBe(recoveredAnchor);
    expect(mocks.emitActivityEntry).toHaveBeenCalledWith(expect.objectContaining({
      source: 'cloister',
      level: 'warn',
      issueId: ISSUE_ID,
      message: expect.stringContaining('reconcileUnappliedReviewVerdicts deacon sweep applied passed'),
    }));
  });

  it('applies a blocked self-review and delivers its blocker with the run id', async () => {
    await writeReviewFixture({
      filename: 'review.md',
      body: '## Verdict: CHANGES REQUESTED — verdict status is never persisted',
    });
    mocks.statuses[ISSUE_ID] = pendingStatus();

    await reconcileUnappliedReviewVerdicts();

    expect(mocks.setReviewStatus).toHaveBeenCalledWith(ISSUE_ID, {
      reviewStatus: 'blocked',
      reviewNotes: 'verdict status is never persisted — applied by deacon sweep from on-disk review.md',
      reviewedAtCommit: HEAD,
    });
    expect(mocks.deliverReviewVerdictFeedback).toHaveBeenCalledWith({
      issueId: ISSUE_ID,
      verdict: 'blocked',
      notes: 'verdict status is never persisted',
      workspacePath: mocks.workspace,
      prUrl: 'https://github.com/eltmon/overdeck/pull/3206',
      runId: RUN_ID,
    });
  });

  it('skips a verdict whose reviewed HEAD differs from the workspace HEAD', async () => {
    await writeReviewFixture({ body: '## Verdict: APPROVED' });
    mocks.statuses[ISSUE_ID] = pendingStatus();
    mocks.snapshotWorkspaceHeads.mockResolvedValue('b'.repeat(40));

    await reconcileUnappliedReviewVerdicts();

    expect(mocks.setReviewStatus).not.toHaveBeenCalled();
  });

  it('applies a polyrepo verdict when every reviewed repository HEAD matches', async () => {
    const apiHead = 'c'.repeat(40);
    const compositeHead = `fe@${HEAD} api@${apiHead}`;
    await writeReviewFixture({
      body: '## Verdict: APPROVED',
      repos: [
        { repoKey: 'fe', headSha: HEAD },
        { repoKey: 'api', headSha: apiHead },
      ],
    });
    mocks.statuses[ISSUE_ID] = pendingStatus({ lastVerifiedCommit: compositeHead });
    mocks.snapshotWorkspaceHeads.mockResolvedValue(compositeHead);

    await reconcileUnappliedReviewVerdicts();

    expect(mocks.setReviewStatus).toHaveBeenCalledWith(ISSUE_ID, expect.objectContaining({
      reviewStatus: 'passed',
      reviewedAtCommit: compositeHead,
    }));
  });

  it('skips a polyrepo verdict when one reviewed repository HEAD has moved', async () => {
    const apiHead = 'c'.repeat(40);
    await writeReviewFixture({
      body: '## Verdict: APPROVED',
      repos: [
        { repoKey: 'fe', headSha: HEAD },
        { repoKey: 'api', headSha: apiHead },
      ],
    });
    mocks.statuses[ISSUE_ID] = pendingStatus();
    mocks.snapshotWorkspaceHeads.mockResolvedValue(`fe@${HEAD} api@${'d'.repeat(40)}`);

    await reconcileUnappliedReviewVerdicts();

    expect(mocks.setReviewStatus).not.toHaveBeenCalled();
  });

  it('continues past a malformed review run and applies the valid run', async () => {
    await writeReviewFixture({ body: '## Verdict: APPROVED' });
    const malformedDir = join(
      mocks.workspace,
      '.pan',
      'review',
      'agent-pan-3206-review-malformed',
    );
    await mkdir(malformedDir, { recursive: true });
    await writeFile(join(malformedDir, 'context.json'), '{not-json');
    const malformedReport = join(malformedDir, 'synthesis.md');
    await writeFile(malformedReport, '## Verdict: FAILED');
    const reportTime = new Date(NOW.getTime() - 6 * 60 * 1000);
    await utimes(malformedReport, reportTime, reportTime);
    mocks.statuses[ISSUE_ID] = pendingStatus();

    await reconcileUnappliedReviewVerdicts();

    expect(mocks.setReviewStatus).toHaveBeenCalledWith(ISSUE_ID, expect.objectContaining({
      reviewStatus: 'passed',
      reviewedAtCommit: HEAD,
    }));
  });

  it('skips a verdict older than a newer review request', async () => {
    await writeReviewFixture({ body: '## Verdict: APPROVED' });
    mocks.statuses[ISSUE_ID] = pendingStatus({
      reviewRequestedAt: new Date(NOW.getTime() - 2 * 60 * 1000).toISOString(),
    });

    await reconcileUnappliedReviewVerdicts();

    expect(mocks.setReviewStatus).not.toHaveBeenCalled();
  });

  it('skips a verdict inside the five-minute settle window', async () => {
    await writeReviewFixture({ body: '## Verdict: APPROVED', ageMs: 4 * 60 * 1000 });
    mocks.statuses[ISSUE_ID] = pendingStatus();

    await reconcileUnappliedReviewVerdicts();

    expect(mocks.setReviewStatus).not.toHaveBeenCalled();
  });

  it('host-applies a settled pending verdict without messaging the live review process', async () => {
    await writeReviewFixture({ body: '## Verdict: APPROVED' });
    mocks.statuses[ISSUE_ID] = pendingStatus();
    mocks.sessionAlive = true;

    await reconcileUnappliedReviewVerdicts();

    expect(mocks.messageAgent).not.toHaveBeenCalled();
    expect(mocks.attestReport).toHaveBeenCalledWith({
      issueId: ISSUE_ID,
      runId: RUN_ID,
      workspacePath: mocks.workspace,
      expectedVerdict: 'passed',
    });
    expect(mocks.recordReviewVerdict).toHaveBeenCalledWith(
      ISSUE_ID,
      expect.objectContaining({
        verdict: 'passed',
        evidenceHead: HEAD,
        extra: expect.objectContaining({
          reviewedAtCommit: HEAD,
          verificationStatus: 'passed',
        }),
        writer: 'unsignaled-recovery',
      }),
    );
  });

  it('host-attests and applies a settled report while the review session remains warm', async () => {
    const blocker = 'workspace subprocess cannot request attestation';
    await writeReviewFixture({
      filename: 'review.md',
      body: `## Verdict: CHANGES REQUESTED — ${blocker}`,
    });
    mocks.statuses[ISSUE_ID] = pendingStatus({ reviewStatus: 'reviewing' });
    mocks.sessionAlive = true;

    await checkCompletedButUnsignaledReviews();

    expect(mocks.messageAgent).not.toHaveBeenCalled();
    expect(mocks.recordReviewVerdict).toHaveBeenCalledWith(
      ISSUE_ID,
      expect.objectContaining({
        verdict: 'blocked',
        evidenceHead: HEAD,
        writer: 'quick-signal',
      }),
    );
    expect(mocks.deliverReviewVerdictFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: ISSUE_ID,
        verdict: 'blocked',
        notes: blocker,
        runId: RUN_ID,
      }),
    );
  });

  it('skips pending review state without a reviewSpawnedAt stamp', async () => {
    await writeReviewFixture({ body: '## Verdict: APPROVED' });
    mocks.statuses[ISSUE_ID] = pendingStatus({ reviewSpawnedAt: undefined });

    await reconcileUnappliedReviewVerdicts();

    expect(mocks.setReviewStatus).not.toHaveBeenCalled();
    expect(mocks.snapshotWorkspaceHeads).not.toHaveBeenCalled();
  });
});

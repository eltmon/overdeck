import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { verificationSatisfied } from '../../../../src/lib/review-status.js';

const { mockSetReviewStatus, mockDeliverReviewVerdictFeedback, mockResolveProject, mockReadWorkspacePlan } = vi.hoisted(() => ({
  mockSetReviewStatus: vi.fn(),
  mockDeliverReviewVerdictFeedback: vi.fn(),
  mockResolveProject: vi.fn(),
  mockReadWorkspacePlan: vi.fn(),
}));

vi.mock('../../../../src/lib/review-status.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/review-status.js')>();
  return {
    ...actual,
    setReviewStatus: mockSetReviewStatus,
    setReviewStatusSync: mockSetReviewStatus,
    getReviewStatus: vi.fn(),
    getReviewStatusSync: vi.fn(),
  };
});

vi.mock('../../../../src/lib/cloister/review-verdict-feedback.js', () => ({
  deliverReviewVerdictFeedback: mockDeliverReviewVerdictFeedback,
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: mockResolveProject,
}));

vi.mock('../../../../src/lib/vbrief/io.js', () => ({
  readWorkspacePlanSync: mockReadWorkspacePlan,
}));

describe('specialists done command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mockSetReviewStatus.mockImplementation((_issueId: string, update: Record<string, unknown>) => {
      return {
        issueId: 'PAN-1059',
        reviewStatus: 'blocked',
        testStatus: 'pending',
        updatedAt: new Date().toISOString(),
        readyForMerge: false,
        prUrl: 'https://github.com/eltmon/overdeck/pull/1059',
        ...update,
      };
    });
    mockDeliverReviewVerdictFeedback.mockReturnValue(Effect.succeed({
      feedbackPath: '/workspace/.pan/feedback/001-review-agent-changes-requested.md',
      prCommentPosted: true,
      agentMessageSent: true,
    }));
    mockResolveProject.mockReturnValue({ projectPath: '/project' });
    mockReadWorkspacePlan.mockReturnValue({
      plan: { items: [{ id: 'issue-view-model' }] },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('allows review to signal blocked status', async () => {
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('review', 'pan-1059', {
      status: 'blocked',
      notes: 'correctness blocker',
    });

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-1059', {
      reviewStatus: 'blocked',
      reviewNotes: 'correctness blocker',
    });
    expect(mockDeliverReviewVerdictFeedback).toHaveBeenCalledWith({
      issueId: 'PAN-1059',
      verdict: 'blocked',
      notes: 'correctness blocker',
      prUrl: 'https://github.com/eltmon/overdeck/pull/1059',
    });
  });

  it('delivers synthesis feedback when review signals failed status', async () => {
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('review', 'pan-1059', {
      status: 'failed',
      notes: 'synthesis crashed',
    });

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-1059', {
      reviewStatus: 'failed',
      reviewNotes: 'synthesis crashed',
    });
    expect(mockDeliverReviewVerdictFeedback).toHaveBeenCalledWith({
      issueId: 'PAN-1059',
      verdict: 'failed',
      notes: 'synthesis crashed',
      prUrl: 'https://github.com/eltmon/overdeck/pull/1059',
    });
  });

  it('does not deliver feedback when review passes', async () => {
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('review', 'pan-1059', {
      status: 'passed',
      notes: 'approved',
    });

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-1059', {
      reviewStatus: 'passed',
      reviewNotes: 'approved',
      reviewedAtCommit: undefined,
      verificationStatus: 'passed',
      verificationNotes: 'Cleared by `pan specialists done review --status passed` override (PAN-1215)',
    });
    expect(mockDeliverReviewVerdictFeedback).not.toHaveBeenCalled();
  });

  it('PAN-2524: persists the verdict before a hanging feedback delivery times out', async () => {
    vi.useFakeTimers();
    mockDeliverReviewVerdictFeedback.mockReturnValue(Effect.never);
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    const completion = doneCommand('review', 'pan-1059', {
      status: 'blocked',
      notes: 'durable first',
    });
    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-1059', {
      reviewStatus: 'blocked',
      reviewNotes: 'durable first',
    });

    await vi.advanceTimersByTimeAsync(30_000);
    await expect(completion).resolves.toBeUndefined();
  });

  it('forces a successful CLI exit after durable completion', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const { doneAndExitCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneAndExitCommand('test', 'pan-1059', { status: 'passed' });

    expect(mockSetReviewStatus).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('requires an exact vBRIEF item for inspect verdicts', async () => {
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await expect(doneCommand('inspect', 'pan-1059', { status: 'passed' }))
      .rejects.toThrow('--item is required for inspect verdicts');
    await expect(doneCommand('inspect', 'pan-1059', { status: 'passed', item: 'missing' }))
      .rejects.toThrow('Item "missing" does not exist in the vBRIEF for PAN-1059');

    await doneCommand('inspect', 'pan-1059', {
      status: 'passed',
      item: 'issue-view-model',
      notes: 'This predates this bead and is correct',
    });

    expect(mockReadWorkspacePlan).toHaveBeenCalledWith('/project/workspaces/feature-pan-1059');
    expect(fetch).toHaveBeenCalledWith('http://localhost:3011/api/specialists/done', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        specialist: 'inspect',
        issueId: 'PAN-1059',
        itemId: 'issue-view-model',
        status: 'passed',
        notes: 'This predates this bead and is correct',
      }),
    });
    expect(mockSetReviewStatus).not.toHaveBeenCalled();
  });

  it('verificationSatisfied is true after passed override even from failed state (AC10/AC27)', () => {
    expect(verificationSatisfied({ verificationStatus: 'failed' })).toBe(false);
    expect(verificationSatisfied({ verificationStatus: 'passed' })).toBe(true);
    expect(verificationSatisfied({ verificationStatus: 'pending' })).toBe(true);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetBeadsForIssue,
  mockMutate,
  mockRunMutationBatch,
  mockFormatFailure,
} = vi.hoisted(() => ({
  mockGetBeadsForIssue: vi.fn(),
  mockMutate: vi.fn(),
  mockRunMutationBatch: vi.fn(),
  mockFormatFailure: vi.fn(),
}));

vi.mock('../../../../src/lib/beads/resolver.js', () => ({
  createBeadsResolver: vi.fn(() => ({
    getBeadsForIssue: mockGetBeadsForIssue,
  })),
}));

vi.mock('../../../../src/lib/beads/writer.js', () => ({
  runMutationBatch: mockRunMutationBatch,
  formatMutationBatchFailure: mockFormatFailure,
}));

import { sweepOrphanedBeads } from '../../../../src/lib/lifecycle/orphaned-beads-sweep.js';

describe('sweepOrphanedBeads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunMutationBatch.mockImplementation(async (_ctx, fn) => {
      const client = { run: vi.fn(), mutate: mockMutate };
      await fn(client);
      return { ok: true, value: undefined, localHead: null };
    });
    mockFormatFailure.mockReturnValue('batch failed');
  });

  it('closes open and in_progress beads through a single runMutationBatch and returns their ids', async () => {
    mockGetBeadsForIssue.mockResolvedValue({
      ok: true,
      value: [
        { id: 'bead-open-1', status: 'open', title: 'Open 1' },
        { id: 'bead-progress-1', status: 'in_progress', title: 'Progress 1' },
        { id: 'bead-open-2', status: 'open', title: 'Open 2' },
        { id: 'bead-closed-1', status: 'closed', title: 'Closed 1' },
      ],
    });

    const result = await sweepOrphanedBeads({
      beadsCwd: '/workspace',
      issueId: 'PAN-2602',
      reason: 'orphaned',
    });

    expect(result).toEqual({ ok: true, closedIds: ['bead-open-1', 'bead-progress-1', 'bead-open-2'], skipped: 1 });
    expect(mockRunMutationBatch).toHaveBeenCalledTimes(1);
    expect(mockRunMutationBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        project: { workspacePath: '/workspace' },
        reason: 'sweep orphaned beads for PAN-2602',
      }),
      expect.any(Function),
    );
    expect(mockMutate).toHaveBeenCalledTimes(3);
    expect(mockMutate).toHaveBeenNthCalledWith(1, ['close', 'bead-open-1', '--reason', 'orphaned']);
    expect(mockMutate).toHaveBeenNthCalledWith(2, ['close', 'bead-progress-1', '--reason', 'orphaned']);
    expect(mockMutate).toHaveBeenNthCalledWith(3, ['close', 'bead-open-2', '--reason', 'orphaned']);
  });

  it('returns ok:false and closes nothing when the beads read fails', async () => {
    mockGetBeadsForIssue.mockResolvedValue({
      ok: false,
      reason: 'beads read timed out',
      transient: true,
      error: new Error('timeout'),
    });

    const result = await sweepOrphanedBeads({
      beadsCwd: '/workspace',
      issueId: 'PAN-2602',
      reason: 'orphaned',
    });

    expect(result).toEqual({ ok: false, closedIds: [], skipped: 0, error: 'beads read timed out' });
    expect(mockRunMutationBatch).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('returns ok:true with empty closedIds and performs no mutation when all beads are already closed', async () => {
    mockGetBeadsForIssue.mockResolvedValue({
      ok: true,
      value: [
        { id: 'bead-closed-1', status: 'closed', title: 'Closed 1' },
        { id: 'bead-closed-2', status: 'closed', title: 'Closed 2' },
      ],
    });

    const result = await sweepOrphanedBeads({
      beadsCwd: '/workspace',
      issueId: 'PAN-2602',
      reason: 'orphaned',
    });

    expect(result).toEqual({ ok: true, closedIds: [], skipped: 2 });
    expect(mockRunMutationBatch).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('returns would-close ids without invoking the writer when dryRun is true', async () => {
    mockGetBeadsForIssue.mockResolvedValue({
      ok: true,
      value: [
        { id: 'bead-open-1', status: 'open', title: 'Open 1' },
        { id: 'bead-closed-1', status: 'closed', title: 'Closed 1' },
      ],
    });

    const result = await sweepOrphanedBeads({
      beadsCwd: '/workspace',
      issueId: 'PAN-2602',
      reason: 'orphaned',
      dryRun: true,
    });

    expect(result).toEqual({ ok: true, closedIds: ['bead-open-1'], skipped: 1 });
    expect(mockRunMutationBatch).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('returns ok:false when the mutation batch fails', async () => {
    mockGetBeadsForIssue.mockResolvedValue({
      ok: true,
      value: [{ id: 'bead-open-1', status: 'open', title: 'Open 1' }],
    });
    mockRunMutationBatch.mockResolvedValue({
      ok: false,
      conflict: false,
      needsOperatorRecovery: true,
      localHead: null,
      message: 'mutation failed',
      cause: new Error('boom'),
    });

    const result = await sweepOrphanedBeads({
      beadsCwd: '/workspace',
      issueId: 'PAN-2602',
      reason: 'orphaned',
    });

    expect(result).toEqual({ ok: false, closedIds: [], skipped: 0, error: 'batch failed' });
    expect(mockFormatFailure).toHaveBeenCalled();
  });
});

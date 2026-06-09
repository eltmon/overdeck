import { describe, it, expect, vi } from 'vitest';
import { runMergeTrainReconcile } from '../../../../src/lib/cloister/merge-train.js';
import type { ReconcileDeps } from '../../../../src/lib/cloister/merge-train-reconciler.js';

const mockDeps = (siblings: string[]): ReconcileDeps => ({
  getReadySiblings: () => siblings,
  rebaseSibling: async () => ({ status: 'up-to-date' }),
  reDispatchVerification: vi.fn(),
  dispatchConflictResolver: vi.fn(),
});

describe('runMergeTrainReconcile (PAN-1691 flag gating)', () => {
  it('is a no-op when the merge-train flag is off and never touches the deps', async () => {
    const getReadySiblings = vi.fn(() => ['PAN-2']);
    const out = await runMergeTrainReconcile('PAN-1', {
      enabled: () => false,
      deps: { ...mockDeps(['PAN-2']), getReadySiblings },
    });
    expect(out).toEqual([]);
    expect(getReadySiblings).not.toHaveBeenCalled();
  });

  it('runs the reconciler over the ready siblings when the flag is on', async () => {
    const out = await runMergeTrainReconcile('PAN-1', {
      enabled: () => true,
      deps: mockDeps(['PAN-2', 'PAN-3']),
    });
    expect(out).toEqual([
      { issueId: 'PAN-2', result: 'unaffected' },
      { issueId: 'PAN-3', result: 'unaffected' },
    ]);
  });
});

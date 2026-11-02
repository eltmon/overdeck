import { describe, it, expect, vi } from 'vitest';
import { reconcileStaleSiblings, type ReconcileDeps, type RebaseStatus } from '../../../../src/lib/cloister/merge-train-reconciler.js';

function makeDeps(
  siblings: string[],
  rebaseResults: Record<string, RebaseStatus | Error>,
): ReconcileDeps & {
  reDispatchVerification: ReturnType<typeof vi.fn>;
  dispatchConflictResolver: ReturnType<typeof vi.fn>;
} {
  return {
    getReadySiblings: () => siblings,
    rebaseSibling: async (issueId: string) => {
      const r = rebaseResults[issueId];
      if (r instanceof Error) throw r;
      return { status: r ?? 'up-to-date' };
    },
    reDispatchVerification: vi.fn(),
    dispatchConflictResolver: vi.fn(),
  };
}

describe('reconcileStaleSiblings (PAN-1691 merge-train reconciler)', () => {
  it('does nothing for an up-to-date sibling', async () => {
    const deps = makeDeps(['PAN-2'], { 'PAN-2': 'up-to-date' });
    const out = await reconcileStaleSiblings('PAN-1', deps);
    expect(out).toEqual([{ issueId: 'PAN-2', result: 'unaffected' }]);
    expect(deps.reDispatchVerification).not.toHaveBeenCalled();
    expect(deps.dispatchConflictResolver).not.toHaveBeenCalled();
  });

  it('re-verifies a cleanly-rebased sibling', async () => {
    const deps = makeDeps(['PAN-2'], { 'PAN-2': 'clean' });
    const out = await reconcileStaleSiblings('PAN-1', deps);
    expect(out).toEqual([{ issueId: 'PAN-2', result: 'rebased' }]);
    expect(deps.reDispatchVerification).toHaveBeenCalledWith('PAN-2');
    expect(deps.dispatchConflictResolver).not.toHaveBeenCalled();
  });

  it('dispatches a resolver agent (not a human) on conflict, with the merged issue as context', async () => {
    const deps = makeDeps(['PAN-2'], { 'PAN-2': 'conflict' });
    const out = await reconcileStaleSiblings('PAN-1', deps);
    expect(out).toEqual([{ issueId: 'PAN-2', result: 'conflict' }]);
    expect(deps.dispatchConflictResolver).toHaveBeenCalledWith('PAN-2', 'PAN-1');
    expect(deps.reDispatchVerification).not.toHaveBeenCalled();
  });

  it('isolates a failing sibling and still processes the rest', async () => {
    const deps = makeDeps(['PAN-2', 'PAN-3', 'PAN-4'], {
      'PAN-2': new Error('git exploded'),
      'PAN-3': 'clean',
      'PAN-4': 'conflict',
    });
    const out = await reconcileStaleSiblings('PAN-1', deps);
    expect(out).toEqual([
      { issueId: 'PAN-2', result: 'error', error: 'git exploded' },
      { issueId: 'PAN-3', result: 'rebased' },
      { issueId: 'PAN-4', result: 'conflict' },
    ]);
    expect(deps.reDispatchVerification).toHaveBeenCalledWith('PAN-3');
    expect(deps.dispatchConflictResolver).toHaveBeenCalledWith('PAN-4', 'PAN-1');
  });

  it('returns an empty result when there are no ready siblings', async () => {
    const deps = makeDeps([], {});
    expect(await reconcileStaleSiblings('PAN-1', deps)).toEqual([]);
  });
});

describe('reconcileStaleSiblings approval carry (PAN-4801)', () => {
  const carry = { from: 'a'.repeat(40), to: 'b'.repeat(40), patchId: 'c'.repeat(40) };

  function carryDeps(carryApproval: ReconcileDeps['carryApproval'], withCarry = true): ReconcileDeps & {
    reDispatchVerification: ReturnType<typeof vi.fn>;
  } {
    return {
      getReadySiblings: () => ['PAN-2'],
      rebaseSibling: async () => (withCarry ? { status: 'clean', carry } : { status: 'clean' }),
      reDispatchVerification: vi.fn(),
      dispatchConflictResolver: vi.fn(),
      carryApproval,
    };
  }

  it('carries the approval instead of re-reviewing when the rebase left the patch unchanged', async () => {
    const carryApproval = vi.fn(async () => true);
    const deps = carryDeps(carryApproval);
    const out = await reconcileStaleSiblings('PAN-1', deps);
    expect(out).toEqual([{ issueId: 'PAN-2', result: 'approval-carried' }]);
    expect(carryApproval).toHaveBeenCalledWith('PAN-2', carry);
    expect(deps.reDispatchVerification).not.toHaveBeenCalled();
  });

  it('re-reviews when the patch changed (no carry offered)', async () => {
    const carryApproval = vi.fn(async () => true);
    const deps = carryDeps(carryApproval, false);
    const out = await reconcileStaleSiblings('PAN-1', deps);
    expect(out).toEqual([{ issueId: 'PAN-2', result: 'rebased' }]);
    expect(carryApproval).not.toHaveBeenCalled();
    expect(deps.reDispatchVerification).toHaveBeenCalledWith('PAN-2');
  });

  it('falls back to a re-review when the carry is refused or throws', async () => {
    for (const carryApproval of [vi.fn(async () => false), vi.fn(async () => { throw new Error('gh down'); })]) {
      const deps = carryDeps(carryApproval);
      const out = await reconcileStaleSiblings('PAN-1', deps);
      expect(out).toEqual([{ issueId: 'PAN-2', result: 'rebased' }]);
      expect(deps.reDispatchVerification).toHaveBeenCalledWith('PAN-2');
    }
  });

  it('re-reviews when no carry step is wired', async () => {
    const deps = carryDeps(undefined);
    const out = await reconcileStaleSiblings('PAN-1', deps);
    expect(out).toEqual([{ issueId: 'PAN-2', result: 'rebased' }]);
  });
});

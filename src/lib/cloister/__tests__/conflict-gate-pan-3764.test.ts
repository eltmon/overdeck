import { describe, expect, it, vi } from 'vitest';
import {
  buildRealConflictGateDeps,
  resolveConflictGate,
} from '../conflict-gate.js';
import { emptyPrFacts, type PrFacts } from '../pr-facts.js';

function facts(fields: Partial<PrFacts> = {}): PrFacts {
  return { ...emptyPrFacts('PAN-3668'), exists: true, open: true, mergeable: true, ...fields };
}

describe('PAN-3764 conflict gate', () => {
  it('does not dispatch conflict recovery for failed checks on a mergeable branch', async () => {
    const dispatchResolver = vi.fn();
    const probeMergeability = vi.fn(async () => 'clean' as const);

    await expect(resolveConflictGate('PAN-3668', '/workspace', 'main', {
      getFacts: vi.fn(() => facts({ checks: 'red' })),
      probeMergeability,
      dispatchResolver,
    })).resolves.toEqual({ gated: false });

    expect(probeMergeability).not.toHaveBeenCalled();
    expect(dispatchResolver).not.toHaveBeenCalled();
  });

  it('uses the sanctioned main-sync command for legitimate conflict recovery', async () => {
    const spawnRun = vi.fn(async () => ({ sessionName: 'agent-pan-3668' })) as never;
    const deps = buildRealConflictGateDeps({
      spawnRun,
      getFacts: vi.fn(() => facts({ mergeable: false, mergeableState: 'dirty' })),
      emitActivityEntry: vi.fn(),
    });

    await deps.dispatchResolver({
      issueId: 'PAN-3668',
      workspacePath: '/workspace',
      targetBranch: 'main',
      blockerSummary: 'forge reports merge state `dirty`',
      reason: 'merge conflict with main must be resolved before review dispatch',
    });

    const prompt = vi.mocked(spawnRun).mock.calls[0]?.[2]?.prompt;
    expect(prompt).toContain('pan sync-main PAN-3668');
    expect(prompt).not.toContain('Rebase this branch');
    expect(prompt).not.toContain('git rebase');
  });
});

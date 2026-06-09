import { describe, it, expect, vi } from 'vitest';
import { assembleUatCandidate, type UatAssembleDeps } from '../../../../src/lib/cloister/uat-assemble.js';

function deps(results: Record<string, { ok: true } | { ok: false; reason: string }>): UatAssembleDeps & {
  createCandidateBranch: ReturnType<typeof vi.fn>;
} {
  return {
    createCandidateBranch: vi.fn(async () => {}),
    mergeBranch: async (fb: string) => results[fb] ?? { ok: true },
  };
}

describe('assembleUatCandidate (PAN-1691 UAT branch assembly)', () => {
  it('creates the branch and merges every feature when all are clean', async () => {
    const d = deps({});
    const out = await assembleUatCandidate('uat/pan-otter-0609', ['feature/pan-1', 'feature/pan-2'], d);
    expect(d.createCandidateBranch).toHaveBeenCalledWith('uat/pan-otter-0609');
    expect(out).toEqual({ branch: 'uat/pan-otter-0609', merged: ['feature/pan-1', 'feature/pan-2'], conflicts: [] });
  });

  it('reports conflicts but still merges the rest', async () => {
    const d = deps({ 'feature/pan-2': { ok: false, reason: 'overlap in foo.ts' } });
    const out = await assembleUatCandidate('uat/pan-otter-0609', ['feature/pan-1', 'feature/pan-2', 'feature/pan-3'], d);
    expect(out.merged).toEqual(['feature/pan-1', 'feature/pan-3']);
    expect(out.conflicts).toEqual([{ branch: 'feature/pan-2', reason: 'overlap in foo.ts' }]);
  });

  it('creates just the branch for an empty bundle', async () => {
    const d = deps({});
    const out = await assembleUatCandidate('uat/pan-otter-0609', [], d);
    expect(d.createCandidateBranch).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ branch: 'uat/pan-otter-0609', merged: [], conflicts: [] });
  });
});

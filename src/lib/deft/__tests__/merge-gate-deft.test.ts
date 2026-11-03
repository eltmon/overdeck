/**
 * PAN-4820 WI-6: the merge gate waives approval for a Deft issue and runs the
 * Deft merge guard instead; an Overdeck issue still needs approval at head.
 * Forge facts, reviews, pipeline and guard are injected.
 */
import { describe, expect, it, vi } from 'vitest';
import { evaluateIssueMergeGate, type MergeGateDeps } from '../../cloister/merge-gate.js';
import { emptyPrFacts, type PrFacts } from '../../cloister/pr-facts.js';

// PAN-4852: the SageOx merge guard reads git and projects.yaml; these tests judge
// forge facts and the Deft guard only (repo-merge-guards.test.ts covers SageOx).
vi.mock('../../sageox/merge-guard.js', () => ({ sageoxMergeGuardForIssue: vi.fn(async () => ({ ok: true })) }));

const HEAD = 'dddd444400000000000000000000000000000000';

/** Open, green and mergeable, with no approval anywhere. */
function unapprovedFacts(): PrFacts {
  return {
    ...emptyPrFacts('PAN-1'),
    forge: 'github',
    url: 'https://github.com/eltmon/overdeck/pull/4900',
    number: 4900,
    exists: true,
    open: true,
    headSha: HEAD,
    headBranch: 'feature/pan-1',
    mergeable: true,
    mergeableState: 'clean',
    checks: 'green',
    testChecks: 'green',
    testJobSucceeded: true,
  };
}

function deps(
  deft: boolean,
  guard: MergeGateDeps['deftGuard'] = async () => ({ ok: true, drifted: [] }),
  facts: PrFacts = unapprovedFacts(),
): MergeGateDeps {
  return {
    getFacts: async () => facts,
    readReviews: async () => ({ headRefOid: HEAD, reviews: [] }),
    overdeckLogins: async () => ['overdeck-agent[bot]'],
    ciTestsRequired: () => true,
    uatRequired: async () => false,
    isDeftPipeline: async () => deft,
    deftGuard: guard,
  };
}

describe('evaluateIssueMergeGate for a Deft issue', () => {
  it('is ready without approval when green, mergeable and the guard passes', async () => {
    const guard = vi.fn(async () => ({ ok: true as const, drifted: [] }));

    const result = await evaluateIssueMergeGate('PAN-1', deps(true, guard));

    expect(result.ready).toBe(true);
    expect(guard).toHaveBeenCalledWith('PAN-1', HEAD);
  });

  it('is not ready when the diff carries .githooks/pre-push, with the guard reason', async () => {
    const reason = 'PR contains Deft install paths: .githooks/pre-push';

    const result = await evaluateIssueMergeGate(
      'PAN-1',
      deps(true, async () => ({ ok: false, reason, paths: ['.githooks/pre-push'], drifted: [] })),
    );

    expect(result).toMatchObject({ ready: false, reason, deftDrift: [] });
  });

  it('carries drifted paths for the operator decision', async () => {
    const result = await evaluateIssueMergeGate(
      'PAN-1',
      deps(true, async () => ({ ok: false, reason: 'drift', paths: ['package.json'], drifted: ['package.json'] })),
    );

    expect(result).toMatchObject({ ready: false, deftDrift: ['package.json'] });
  });

  it('refuses when the forge reports no PR head, and never runs the guard', async () => {
    const guard = vi.fn(async () => ({ ok: true as const, drifted: [] }));

    const result = await evaluateIssueMergeGate('PAN-1', deps(true, guard, { ...unapprovedFacts(), forge: 'gitlab', headSha: null }));

    expect(result).toMatchObject({ ready: false, reason: 'the Deft merge guard needs the PR head, and the forge reported none' });
    expect(guard).not.toHaveBeenCalled();
  });

  it('keeps an explicit approval requirement', async () => {
    const result = await evaluateIssueMergeGate('PAN-1', deps(true), { requireApprovalAtHead: true });

    expect(result.ready).toBe(false);
  });
});

describe('evaluateIssueMergeGate for an Overdeck issue', () => {
  it('still requires approval and never runs the Deft guard', async () => {
    const guard = vi.fn(async () => ({ ok: true as const, drifted: [] }));

    const result = await evaluateIssueMergeGate('PAN-1', deps(false, guard));

    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/approv/i);
    expect(guard).not.toHaveBeenCalled();
  });
});

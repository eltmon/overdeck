/**
 * The one merge gate (#4016, #4021, #4036): forge facts judged against the
 * project's test mode and the issue's UAT requirement, read at call time.
 */
import { describe, expect, it, vi } from 'vitest';

import { defaultUatRequired, evaluateIssueMergeGate } from '../merge-gate.js';
import { getMergeReadyIssues } from '../merge-ready-set.js';
import { emptyPrFacts, type PrFacts } from '../pr-facts.js';

const HEAD = 'dddd444400000000000000000000000000000000';

function readyFacts(issueId: string, overrides: Partial<PrFacts> = {}): PrFacts {
  return {
    ...emptyPrFacts(issueId),
    forge: 'github',
    exists: true,
    open: true,
    headSha: HEAD,
    headBranch: `feature/${issueId.toLowerCase()}`,
    reviewDecision: 'APPROVED',
    approved: true,
    mergeable: true,
    checks: 'green',
    testChecks: 'green',
    testJobSucceeded: true,
    ...overrides,
  };
}

describe('evaluateIssueMergeGate', () => {
  it('requires the CI test job only for a verification.tests: ci project (#4021)', async () => {
    const facts = readyFacts('PAN-1', { testChecks: 'none', testJobSucceeded: false });

    const ciMode = await evaluateIssueMergeGate('PAN-1', {
      getFacts: async () => facts,
      ciTestsRequired: () => true,
    });
    expect(ciMode.ready).toBe(false);
    expect(ciMode.reason).toContain('no CI test job reported');

    const localMode = await evaluateIssueMergeGate('PAN-1', {
      getFacts: async () => facts,
      ciTestsRequired: () => false,
    });
    expect(localMode.ready).toBe(true);
  });

  it('blocks a failed UAT at the head only when UAT is required (#4036)', async () => {
    const facts = readyFacts('PAN-2', { uatVerdict: { status: 'failed', sha: HEAD, postedAt: null } });

    const held = await evaluateIssueMergeGate('PAN-2', {
      getFacts: async () => facts,
      ciTestsRequired: () => false,
      uatRequired: async () => true,
    });
    expect(held).toEqual(expect.objectContaining({ ready: false, reason: `browser UAT failed on PR HEAD ${HEAD}` }));

    const released = await evaluateIssueMergeGate('PAN-2', {
      getFacts: async () => facts,
      ciTestsRequired: () => false,
      uatRequired: async () => false,
    });
    expect(released.ready).toBe(true);
  });

  it('reads the UAT requirement only when a failed verdict applies to the head', async () => {
    const uatRequired = vi.fn(async () => true);
    const result = await evaluateIssueMergeGate('PAN-3', {
      getFacts: async () => readyFacts('PAN-3', { uatVerdict: { status: 'passed', sha: HEAD, postedAt: null } }),
      ciTestsRequired: () => false,
      uatRequired,
    });
    expect(result.ready).toBe(true);
    expect(uatRequired).not.toHaveBeenCalled();
  });

  it('holds a failed UAT when the requirement cannot be read', async () => {
    const result = await evaluateIssueMergeGate('PAN-4', {
      getFacts: async () => readyFacts('PAN-4', { uatVerdict: { status: 'failed', sha: HEAD, postedAt: null } }),
      ciTestsRequired: () => false,
      uatRequired: async () => { throw new Error('tracker unreachable'); },
    });
    expect(result.ready).toBe(false);
  });

  it('holds a failed UAT when the issue labels cannot be read, through the default requirement (#4040 review)', async () => {
    const failedAtHead = readyFacts('PAN-6', { uatVerdict: { status: 'failed', sha: HEAD, postedAt: null } });
    const unreadable = async (): Promise<string[]> => { throw new Error('gh: rate limited'); };

    // The requirement itself refuses to guess: no silent project/global fallback.
    await expect(defaultUatRequired('PAN-6', {
      getIssueLabels: unreadable, project: { auto_merge_default: 'auto' }, globalRequireUat: false,
    })).rejects.toThrow('rate limited');

    const result = await evaluateIssueMergeGate('PAN-6', {
      getFacts: async () => failedAtHead,
      ciTestsRequired: () => false,
      uatRequired: (issueId) => defaultUatRequired(issueId, {
        getIssueLabels: unreadable, project: { auto_merge_default: 'auto' }, globalRequireUat: false,
      }),
    });
    expect(result.ready).toBe(false);
    expect(result.reason).toBe(`browser UAT failed on PR HEAD ${HEAD}`);
  });

  it('resolves the requirement from the labels when they can be read', async () => {
    await expect(defaultUatRequired('PAN-7', {
      getIssueLabels: async () => ['auto-merge'], project: null, globalRequireUat: true,
    })).resolves.toBe(false);
    await expect(defaultUatRequired('PAN-7', {
      getIssueLabels: async () => ['hold-for-uat'], project: { auto_merge_default: 'auto' }, globalRequireUat: false,
    })).resolves.toBe(true);
  });

  it('passes the strike branch through to the forge read (#4016)', async () => {
    const getFacts = vi.fn(async () => readyFacts('PAN-8', { headBranch: 'strike/pan-8' }));
    await evaluateIssueMergeGate('PAN-8', { getFacts, ciTestsRequired: () => false }, { preferBranch: 'strike/pan-8' });
    expect(getFacts).toHaveBeenCalledWith('PAN-8', { preferBranch: 'strike/pan-8' });
  });

  it('returns the facts it judged, so a strike landing can pin its own PR (#4016)', async () => {
    const result = await evaluateIssueMergeGate('PAN-5', {
      getFacts: async () => readyFacts('PAN-5', { headBranch: 'strike/pan-5', checks: 'red' }),
      ciTestsRequired: () => false,
    });
    expect(result.ready).toBe(false);
    expect(result.facts.headBranch).toBe('strike/pan-5');
  });
});

describe('getMergeReadyIssues through the merge gate', () => {
  it('leaves out an issue the CI test job or a failed required UAT blocks', async () => {
    const facts: Record<string, PrFacts> = {
      'PAN-10': readyFacts('PAN-10'),
      'PAN-11': readyFacts('PAN-11', { testChecks: 'green', testJobSucceeded: false }),
      'PAN-12': readyFacts('PAN-12', { uatVerdict: { status: 'failed', sha: HEAD, postedAt: null } }),
    };
    const ready = await getMergeReadyIssues({
      listProjects: async () => [{ key: 'overdeck', config: { name: 'Overdeck', path: '/p' } as never }],
      gather: async () => [{
        signals: Object.keys(facts).map((issueId) => ({ issueId, hasOpenPr: true, issueOpen: true, phaseLabel: null })),
      }] as never,
      getFacts: async (issueId) => facts[issueId]!,
      ciTestsRequired: () => true,
      uatRequired: async () => true,
    });
    expect(ready).toEqual(['PAN-10']);
  });
});

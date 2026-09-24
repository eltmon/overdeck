import { describe, expect, it } from 'vitest';
import { derivePipelinePhase, type PipelinePhase } from '../../../../src/lib/reconstruct/derive-phase.js';

/**
 * PAN-3917: the phase derives from the tracker issue and the PR's
 * reviewDecision alone — the per-issue record is gone.
 */
describe('derivePipelinePhase', () => {
  const cases: Array<{ name: string; args: Parameters<typeof derivePipelinePhase>[0]; want: PipelinePhase }> = [
    {
      name: 'tracker-closed issue → done',
      args: { issueClosed: true, hasPr: false, reviewDecision: null },
      want: 'done',
    },
    {
      name: 'no PR → work',
      args: { issueClosed: false, hasPr: false, reviewDecision: null },
      want: 'work',
    },
    {
      name: 'open PR awaiting review → review',
      args: { issueClosed: false, hasPr: true, reviewDecision: 'REVIEW_REQUIRED' },
      want: 'review',
    },
    {
      name: 'open PR with no decision yet → review',
      args: { issueClosed: false, hasPr: true, reviewDecision: null },
      want: 'review',
    },
    {
      name: 'APPROVED → merge',
      args: { issueClosed: false, hasPr: true, reviewDecision: 'APPROVED' },
      want: 'merge',
    },
    {
      name: 'a closed issue outranks an approved PR',
      args: { issueClosed: true, hasPr: true, reviewDecision: 'APPROVED' },
      want: 'done',
    },
  ];

  for (const { name, args, want } of cases) {
    it(name, () => {
      expect(derivePipelinePhase(args)).toBe(want);
    });
  }
});

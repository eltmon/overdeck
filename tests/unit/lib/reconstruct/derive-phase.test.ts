import { describe, it, expect } from 'vitest';
import { derivePipelinePhase, type PipelinePhase } from '../../../../src/lib/reconstruct/derive-phase.js';
import type { PanIssueRecord } from '../../../../src/lib/pan-dir/record.js';

function record(overrides: Partial<PanIssueRecord['pipeline']> = {}): PanIssueRecord {
  return {
    issueId: 'PAN-1920',
    schemaVersion: 2,
    pipeline: {
      issueId: 'PAN-1920',
      reviewStatus: 'pending',
      testStatus: 'pending',
      readyForMerge: false,
      updatedAt: new Date().toISOString(),
      ...overrides,
    },
    closeOut: {
      usage: { byStage: {}, totals: {} },
      merges: [],
      ranOn: 'localhost',
    },
  };
}

describe('derivePipelinePhase', () => {
  const cases: Array<{
    name: string;
    args: Parameters<typeof derivePipelinePhase>[0];
    expected: PipelinePhase;
  }> = [
    {
      name: 'closed issue → done',
      args: { issueClosed: true, hasPr: false, record: null, reviewDecision: null },
      expected: 'done',
    },
    {
      name: 'open issue, no PR → work',
      args: { issueClosed: false, hasPr: false, record: null, reviewDecision: null },
      expected: 'work',
    },
    {
      name: 'PR open, not approved → review',
      args: { issueClosed: false, hasPr: true, record: record(), reviewDecision: 'REVIEW_REQUIRED' },
      expected: 'review',
    },
    {
      name: 'record readyForMerge true → merge',
      args: { issueClosed: false, hasPr: true, record: record({ readyForMerge: true }), reviewDecision: null },
      expected: 'merge',
    },
    {
      name: 'record reviewStatus passed → merge',
      args: { issueClosed: false, hasPr: true, record: record({ reviewStatus: 'passed' }), reviewDecision: null },
      expected: 'merge',
    },
    {
      name: 'GitHub reviewDecision APPROVED → merge',
      args: { issueClosed: false, hasPr: true, record: null, reviewDecision: 'APPROVED' },
      expected: 'merge',
    },
    {
      name: 'D7 fallback: null record + APPROVED → merge',
      args: { issueClosed: false, hasPr: true, record: null, reviewDecision: 'APPROVED' },
      expected: 'merge',
    },
    {
      name: 'D7 fallback: null record + open PR + no approval → review',
      args: { issueClosed: false, hasPr: true, record: null, reviewDecision: null },
      expected: 'review',
    },
    {
      name: 'closed issue with approved PR still → done',
      args: { issueClosed: true, hasPr: true, record: record({ readyForMerge: true }), reviewDecision: 'APPROVED' },
      expected: 'done',
    },
  ];

  for (const { name, args, expected } of cases) {
    it(name, () => {
      expect(derivePipelinePhase(args)).toBe(expected);
    });
  }
});

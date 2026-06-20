import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SequenceNode } from '../backlog/types.js';

vi.mock('../review-status.js', () => ({
  getReviewStatusSync: vi.fn().mockReturnValue(null),
}));

import { pickFromSequence } from '../flywheel-merge-order.js';

function makeNode(issue: string, rank: number, overrides: Partial<SequenceNode> = {}): SequenceNode {
  return {
    issue,
    rank,
    size: 'S',
    importance: 'medium',
    score: 50,
    condition: 'ok',
    dependsOn: [],
    why: `Why for ${issue}`,
    gate: 'auto',
    planning: 'auto',
    ...overrides,
  };
}

describe('pickFromSequence – ready-or-PRD eligibility gate (FR-14)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips rank-1 authorized unparked issue with neither PRD nor spec, picks rank-2 which has a PRD', () => {
    const nodes = [
      makeNode('PAN-NO-PRD', 1),
      makeNode('PAN-HAS-PRD', 2),
    ];
    const result = pickFromSequence(nodes, {
      isAuthorizedIssue: () => true,
      isReadyOrHasPrd: (id) => id === 'PAN-HAS-PRD',
    });
    expect(result?.issueId).toBe('PAN-HAS-PRD');
  });

  it('returns null when all issues lack PRD and spec', () => {
    const nodes = [makeNode('PAN-1', 1), makeNode('PAN-2', 2)];
    const result = pickFromSequence(nodes, {
      isAuthorizedIssue: () => true,
      isReadyOrHasPrd: () => false,
    });
    expect(result).toBeNull();
  });

  it('selects rank-1 when it has a spec (ready=true)', () => {
    const nodes = [makeNode('PAN-READY', 1), makeNode('PAN-2', 2)];
    const result = pickFromSequence(nodes, {
      isReadyOrHasPrd: (id) => id === 'PAN-READY',
    });
    expect(result?.issueId).toBe('PAN-READY');
  });

  it('backwards-compatible: no isReadyOrHasPrd passes all issues regardless of PRD/spec', () => {
    const nodes = [makeNode('PAN-NO-ANYTHING', 1)];
    const result = pickFromSequence(nodes);
    expect(result?.issueId).toBe('PAN-NO-ANYTHING');
  });
});

describe('pickFromSequence – author/assignee safety gate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips a rank-1 issue when isAuthorizedIssue returns false', () => {
    const nodes = [
      makeNode('PAN-THIRD-PARTY', 1),
      makeNode('PAN-100', 2),
    ];
    const result = pickFromSequence(nodes, {
      isAuthorizedIssue: (id) => id !== 'PAN-THIRD-PARTY',
    });
    expect(result?.issueId).toBe('PAN-100');
  });

  it('returns null when all issues are unauthorized', () => {
    const nodes = [makeNode('PAN-EXT-1', 1), makeNode('PAN-EXT-2', 2)];
    const result = pickFromSequence(nodes, {
      isAuthorizedIssue: () => false,
    });
    expect(result).toBeNull();
  });

  it('selects rank-1 when isAuthorizedIssue returns true for it', () => {
    const nodes = [makeNode('PAN-1', 1), makeNode('PAN-2', 2)];
    const result = pickFromSequence(nodes, {
      isAuthorizedIssue: () => true,
    });
    expect(result?.issueId).toBe('PAN-1');
  });

  it('backwards-compatible: no isAuthorizedIssue option selects rank-1 regardless of ownership', () => {
    const nodes = [makeNode('PAN-ANY', 1)];
    const result = pickFromSequence(nodes);
    expect(result?.issueId).toBe('PAN-ANY');
  });
});

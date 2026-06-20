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

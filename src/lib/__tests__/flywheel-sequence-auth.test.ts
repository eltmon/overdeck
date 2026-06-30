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
      issueLabels: (id) => (id === 'PAN-HAS-PRD' ? ['released'] : []),
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
      issueLabels: (id) => (id === 'PAN-READY' ? ['released'] : []),
      isReadyOrHasPrd: (id) => id === 'PAN-READY',
    });
    expect(result?.issueId).toBe('PAN-READY');
  });

  it('backwards-compatible: no isReadyOrHasPrd passes all issues regardless of PRD/spec', () => {
    const nodes = [makeNode('PAN-NO-ANYTHING', 1)];
    const result = pickFromSequence(nodes, { issueLabels: () => ['released'] });
    expect(result?.issueId).toBe('PAN-NO-ANYTHING');
  });
});

describe('pickFromSequence – isInPipeline live-workspace gate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips rank-1 when isInPipeline returns true, picks rank-2', () => {
    const nodes = [
      makeNode('PAN-LIVE', 1),
      makeNode('PAN-IDLE', 2),
    ];
    const result = pickFromSequence(nodes, {
      issueLabels: (id) => (id === 'PAN-IDLE' ? ['released'] : []),
      isInPipeline: (id) => id === 'PAN-LIVE',
    });
    expect(result?.issueId).toBe('PAN-IDLE');
  });

  it('returns null when all issues are in-pipeline', () => {
    const nodes = [makeNode('PAN-1', 1), makeNode('PAN-2', 2)];
    const result = pickFromSequence(nodes, {
      isInPipeline: () => true,
    });
    expect(result).toBeNull();
  });

  it('backwards-compatible: no isInPipeline option selects rank-1', () => {
    const nodes = [makeNode('PAN-1', 1), makeNode('PAN-2', 2)];
    const result = pickFromSequence(nodes, { issueLabels: () => ['released'] });
    expect(result?.issueId).toBe('PAN-1');
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
      issueLabels: (id) => (id === 'PAN-100' ? ['released'] : []),
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
      issueLabels: () => ['released'],
      isAuthorizedIssue: () => true,
    });
    expect(result?.issueId).toBe('PAN-1');
  });

  it('backwards-compatible: no isAuthorizedIssue option selects rank-1 regardless of ownership', () => {
    const nodes = [makeNode('PAN-ANY', 1)];
    const result = pickFromSequence(nodes, { issueLabels: () => ['released'] });
    expect(result?.issueId).toBe('PAN-ANY');
  });
});

describe('pickFromSequence – auto_pickup_backlog blanket release (PAN-2059 + vision.mdx)', () => {
  beforeEach(() => vi.clearAllMocks());

  const readyPlanned = {
    issueLabels: (id: string) => (id === 'PAN-UNRELEASED' ? ['ready'] : ['ready']),
    isAuthorizedIssue: () => true,
    isReadyOrHasPrd: () => true,
    requireReady: true,
  };

  it('OFF: a ready+planned issue with no `released` label is skipped', () => {
    const result = pickFromSequence([makeNode('PAN-UNRELEASED', 1)], readyPlanned);
    expect(result).toBeNull();
  });

  it('ON: the toggle blanket-releases, so the same unreleased issue is picked', () => {
    const result = pickFromSequence([makeNode('PAN-UNRELEASED', 1)], { ...readyPlanned, autoPickupBacklog: true });
    expect(result?.issueId).toBe('PAN-UNRELEASED');
  });

  it('ON: vetoed still hard-stops even under blanket release', () => {
    const nodes = [makeNode('PAN-VETO', 1), makeNode('PAN-OK', 2)];
    const result = pickFromSequence(nodes, {
      issueLabels: (id) => (id === 'PAN-VETO' ? ['ready', 'vetoed'] : ['ready']),
      isAuthorizedIssue: () => true,
      isReadyOrHasPrd: () => true,
      requireReady: true,
      autoPickupBacklog: true,
    });
    expect(result?.issueId).toBe('PAN-OK');
  });
});

describe('pickFromSequence – vetoed / parked label gates (PAN-2006)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips a `vetoed`-labelled rank-1 issue and picks rank-2', () => {
    const nodes = [makeNode('PAN-VETO', 1), makeNode('PAN-OK', 2)];
    const result = pickFromSequence(nodes, {
      issueLabels: (id) => (id === 'PAN-VETO' ? ['vetoed'] : ['released']),
    });
    expect(result?.issueId).toBe('PAN-OK');
  });

  it('vetoed is case-insensitive', () => {
    const nodes = [makeNode('PAN-VETO', 1), makeNode('PAN-OK', 2)];
    const result = pickFromSequence(nodes, {
      issueLabels: (id) => (id === 'PAN-VETO' ? ['Vetoed'] : ['released']),
    });
    expect(result?.issueId).toBe('PAN-OK');
  });

  it('skips the new `parked` label as well as legacy needs-design/needs-discussion', () => {
    const nodes = [
      makeNode('PAN-PARKED', 1),
      makeNode('PAN-LEGACY', 2),
      makeNode('PAN-OK', 3),
    ];
    const result = pickFromSequence(nodes, {
      issueLabels: (id) =>
        id === 'PAN-PARKED' ? ['parked'] : id === 'PAN-LEGACY' ? ['needs-design'] : ['released'],
    });
    expect(result?.issueId).toBe('PAN-OK');
  });

  it('returns null when the only ready issue is vetoed', () => {
    const nodes = [makeNode('PAN-VETO', 1)];
    const result = pickFromSequence(nodes, { issueLabels: () => ['vetoed'] });
    expect(result).toBeNull();
  });
});

describe('pickFromSequence – Definition of Ready gate (PAN-2006, requireReady)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('with requireReady, skips an unlabelled rank-1 and picks the rank-2 that is `ready`', () => {
    const nodes = [makeNode('PAN-NOTREADY', 1), makeNode('PAN-READY', 2)];
    const result = pickFromSequence(nodes, {
      requireReady: true,
      issueLabels: (id) => (id === 'PAN-READY' ? ['ready', 'released'] : []),
    });
    expect(result?.issueId).toBe('PAN-READY');
  });

  it('with requireReady and nothing marked ready, returns null', () => {
    const nodes = [makeNode('PAN-1', 1), makeNode('PAN-2', 2)];
    const result = pickFromSequence(nodes, { requireReady: true, issueLabels: () => [] });
    expect(result).toBeNull();
  });

  it('without requireReady (legacy), an unlabelled rank-1 is still picked', () => {
    const nodes = [makeNode('PAN-1', 1)];
    const result = pickFromSequence(nodes, { issueLabels: () => ['released'] });
    expect(result?.issueId).toBe('PAN-1');
  });
});

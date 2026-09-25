import { describe, expect, it, vi } from 'vitest';
import type { DerivedIssueState, IssueState } from '@overdeck/contracts';

// merge-strike pulls in lib/agents for the rebase-escalation path, which still
// reaches the record plane W3 is deleting. These tests exercise the queue walk
// only, so the agent surface is stubbed rather than loaded.
vi.mock('../../../../../lib/agents.js', () => ({
  getAgentState: vi.fn(),
  messageAgent: vi.fn(),
  spawnAgent: vi.fn(),
}));
vi.mock('../../../../../lib/agents/agent-state.js', () => ({
  clearYieldForResume: vi.fn(),
  decideResumeGate: vi.fn(() => ({ decision: 'proceed' })),
  getAgentResumeGateBlockReason: vi.fn(() => null),
  getAgentState: vi.fn(() => null),
  saveAgentStateSync: vi.fn(),
}));
// config-yaml's defaults pull tier-table, which still imports the record plane
// W3 is deleting. Only the default tiered-execution block is needed here.
vi.mock('../../../../../lib/agents/tier-table.js', () => ({
  DEFAULT_TIERED_EXECUTION_CONFIG: { enabled: false, tiers: [], subscription: 'all' },
}));
vi.mock('../../../../../lib/work-agent-lifecycle.js', () => ({
  getWorkAgentLifecycleState: vi.fn(() => ({ hasLiveTmuxSession: false, canResumeSession: false, canStartFresh: false })),
}));

const {
  advanceMergeQueue,
  automaticMergePin,
  automaticMergeStartRefusal,
  forgeMergeGateRefusal,
  mergeGateRefusal,
  mergeTargetRefusal,
} = await import('../merge-strike.js');
type MergeQueueAdvanceDeps = Parameters<typeof advanceMergeQueue>[0];
type MergeGateVerdict = Awaited<ReturnType<MergeQueueAdvanceDeps['checkMergeGate']>>;

/**
 * PAN-3328: the merge queue must not be able to wedge behind an entry that
 * `triggerMerge()` would bounce before it claims the queue. These tests lock the
 * drain: unstartable heads are removed, the first startable entry is triggered,
 * and the walk always terminates.
 *
 * PAN-3917: startability is now the forge's answer. #3983: the merge gate
 * judges approval, checks and mergeability; the derived state refuses only a
 * merged issue. The harness's default gate is ready exactly for `ready` rows.
 *
 * #4016/#4021/#4036: every entry, whatever branches the issue has, also passes
 * the forge-facts merge gate (CI test job, failed required UAT).
 */

function derived(issueId: string, state: IssueState): DerivedIssueState {
  return state === 'ready'
    ? { issueId, state, pr: { url: `https://github.com/o/r/pull/1`, number: 1, reviewState: 'approved', checks: 'green', mergeable: true } }
    : { issueId, state };
}

/** Build deps over an in-memory queue that behaves like dequeueMerge(). */
function harness(
  queue: string[],
  states: Record<string, IssueState>,
  gates: Record<string, MergeGateVerdict> = {},
): { deps: MergeQueueAdvanceDeps; queue: string[]; triggered: Array<[string, unknown]>; warnings: string[] } {
  const triggered: Array<[string, unknown]> = [];
  const warnings: string[] = [];
  const deps: MergeQueueAdvanceDeps = {
    dequeue: (_projectKey, completedIssueId) => {
      if (completedIssueId) {
        const index = queue.indexOf(completedIssueId);
        if (index >= 0) queue.splice(index, 1);
      }
      return queue[0] ?? null;
    },
    getDerivedState: async (issueId) => derived(issueId, states[issueId] ?? 'backlog'),
    checkMergeGate: async (issueId) => gates[issueId]
      ?? (states[issueId] === 'ready' ? { ready: true } : { ready: false, reason: 'no pull request for this issue' }),
    triggerMerge: async (issueId, ...rest: unknown[]) => {
      triggered.push([issueId, rest[0]]);
      return { success: true };
    },
    log: () => {},
    warn: (message) => warnings.push(message),
  };
  return { deps, queue, triggered, warnings };
}

describe('advanceMergeQueue', () => {
  it('drops heads the forge would reject and starts the first ready entry', async () => {
    const { deps, queue, triggered, warnings } = harness(
      ['PAN-100', 'PAN-200', 'PAN-300'],
      {
        // No PR at all — exactly the shape of the 12 rows that wedged the real
        // queue for 26 days.
        'PAN-100': 'planned',
        'PAN-200': 'merged',
        'PAN-300': 'ready',
      },
    );

    await advanceMergeQueue(deps, 'pan');

    expect(triggered).toEqual([['PAN-300', undefined]]);
    expect(queue).toEqual(['PAN-300']);
    expect(warnings.join('\n')).toContain('Dropped PAN-100 from the pan merge queue');
    expect(warnings.join('\n')).toContain('Dropped PAN-200 from the pan merge queue');
  });

  it('names the missing forge condition when it drops a head', async () => {
    const { deps, warnings } = harness(['PAN-100'], { 'PAN-100': 'in-review' });
    await advanceMergeQueue(deps, 'pan');
    expect(warnings.join('\n')).toContain('Cannot merge: no pull request for this issue');
  });

  it('removes the completed issue before choosing the next entry', async () => {
    const { deps, queue, triggered } = harness(
      ['PAN-100', 'PAN-200'],
      { 'PAN-100': 'ready', 'PAN-200': 'ready' },
    );

    await advanceMergeQueue(deps, 'pan', 'PAN-100');

    expect(queue).toEqual(['PAN-200']);
    expect(triggered).toEqual([['PAN-200', undefined]]);
  });

  it('empties a queue in which nothing can start, instead of stopping on the head', async () => {
    const { deps, queue, triggered } = harness(
      ['PAN-100', 'PAN-200'],
      { 'PAN-100': 'planned', 'PAN-200': 'planned' },
    );

    await advanceMergeQueue(deps, 'pan');

    expect(queue).toEqual([]);
    expect(triggered).toEqual([]);
  });

  it('never turns an entry into a strike landing that skips the gate (#4016)', async () => {
    // PAN-400 has a pushed strike branch whose PR has red checks. The queue
    // used to see `origin/strike/pan-400` and land it without asking the gate;
    // now the entry is judged like any other and the red PR is dropped.
    const { deps, queue, triggered, warnings } = harness(
      ['PAN-400'],
      { 'PAN-400': 'in-review' },
    );

    await advanceMergeQueue(deps, 'pan');

    expect(triggered).toEqual([]);
    expect(queue).toEqual([]);
    expect(warnings.join('\n')).toContain('Dropped PAN-400 from the pan merge queue');
  });

  it('triggers a ready entry as a normal merge, with no strike request', async () => {
    const { deps, triggered } = harness(['PAN-400'], { 'PAN-400': 'ready' });

    await advanceMergeQueue(deps, 'pan');

    expect(triggered).toEqual([['PAN-400', undefined]]);
  });

  it('drops a ready entry the forge-facts merge gate refuses and starts the next one', async () => {
    const { deps, queue, triggered, warnings } = harness(
      ['PAN-500', 'PAN-600'],
      { 'PAN-500': 'ready', 'PAN-600': 'ready' },
      { 'PAN-500': { ready: false, reason: 'browser UAT failed on PR HEAD abc1234' } },
    );

    await advanceMergeQueue(deps, 'pan');

    expect(triggered).toEqual([['PAN-600', undefined]]);
    expect(queue).toEqual(['PAN-600']);
    expect(warnings.join('\n')).toContain('Dropped PAN-500 from the pan merge queue: Cannot merge: browser UAT failed on PR HEAD abc1234');
  });

  it('terminates when the queue keeps handing back the same unstartable entry', async () => {
    const dequeue = vi.fn(() => 'PAN-100');
    await advanceMergeQueue(
      {
        dequeue,
        getDerivedState: async (issueId) => derived(issueId, 'planned'),
        checkMergeGate: async () => ({ ready: false, reason: 'no pull request for this issue' }),
        triggerMerge: async () => ({}),
        log: () => {},
        warn: () => {},
      },
      'pan',
    );

    expect(dequeue).toHaveBeenCalledTimes(2);
  });
});

describe('mergeGateRefusal', () => {
  it('lets a ready gate through', () => {
    expect(mergeGateRefusal({ ready: true, facts: { headBranch: 'feature/pan-1' } })).toBeNull();
  });

  it('refuses with the gate reason', () => {
    expect(mergeGateRefusal({ ready: false, reason: 'CI checks failing on PR HEAD abc' })).toEqual({
      success: false,
      statusCode: 400,
      error: 'Cannot merge: CI checks failing on PR HEAD abc',
    });
  });

  it('refuses a strike landing gated on some other PR than strike/<issue> (#4016)', () => {
    const refusal = mergeGateRefusal({ ready: true, facts: { headBranch: 'feature/pan-400' } }, 'strike/pan-400');
    expect(refusal?.error).toBe('Cannot merge: the open pull request is on feature/pan-400, not strike/pan-400');
  });

  it('refuses a strike whose own PR has red checks (#4016)', () => {
    const refusal = mergeGateRefusal(
      { ready: false, reason: 'CI checks failing on PR HEAD def5678', facts: { headBranch: 'strike/pan-400' } },
      'strike/pan-400',
    );
    expect(refusal?.error).toBe('Cannot merge: CI checks failing on PR HEAD def5678');
  });

  it('refuses an automatic merge whose PR head moved off the scheduled one (#3983)', () => {
    const verdict = { ready: true, facts: { headBranch: 'feature/pan-1', headSha: 'bbbbbbbbbbbbbbbb' } };
    expect(mergeGateRefusal(verdict, undefined, 'aaaaaaaaaaaaaaaa')).toEqual({
      success: false,
      statusCode: 409,
      error: 'Cannot merge: the PR head is bbbbbbbbbbbb, not aaaaaaaaaaaa as scheduled',
    });
    expect(mergeGateRefusal(verdict, undefined, 'bbbbbbbbbbbbbbbb')).toBeNull();
  });
});

describe('forgeMergeGateRefusal (#3983)', () => {
  it('asks the one gate, and holds an automatic merge to its scheduled head', async () => {
    const gate = vi.fn(async () => ({ ready: true, facts: { headBranch: 'feature/pan-1', headSha: 'aaaaaaaa' } }));
    await expect(forgeMergeGateRefusal('PAN-1', { kind: 'normal', expectedHeadSha: 'aaaaaaaa' }, gate)).resolves.toBeNull();
    // #4066 review: bound to the feature PR, which also skips the facts cache.
    expect(gate).toHaveBeenCalledWith('PAN-1', { preferBranch: 'feature/pan-1' });
    await expect(forgeMergeGateRefusal('PAN-1', { kind: 'normal', expectedHeadSha: 'bbbbbbbb' }, gate))
      .resolves.toEqual(expect.objectContaining({ statusCode: 409 }));
  });

  it('judges the manual Merge button by the same gate', async () => {
    const gate = vi.fn(async () => ({ ready: false, reason: 'PR is not approved at PR HEAD aaaaaaaa', facts: { headBranch: 'feature/pan-1' } }));
    await expect(forgeMergeGateRefusal('PAN-1', { kind: 'normal' }, gate))
      .resolves.toEqual(expect.objectContaining({ error: 'Cannot merge: PR is not approved at PR HEAD aaaaaaaa' }));
    expect(gate).toHaveBeenCalledWith('PAN-1', { preferBranch: 'feature/pan-1' });
  });

  // #4066 review: an approved strike PR must not stand in for the feature PR
  // a normal merge lands.
  it('refuses a normal merge whose gate passed a strike PR', async () => {
    const gate = vi.fn(async () => ({ ready: true, facts: { headBranch: 'strike/pan-1', headSha: 'aaaaaaaa' } }));
    await expect(forgeMergeGateRefusal('PAN-1', { kind: 'normal' }, gate))
      .resolves.toEqual(expect.objectContaining({ error: 'Cannot merge: the open pull request is on strike/pan-1, not feature/pan-1' }));
  });
});

describe('mergeTargetRefusal (#4066 review)', () => {
  const url = 'https://github.com/eltmon/overdeck/pull/1';
  it('lets through the PR the gate passed', () => {
    expect(mergeTargetRefusal({ headBranch: 'feature/pan-1', url }, `${url}/`)).toBeNull();
  });

  it('refuses any other PR, or none', () => {
    expect(mergeTargetRefusal({ headBranch: 'feature/pan-1', url }, 'https://github.com/eltmon/overdeck/pull/2'))
      .toEqual(expect.objectContaining({ statusCode: 409 }));
    expect(mergeTargetRefusal({ headBranch: 'feature/pan-1', url: null }, url))
      .toEqual(expect.objectContaining({ statusCode: 409 }));
  });
});

describe('automaticMergePin (#3983)', () => {
  it('pins nothing for a manual merge', () => {
    expect(automaticMergePin({ kind: 'normal' }, 'abc1234')).toEqual({});
  });

  it('pins a remote merge to the scheduled head', () => {
    expect(automaticMergePin({ kind: 'normal', expectedHeadSha: 'abc1234' })).toEqual({ matchHeadCommit: 'abc1234' });
  });

  it("pins a local merge to the commit the server verified (its rebase of the approved head)", () => {
    expect(automaticMergePin({ kind: 'normal', expectedHeadSha: 'abc1234' }, 'def5678')).toEqual({ matchHeadCommit: 'def5678' });
  });
});

describe('automaticMergeStartRefusal (#4066 review)', () => {
  const approved = 'a'.repeat(40);
  const git = (heads: Record<string, string>) => vi.fn(async (args: string[]) => {
    if (args[0] === 'fetch') return '';
    return heads[args[1] ?? ''] ?? '';
  });

  it('on the direct path, starts only from the approved PR head', async () => {
    await expect(automaticMergeStartRefusal(approved, approved, '/ws', 'feature/pan-1')).resolves.toBeNull();
    await expect(automaticMergeStartRefusal(approved, 'b'.repeat(40), '/ws', 'feature/pan-1'))
      .resolves.toContain('not the approved head');
  });

  it('before a rebase, needs the worktree and the PR branch both at the approved head', async () => {
    await expect(automaticMergeStartRefusal(approved, null, '/ws', 'feature/pan-1',
      git({ HEAD: approved, 'origin/feature/pan-1': approved }))).resolves.toBeNull();
    await expect(automaticMergeStartRefusal(approved, null, '/ws', 'feature/pan-1',
      git({ HEAD: 'c'.repeat(40), 'origin/feature/pan-1': approved }))).resolves.toContain('worktree HEAD');
    await expect(automaticMergeStartRefusal(approved, null, '/ws', 'feature/pan-1',
      git({ HEAD: approved, 'origin/feature/pan-1': 'd'.repeat(40) }))).resolves.toContain('PR branch is at');
  });
});

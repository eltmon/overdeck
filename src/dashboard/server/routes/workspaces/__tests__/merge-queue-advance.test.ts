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
  clearYieldForResumeSync: vi.fn(),
  decideResumeGate: vi.fn(() => ({ decision: 'proceed' })),
  getAgentResumeGateBlockReason: vi.fn(() => null),
  getAgentStateSync: vi.fn(() => null),
  saveAgentStateSync: vi.fn(),
}));
// config-yaml's defaults pull tier-table, which still imports the record plane
// W3 is deleting. Only the default tiered-execution block is needed here.
vi.mock('../../../../../lib/agents/tier-table.js', () => ({
  DEFAULT_TIERED_EXECUTION_CONFIG: { enabled: false, tiers: [], subscription: 'all' },
}));
vi.mock('../../../../../lib/work-agent-lifecycle.js', () => ({
  getWorkAgentLifecycleStateSync: vi.fn(() => ({ hasLiveTmuxSession: false, canResumeSession: false, canStartFresh: false })),
}));

const { advanceMergeQueue } = await import('../merge-strike.js');
type MergeQueueAdvanceDeps = Parameters<typeof advanceMergeQueue>[0];

/**
 * PAN-3328: the merge queue must not be able to wedge behind an entry that
 * `triggerMerge()` would bounce before it claims the queue. These tests lock the
 * drain: unstartable heads are removed, the first startable entry is triggered,
 * and the walk always terminates.
 *
 * PAN-3917: startability is now the forge's answer — `DerivedIssueState.state`
 * is `ready` only when the PR is approved, green, and mergeable.
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
  strikeHeads: Record<string, string> = {},
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
    getProjectPath: () => '/projects/overdeck',
    getStrikeHead: async (issueId) => strikeHeads[issueId] ?? null,
    triggerMerge: async (issueId, request) => {
      triggered.push([issueId, request]);
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
    expect(warnings.join('\n')).toContain('no open pull request for this issue');
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

  it('passes a strike request through without consulting normal merge eligibility', async () => {
    const { deps, triggered } = harness(
      ['PAN-400'],
      // A strike landing is never `ready` on its own PR — git's pushed
      // strike branch is the signal, so it must not be dropped as unstartable.
      { 'PAN-400': 'working' },
      { 'PAN-400': 'abc123' },
    );

    await advanceMergeQueue(deps, 'pan');

    expect(triggered).toEqual([[
      'PAN-400',
      {
        kind: 'strike',
        markerHead: 'abc123',
        workspacePath: '/projects/overdeck/workspaces/feature-pan-400-strike',
        branchName: 'strike/pan-400',
        recoveryTarget: 'strike-pan-400',
      },
    ]]);
  });

  it('terminates when the queue keeps handing back the same unstartable entry', async () => {
    const dequeue = vi.fn(() => 'PAN-100');
    await advanceMergeQueue(
      {
        dequeue,
        getDerivedState: async (issueId) => derived(issueId, 'planned'),
        getProjectPath: () => '/projects/overdeck',
        getStrikeHead: async () => null,
        triggerMerge: async () => ({}),
        log: () => {},
        warn: () => {},
      },
      'pan',
    );

    expect(dequeue).toHaveBeenCalledTimes(2);
  });
});

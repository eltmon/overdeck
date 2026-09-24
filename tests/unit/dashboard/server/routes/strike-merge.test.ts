import { describe, expect, it, vi } from 'vitest';
import type { DerivedIssueState, IssueState, PrChecksState, PrReviewState } from '@overdeck/contracts';

// merge-strike pulls in lib/agents for the rebase-escalation path, which still
// reaches the record plane W3 is deleting. These tests exercise pure helpers.
vi.mock('../../../../../src/lib/agents.js', () => ({
  getAgentState: vi.fn(), messageAgent: vi.fn(), spawnAgent: vi.fn(),
}));
vi.mock('../../../../../src/lib/agents/agent-state.js', () => ({
  clearYieldForResume: vi.fn(),
  decideResumeGate: vi.fn(() => ({ decision: 'proceed' })),
  getAgentResumeGateBlockReason: vi.fn(() => null),
  getAgentState: vi.fn(() => null),
  saveAgentStateSync: vi.fn(),
}));
vi.mock('../../../../../src/lib/work-agent-lifecycle.js', () => ({
  getWorkAgentLifecycleStateSync: vi.fn(() => ({ hasLiveTmuxSession: false, canResumeSession: false, canStartFresh: false })),
}));
vi.mock('../../../../../src/lib/agents/tier-table.js', () => ({
  DEFAULT_TIERED_EXECUTION_CONFIG: { enabled: false, tiers: [], subscription: 'all' },
}));

const {
  activeStrikeMerge,
  forgeMergeGateRefusal,
  mergeVerificationOptions,
  normalMergeEligibility,
  validateStrikeMergeRequest,
} = await import('../../../../../src/dashboard/server/routes/workspaces/merge-strike.js');
type StrikeMergeRequest = Parameters<typeof validateStrikeMergeRequest>[1];

const markerHead = 'a'.repeat(40);
const projectPath = '/repo';
const workspacePath = '/repo/workspaces/feature-pan-2702-strike';
const request: StrikeMergeRequest = {
  kind: 'strike', markerHead, workspacePath,
  branchName: 'strike/pan-2702', recoveryTarget: 'strike-pan-2702',
};

/** A derived state with a PR in the given shape. */
function derived(
  state: IssueState,
  pr?: { reviewState: PrReviewState; checks: PrChecksState; mergeable: boolean | null },
): DerivedIssueState {
  return {
    issueId: 'PAN-2702',
    state,
    ...(pr ? { pr: { url: 'https://github.com/o/r/pull/9', number: 9, ...pr } } : {}),
  };
}

function git(remoteHead = markerHead) {
  return vi.fn(async (args: string[]) => {
    const command = args.join(' ');
    if (command === 'rev-parse --show-toplevel') return workspacePath;
    if (command === 'branch --show-current') return 'strike/pan-2702';
    if (command === 'fetch origin strike/pan-2702') return '';
    if (command === 'rev-parse origin/strike/pan-2702') return remoteHead;
    throw new Error(`unexpected git command: ${command}`);
  });
}

describe('strike merge-door eligibility', () => {
  it('skips only the nonexistent strike checklist during merge verification', () => {
    expect(mergeVerificationOptions(request)).toEqual({
      syncTargetBranch: false,
      skipPlanChecklist: true,
    });
    expect(mergeVerificationOptions({ kind: 'normal' })).toEqual({
      syncTargetBranch: false,
    });
  });

  it('rejects duplicate active strike pipelines at the merge door', () => {
    expect(activeStrikeMerge('PAN-2702')).toBe(true);
    expect(activeStrikeMerge(null, { type: 'merge', status: 'running' })).toBe(true);
    expect(activeStrikeMerge(null, { type: 'merge', status: 'completed' })).toBe(false);
  });

  it('accepts the authenticated durable marker (git identity; the forge gate runs separately)', async () => {
    await expect(validateStrikeMergeRequest('PAN-2702', request, { projectPath, git: git() })).resolves.toBeNull();
  });

  it('rejects a stale marker before merge work starts and names both HEADs', async () => {
    const newHead = 'b'.repeat(40);
    const result = await validateStrikeMergeRequest('PAN-2702', request, { projectPath, git: git(newHead) });
    expect(result).toContain(markerHead);
    expect(result).toContain(newHead);
  });

  it.each([
    ['wrong workspace', { ...request, workspacePath: '/repo/workspaces/feature-pan-2702' }],
    ['wrong branch', { ...request, branchName: 'feature/pan-2702' }],
    ['wrong recovery target', { ...request, recoveryTarget: 'agent-pan-2702' }],
  ])('rejects %s identity', async (_label, invalidRequest) => {
    await expect(validateStrikeMergeRequest('PAN-2702', invalidRequest as StrikeMergeRequest, { projectPath, git: git() })).resolves.toMatch(/identity/);
  });
});

// #4016: git still owns the strike's identity (the pushed `strike/<issue>`
// HEAD, checked by validateStrikeMergeRequest above), but readiness to land is
// the strike PR's own forge facts through the one merge gate — approval, green
// checks — never a bypass. The merge queue no longer reads strike branches at
// all (merge-queue-advance.test.ts).
describe('strike readiness is its own PR through the merge gate (#4016)', () => {
  const strikePr = (ready: boolean, reason?: string, headBranch = 'strike/pan-2702') => vi.fn(async () => ({
    ready,
    ...(reason ? { reason } : {}),
    facts: { headBranch },
  }));

  it('lands a strike whose own PR is approved and green', async () => {
    const gate = strikePr(true);
    await expect(forgeMergeGateRefusal('PAN-2702', request.branchName, gate)).resolves.toBeNull();
    expect(gate).toHaveBeenCalledWith('PAN-2702', { preferBranch: 'strike/pan-2702' });
  });

  it('refuses a strike whose own PR has red checks', async () => {
    const gate = strikePr(false, `CI checks failing on PR HEAD ${markerHead}`);
    await expect(forgeMergeGateRefusal('PAN-2702', request.branchName, gate)).resolves.toEqual({
      success: false,
      statusCode: 400,
      error: `Cannot merge: CI checks failing on PR HEAD ${markerHead}`,
    });
  });

  it('refuses a strike whose own PR is not approved', async () => {
    const gate = strikePr(false, 'PR is not approved');
    await expect(forgeMergeGateRefusal('PAN-2702', request.branchName, gate))
      .resolves.toEqual(expect.objectContaining({ error: 'Cannot merge: PR is not approved' }));
  });

  it('refuses when the ready PR the forge reports is the feature PR, not the strike PR', async () => {
    const gate = strikePr(true, undefined, 'feature/pan-2702');
    await expect(forgeMergeGateRefusal('PAN-2702', request.branchName, gate)).resolves.toEqual(expect.objectContaining({
      error: 'Cannot merge: the open pull request is on feature/pan-2702, not strike/pan-2702',
    }));
  });
});

describe('normal merge-door no-loss matrix', () => {
  it.each([
    ['no derived state at all', null, false, 'Cannot merge: no open pull request for this issue'],
    ['no pull request', derived('planned'), false, 'Cannot merge: no open pull request for this issue'],
    ['changes requested', derived('changes-requested', { reviewState: 'changes-requested', checks: 'green', mergeable: true }), false, 'Cannot merge: the latest review requested changes'],
    ['not approved', derived('in-review', { reviewState: 'review-requested', checks: 'green', mergeable: true }), false, 'Cannot merge: the pull request is not approved yet'],
    ['checks failing', derived('in-review', { reviewState: 'approved', checks: 'red', mergeable: true }), false, 'Cannot merge: checks are failing'],
    ['checks pending', derived('in-review', { reviewState: 'approved', checks: 'pending', mergeable: true }), false, 'Cannot merge: checks have not finished'],
    ['conflicting', derived('in-review', { reviewState: 'approved', checks: 'green', mergeable: false }), false, 'Cannot merge: the forge reports the pull request as conflicting'],
    ['already merged', derived('merged'), false, 'Already merged'],
  ])('preserves %s rejection', (_label, state, activelyMerging, error) => {
    expect(normalMergeEligibility(state, activelyMerging)).toMatchObject({ success: false, statusCode: 400, error });
  });

  it('rejects a merge that is already running', () => {
    const ready = derived('ready', { reviewState: 'approved', checks: 'green', mergeable: true });
    expect(normalMergeEligibility(ready, true, { phase: 'merging' })).toMatchObject({
      success: false, statusCode: 400, error: 'Merge already in progress',
    });
  });

  it.each([
    ['no run in flight', undefined],
    ['a queued run', { phase: 'queued' as const }],
    ['a stale merging run that is not actively merging', { phase: 'merging' as const }],
  ])('lets an approved, green, mergeable PR through with %s', (_label, run) => {
    const ready = derived('ready', { reviewState: 'approved', checks: 'green', mergeable: true });
    expect(normalMergeEligibility(ready, false, run)).toBeNull();
  });
});

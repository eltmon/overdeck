import { describe, expect, it, vi } from 'vitest';

// merge-strike pulls in lib/agents for the rebase-escalation path. These tests
// exercise the gate request only, so the agent surface is stubbed (as in
// merge-queue-advance.test.ts).
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
vi.mock('../../../../../lib/agents/tier-table.js', () => ({
  DEFAULT_TIERED_EXECUTION_CONFIG: { enabled: false, tiers: [], subscription: 'all' },
}));
vi.mock('../../../../../lib/work-agent-lifecycle.js', () => ({
  getWorkAgentLifecycleState: vi.fn(() => ({ hasLiveTmuxSession: false, canResumeSession: false, canStartFresh: false })),
}));

const { busyMergeRefusal, forgeMergeGate, manualMergeHeadMoved, mergeHeadPin, requiresHeadApproval } = await import('../merge-strike.js');
type TriggerMergeRequest = Parameters<typeof requiresHeadApproval>[0];

const strike = (extra: Partial<Extract<TriggerMergeRequest, { kind: 'strike' }>> = {}): TriggerMergeRequest => ({
  kind: 'strike',
  markerHead: 'aaaaaaaa',
  workspacePath: '/p/workspaces/feature-pan-9-strike',
  branchName: 'strike/pan-9',
  recoveryTarget: 'strike-pan-9',
  ...extra,
});

/**
 * PAN-4750: a strike PR is authored as the operator, who cannot approve it on
 * GitHub. Only the operator's own Merge click on a strike skips the
 * head-approval rule; every automatic merge and every feature merge keeps it.
 */
describe('requiresHeadApproval (PAN-4750)', () => {
  it('waives head approval only for an operator-started strike', () => {
    expect(requiresHeadApproval(strike({ operatorStarted: true }))).toBe(false);
    expect(requiresHeadApproval(strike())).toBe(true);
    expect(requiresHeadApproval(strike({ operatorStarted: true, expectedHeadSha: 'aaaaaaaa' }))).toBe(true);
    expect(requiresHeadApproval(strike({ expectedHeadSha: 'aaaaaaaa' }))).toBe(true);
    expect(requiresHeadApproval({ kind: 'normal' })).toBe(true);
    expect(requiresHeadApproval({ kind: 'normal', expectedHeadSha: 'aaaaaaaa' })).toBe(true);
  });
});

describe('forgeMergeGate approval option (PAN-4750)', () => {
  const ready = { ready: true, facts: { headBranch: 'strike/pan-9', headSha: 'aaaaaaaa' } };

  it('passes requireApprovalAtHead: false only for the operator strike, gated on its strike branch', async () => {
    const gate = vi.fn(async () => ready);
    await expect(forgeMergeGate('PAN-9', strike({ operatorStarted: true }), gate))
      .resolves.toEqual(expect.objectContaining({ refusal: null }));
    expect(gate).toHaveBeenCalledWith('PAN-9', { preferBranch: 'strike/pan-9', requireApprovalAtHead: false });
  });

  it('keeps the default (approval required) for an automatic strike and for feature merges', async () => {
    const gate = vi.fn(async () => ready);
    await forgeMergeGate('PAN-9', strike({ operatorStarted: true, expectedHeadSha: 'aaaaaaaa' }), gate);
    expect(gate).toHaveBeenLastCalledWith('PAN-9', { preferBranch: 'strike/pan-9' });

    const featureGate = vi.fn(async () => ({ ready: true, facts: { headBranch: 'feature/pan-9', headSha: 'aaaaaaaa' } }));
    await forgeMergeGate('PAN-9', { kind: 'normal' }, featureGate);
    await forgeMergeGate('PAN-9', { kind: 'normal', expectedHeadSha: 'aaaaaaaa' }, featureGate);
    for (const call of featureGate.mock.calls) expect(call).toEqual(['PAN-9', { preferBranch: 'feature/pan-9' }]);
  });

  it('refuses an operator strike the gate refuses', async () => {
    const gate = vi.fn(async () => ({ ready: false, reason: 'latest review requested changes', facts: { headBranch: 'strike/pan-9' } }));
    const { refusal } = await forgeMergeGate('PAN-9', strike({ operatorStarted: true }), gate);
    expect(refusal).toEqual(expect.objectContaining({ success: false, error: 'Cannot merge: latest review requested changes' }));
  });

  // PAN-4750 review (CodeRabbit): a push to strike/<issue> after the gate
  // passed must fail the merge, never land code the gate did not judge.
  it('pins an operator strike to the head it lands, like any manual merge', () => {
    expect(mergeHeadPin(strike({ operatorStarted: true }), 'aaaaaaaa')).toEqual({ matchHeadCommit: 'aaaaaaaa' });
    expect(mergeHeadPin(strike({ operatorStarted: true }), null)).toEqual({});
    expect(mergeHeadPin(strike({ expectedHeadSha: 'aaaaaaaa' }), 'bbbbbbbb')).toEqual({ matchHeadCommit: 'bbbbbbbb' });
  });

  it('refuses an operator strike whose PR head moved after the gate passed', () => {
    expect(manualMergeHeadMoved(strike({ operatorStarted: true }), 'aaaaaaaa', 'aaaaaaaa')).toBeNull();
    expect(manualMergeHeadMoved(strike({ operatorStarted: true }), 'aaaaaaaa', 'cccccccc'))
      .toContain('the PR head moved to cccccccc after the merge gate passed aaaaaaaa');
  });
});

describe('busyMergeRefusal (PAN-4750)', () => {
  it('lets a manual feature merge wait on the queue', () => {
    expect(busyMergeRefusal({ kind: 'normal' }, 'PAN-1', 'PAN-9')).toBeNull();
  });

  it('refuses a strike while another merge holds the slot, since the queue would replay it as a feature merge', () => {
    expect(busyMergeRefusal(strike({ operatorStarted: true }), 'PAN-1', 'PAN-9'))
      .toEqual(expect.objectContaining({ success: false, statusCode: 409, error: expect.stringContaining('Another merge (PAN-1)') }));
  });

  it('defers an automatic merge to the executor', () => {
    expect(busyMergeRefusal({ kind: 'normal', expectedHeadSha: 'aaaaaaaa' }, 'PAN-1', 'PAN-9'))
      .toEqual(expect.objectContaining({ statusCode: 409, deferred: true }));
  });

  it('answers nothing when the slot is free or held by this issue', () => {
    expect(busyMergeRefusal(strike({ operatorStarted: true }), null, 'PAN-9')).toBeNull();
    expect(busyMergeRefusal(strike({ operatorStarted: true }), 'PAN-9', 'PAN-9')).toBeNull();
  });
});

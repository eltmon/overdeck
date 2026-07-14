import { describe, expect, it, vi } from 'vitest';
import { fireTieredCommitHooks, type FireTieredCommitHooksDeps } from '../swarm-tiered-hooks.js';
import type { ValidatedTieredExecutionConfig } from '../../agents/tier-table.js';
import type { VBriefDocument, VBriefItem } from '../../vbrief/types.js';

const ISSUE_ID = 'PAN-2385';
const WORKSPACE = '/workspace/feature-pan-2385';
const SHA = 'abc1234def5678';

function tieredConfig(overrides: Partial<ValidatedTieredExecutionConfig> = {}): ValidatedTieredExecutionConfig {
  return {
    enabled: true,
    tiers: {
      cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple'] },
      standard: { model: 'gpt-5.5', harness: 'codex', difficulties: ['medium', 'complex', 'expert'] },
    },
    difficultyToTier: {
      trivial: 'cheap',
      simple: 'cheap',
      medium: 'standard',
      complex: 'standard',
      expert: 'standard',
    },
    byKind: {},
    feed: { callouts: 'off', exclude: [], exclude_subjects: [], max_diff_bytes: null },
    supervisor: { model: 'claude-sonnet-5', harness: 'claude-code', subscribe: 'all' },
    escalation: { enabled: false, retries_at_tier: 0, max_promotions: 0, flounder_budget_minutes: {} },
    compaction_reroute: 'off',
    replay_threshold: 0.5,
    ...overrides,
  } as ValidatedTieredExecutionConfig;
}

function fixtureItem(id: string, difficulty: 'simple' | 'medium', requiresInspection = false): VBriefItem {
  return {
    id,
    title: `${id} title`,
    status: 'pending',
    metadata: { difficulty, requiresInspection },
    items: [],
  } as unknown as VBriefItem;
}

function fixtureDoc(items: VBriefItem[], metadata: Record<string, unknown> = {}): VBriefDocument {
  return {
    plan: { id: ISSUE_ID.toLowerCase(), title: ISSUE_ID, status: 'running', items, metadata },
  } as unknown as VBriefDocument;
}

function makeDeps(config: ValidatedTieredExecutionConfig | undefined, overrides: Partial<FireTieredCommitHooksDeps> = {}): {
  deps: FireTieredCommitHooksDeps;
  broadcast: ReturnType<typeof vi.fn>;
  deliverReview: ReturnType<typeof vi.fn>;
  ensureSupervisor: ReturnType<typeof vi.fn>;
} {
  const broadcast = vi.fn(async (options: { tiers: Array<{ tierName: string; agentId: string }> }) =>
    options.tiers.map((tier) => ({ tierName: tier.tierName, agentId: tier.agentId, result: { ok: true, path: 'supervisor' } })));
  const deliverReview = vi.fn(async () => ({ ok: true, path: 'supervisor' }));
  const ensureSupervisor = vi.fn(async () => undefined);
  const deps: FireTieredCommitHooksDeps = {
    loadConfig: (() => ({ config: { tieredExecution: config } })) as unknown as FireTieredCommitHooksDeps['loadConfig'],
    getHeadSha: async () => SHA,
    listAssignments: (() => [
      { slotIndex: 1, itemId: 'task-a', agentId: 'agent-pan-2385-slot-1', branch: 'feature/pan-2385-slot-1' },
      { slotIndex: 2, itemId: 'task-b', agentId: 'agent-pan-2385-slot-2', branch: 'feature/pan-2385-slot-2' },
    ]) as unknown as FireTieredCommitHooksDeps['listAssignments'],
    isSessionAlive: async () => true,
    broadcast: broadcast as unknown as FireTieredCommitHooksDeps['broadcast'],
    ensureSupervisor: ensureSupervisor as unknown as FireTieredCommitHooksDeps['ensureSupervisor'],
    deliverReview: deliverReview as unknown as FireTieredCommitHooksDeps['deliverReview'],
    loadPrd: async () => undefined,
    ...overrides,
  };
  return { deps, broadcast, deliverReview, ensureSupervisor };
}

describe('fireTieredCommitHooks (PAN-2385 ignition)', () => {
  it('enabled tiered execution + merged commit produces feed deliveries AND a supervisor review', async () => {
    const itemA = fixtureItem('task-a', 'simple');
    const itemB = fixtureItem('task-b', 'medium');
    const { deps, broadcast, deliverReview } = makeDeps(tieredConfig());

    const actions = await fireTieredCommitHooks(
      { issueId: ISSUE_ID, workspacePath: WORKSPACE, item: itemA, doc: fixtureDoc([itemA, itemB]) },
      deps,
    );

    // The PAN-2385 acceptance: a commit under enabled tiered execution must
    // never produce zero feed deliveries.
    expect(broadcast).toHaveBeenCalledTimes(1);
    const call = broadcast.mock.calls[0][0] as { tiers: Array<{ tierName: string; agentId: string }>; sha: string };
    expect(call.sha).toBe(SHA);
    expect(call.tiers.map((tier) => tier.agentId)).toEqual(['agent-pan-2385-slot-1', 'agent-pan-2385-slot-2']);
    expect(call.tiers.map((tier) => tier.tierName)).toEqual(['cheap', 'standard']);

    expect(deliverReview).toHaveBeenCalledTimes(1);
    expect(actions.some((line) => line.includes('broadcast commit'))).toBe(true);
    expect(actions.some((line) => line.includes('supervisor review dispatched'))).toBe(true);
  });

  it('does nothing when tiered execution is disabled and no plan override', async () => {
    const item = fixtureItem('task-a', 'simple');
    const { deps, broadcast, deliverReview } = makeDeps(tieredConfig({ enabled: false }));

    const actions = await fireTieredCommitHooks(
      { issueId: ISSUE_ID, workspacePath: WORKSPACE, item, doc: fixtureDoc([item]) },
      deps,
    );

    expect(broadcast).not.toHaveBeenCalled();
    expect(deliverReview).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });

  it('honors the per-issue plan.metadata override over a disabled global flag', async () => {
    const item = fixtureItem('task-a', 'simple');
    const { deps, broadcast } = makeDeps(tieredConfig({ enabled: false }));

    await fireTieredCommitHooks(
      { issueId: ISSUE_ID, workspacePath: WORKSPACE, item, doc: fixtureDoc([item], { tiered_execution: 'on' }) },
      deps,
    );

    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it('subscribe=flagged skips the supervisor for unflagged tasks but still broadcasts', async () => {
    const item = fixtureItem('task-a', 'simple', false);
    const config = tieredConfig();
    config.supervisor = { ...config.supervisor!, subscribe: 'flagged' };
    const { deps, broadcast, deliverReview } = makeDeps(config);

    await fireTieredCommitHooks(
      { issueId: ISSUE_ID, workspacePath: WORKSPACE, item, doc: fixtureDoc([item]) },
      deps,
    );

    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(deliverReview).not.toHaveBeenCalled();
  });

  it('spawns the supervisor when its session is missing', async () => {
    const item = fixtureItem('task-a', 'simple');
    const { deps, ensureSupervisor, deliverReview } = makeDeps(tieredConfig(), {
      // slots dead (no broadcast listeners), supervisor session missing too
      isSessionAlive: async () => false,
    });

    const actions = await fireTieredCommitHooks(
      { issueId: ISSUE_ID, workspacePath: WORKSPACE, item, doc: fixtureDoc([item]) },
      deps,
    );

    expect(ensureSupervisor).toHaveBeenCalledTimes(1);
    expect(deliverReview).toHaveBeenCalledTimes(1);
    expect(actions.some((line) => line.includes('spawned standing supervisor'))).toBe(true);
  });

  it('a broadcast failure never blocks the supervisor review and never throws', async () => {
    const item = fixtureItem('task-a', 'simple');
    const { deps, deliverReview } = makeDeps(tieredConfig(), {
      broadcast: (async () => { throw new Error('feed exploded'); }) as unknown as FireTieredCommitHooksDeps['broadcast'],
    });

    const actions = await fireTieredCommitHooks(
      { issueId: ISSUE_ID, workspacePath: WORKSPACE, item, doc: fixtureDoc([item]) },
      deps,
    );

    expect(actions.some((line) => line.includes('feed broadcast FAILED'))).toBe(true);
    expect(deliverReview).toHaveBeenCalledTimes(1);
  });
});

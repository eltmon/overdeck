import { describe, expect, it, vi } from 'vitest';
import type { VBriefDocument, VBriefItem } from '../../vbrief/types.js';
import type { AgentState } from '../agent-state.js';
import type { DeliveryResult } from '../delivery.js';
import {
  compactAtTierRunBoundary,
  replayCrashedStandingAgent,
  shouldReplayCompactAtTierRunBoundary,
} from '../tier-replay.js';
import { broadcastCommit } from '../tier-feed.js';
import { validateTieredExecutionConfig, type ValidatedTieredExecutionConfig, type ValidatedTieredExecutionFeedConfig } from '../tier-table.js';
import type { TieredExecutionSupervisorConfig } from '../tier-table.js';

function item(id: string, title = id, requiresInspection = false): VBriefItem {
  return {
    id,
    title,
    status: 'pending',
    metadata: { requiresInspection },
    items: [
      {
        id: `${id}.ac1`,
        title: `${title} acceptance`,
        status: 'pending',
        metadata: { kind: 'acceptance_criterion' },
      },
    ],
  };
}

function tierItem(id: string, difficulty: NonNullable<VBriefItem['metadata']>['difficulty'], status: VBriefItem['status'] = 'pending'): VBriefItem {
  return {
    id,
    title: id,
    status,
    metadata: { difficulty },
  };
}

function doc(items: VBriefItem[]): VBriefDocument {
  return {
    vBRIEFInfo: { version: '0.6', created: '2026-07-02T00:00:00Z' },
    plan: { id: 'plan-1', title: 'plan', status: 'running', items },
  };
}

function deps() {
  const deliveries: Array<{ agentId: string; message: string; caller?: string }> = [];
  const spawn = vi.fn(async (issueId: string, role: string, options: Record<string, unknown>) => ({
    id: options.agentId ?? `agent-${issueId.toLowerCase()}-slot-${options.slotIndex}`,
    issueId,
    workspace: '/ws',
    role,
    model: String(options.model ?? 'claude-sonnet-5'),
    harness: String(options.harness ?? 'claude-code'),
    status: 'running',
    startedAt: '2026-07-02T00:00:00Z',
  } as AgentState));
  const deliver = vi.fn(async (agentId: string, message: string, caller?: string): Promise<DeliveryResult> => {
    deliveries.push({ agentId, message, caller });
    return { ok: true, path: 'tmux' };
  });
  const stop = vi.fn(async () => undefined);
  const gitLog = vi.fn(async () => [
    { sha: '1111111111111111111111111111111111111111', subject: 'bead-a first commit' },
    { sha: '2222222222222222222222222222222222222222', subject: 'bead-b second commit' },
  ]);
  const gitShow = vi.fn(async (_workspace: string, sha: string) => `commit ${sha}\n\ndiff --git a/file.ts b/file.ts\n+${sha}\n`);
  const renderDiff = vi.fn(async (_workspace: string, sha: string) => `commit ${sha}\n\ndiff --git a/file.ts b/file.ts\n+${sha}\n`);
  return { spawn, deliver, stop, gitLog, gitShow, renderDiff, deliveries };
}

function feedConfig(overrides: Partial<ValidatedTieredExecutionFeedConfig> = {}): ValidatedTieredExecutionFeedConfig {
  return {
    callouts: 'off',
    exclude: [],
    exclude_subjects: [],
    max_diff_bytes: null,
    ...overrides,
  };
}

function tierConfig(overrides: Partial<ValidatedTieredExecutionConfig> = {}): ValidatedTieredExecutionConfig {
  return {
    ...validateTieredExecutionConfig({
      enabled: true,
      tiers: {
        cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple'] },
        standard: { model: 'claude-sonnet-5', harness: 'claude-code', difficulties: ['medium', 'complex'] },
        frontier: { model: 'claude-opus-4-8', harness: 'claude-code', difficulties: ['expert'] },
      },
      supervisor: { model: 'claude-opus-4-8', harness: 'claude-code', subscribe: 'flagged' },
      replay_threshold: 0.5,
      compaction_reroute: 'on',
    }),
    ...overrides,
  };
}

describe('tier replay', () => {
  it('respawns a killed standing tier slot and replays git log base..HEAD in order', async () => {
    const seams = deps();

    const result = await replayCrashedStandingAgent({
      kind: 'tier',
      issueId: 'PAN-1791',
      workspace: '/ws',
      base: 'main',
      tierName: 'standard',
      slotIndex: 27,
      slotItemId: 'bead-a',
    }, { deps: seams });

    expect(seams.spawn).toHaveBeenCalledWith('PAN-1791', 'work', {
      slotIndex: 27,
      slotItemId: 'bead-a',
      prompt: undefined,
    });
    expect(seams.gitLog).toHaveBeenCalledWith('/ws', 'main');
    expect(result.agent.id).toBe('agent-pan-1791-slot-27');
    expect(result.commits.map((commit) => commit.sha)).toEqual([
      '1111111111111111111111111111111111111111',
      '2222222222222222222222222222222222222222',
    ]);
    expect(seams.deliver).toHaveBeenCalledTimes(2);
    expect(seams.deliveries.map((delivery) => delivery.caller)).toEqual([
      'tier-replay:tier',
      'tier-replay:tier',
    ]);
    expect(seams.deliveries[0].message).toContain('Commit feed (ingestion-only): 1111111111111111111111111111111111111111');
    expect(seams.deliveries[0].message).toContain('Bead: bead-a first commit');
    expect(seams.deliveries[1].message).toContain('Commit feed (ingestion-only): 2222222222222222222222222222222222222222');
  });

  it('compacts only at a tier-run boundary when threshold is exceeded and never mid-bead', async () => {
    const seams = deps();

    expect(shouldReplayCompactAtTierRunBoundary({
      atRunBoundary: true,
      estimatedContextTokens: 60,
      modelContextWindow: 100,
      replayThreshold: 0.5,
    })).toBe(true);
    expect(shouldReplayCompactAtTierRunBoundary({
      atRunBoundary: false,
      estimatedContextTokens: 90,
      modelContextWindow: 100,
      replayThreshold: 0.5,
    })).toBe(false);
    expect(shouldReplayCompactAtTierRunBoundary({
      atRunBoundary: true,
      inFlightBead: { beadId: 'bead-a', tierName: 'standard', agentId: 'agent-pan-1791-slot-27' },
      estimatedContextTokens: 90,
      modelContextWindow: 100,
      replayThreshold: 0.5,
    })).toBe(false);

    await expect(compactAtTierRunBoundary({
      target: {
        kind: 'tier',
        issueId: 'PAN-1791',
        workspace: '/ws',
        base: 'main',
        agentId: 'agent-pan-1791-slot-27',
        tierName: 'standard',
        slotIndex: 27,
        slotItemId: 'bead-a',
      },
      compaction: {
        atRunBoundary: true,
        estimatedContextTokens: 60,
        modelContextWindow: 100,
        replayThreshold: 0.5,
      },
      deps: seams,
    })).resolves.toMatchObject({ agent: { id: 'agent-pan-1791-slot-27' } });
    expect(seams.stop).toHaveBeenCalledWith('agent-pan-1791-slot-27');

    const before = seams.spawn.mock.calls.length;
    await expect(compactAtTierRunBoundary({
      target: {
        kind: 'tier',
        issueId: 'PAN-1791',
        workspace: '/ws',
        base: 'main',
        agentId: 'agent-pan-1791-slot-27',
        tierName: 'standard',
        slotIndex: 27,
        slotItemId: 'bead-a',
      },
      compaction: {
        atRunBoundary: true,
        inFlightBead: { beadId: 'bead-a', tierName: 'standard', agentId: 'agent-pan-1791-slot-27' },
        estimatedContextTokens: 90,
        modelContextWindow: 100,
        replayThreshold: 0.5,
      },
      deps: seams,
    })).resolves.toBeNull();
    expect(seams.spawn).toHaveBeenCalledTimes(before);
  });

  it('replays the supervisor through the same spawn path and filters history by subscription policy', async () => {
    const seams = deps();
    const supervisor: TieredExecutionSupervisorConfig = {
      model: 'claude-opus-4-8',
      harness: 'claude-code',
      subscribe: 'flagged',
    };

    await replayCrashedStandingAgent({
      kind: 'supervisor',
      issueId: 'PAN-1791',
      workspace: '/ws',
      base: 'main',
      supervisor,
      doc: doc([
        item('bead-a', 'first commit', true),
        item('bead-b', 'second commit', false),
      ]),
      apiUrl: 'http://example.test',
    }, { deps: seams });

    expect(seams.spawn).toHaveBeenCalledWith('PAN-1791', 'review', {
      agentId: 'agent-pan-1791-review-supervisor',
      subRole: 'supervisor',
      model: 'claude-opus-4-8',
      harness: 'claude-code',
      workspace: '/ws',
      prompt: undefined,
    });
    expect(seams.deliver).toHaveBeenCalledTimes(1);
    expect(seams.deliveries[0].agentId).toBe('agent-pan-1791-review-supervisor');
    expect(seams.deliveries[0].caller).toBe('tier-replay:supervisor');
    expect(seams.deliveries[0].message).toContain('SUPERVISOR REVIEW REQUEST');
    expect(seams.deliveries[0].message).toContain('Bead: bead-a');
    expect(seams.deliveries[0].message).not.toContain('bead-b acceptance');
  });

  it('uses the same feed renderer and subject skip for live and replay messages', async () => {
    const config = feedConfig({ callouts: 'notify', exclude_subjects: ['chore(beads):'] });
    const liveDeliveries: Array<{ message: string }> = [];
    const replaySeams = deps();
    const renderDiff = vi.fn(async (_workspace: string, sha: string) => `commit ${sha}\n\ndiff --git a/src/x.ts b/src/x.ts\n+${sha}\n`);

    await broadcastCommit({
      workspace: '/ws',
      issueId: 'PAN-1791',
      apiUrl: 'http://api.test',
      sha: '1111111111111111111111111111111111111111',
      beadTitle: 'bead-a first commit',
      commitSubject: 'bead-a first commit',
      tiers: [{ tierName: 'standard', agentId: 'agent-pan-1791-slot-27' }],
      feedConfig: config,
      renderDiff,
      deliver: vi.fn(async (_agentId: string, message: string): Promise<DeliveryResult> => {
        liveDeliveries.push({ message });
        return { ok: true, path: 'tmux' };
      }),
      recordDelivery: vi.fn(async () => undefined),
    });

    replaySeams.gitLog.mockResolvedValue([
      { sha: 'skip111111111111111111111111111111111111', subject: 'chore(beads): close bead' },
      { sha: '1111111111111111111111111111111111111111', subject: 'bead-a first commit' },
    ]);
    replaySeams.renderDiff = renderDiff;

    const replay = await replayCrashedStandingAgent({
      kind: 'tier',
      issueId: 'PAN-1791',
      workspace: '/ws',
      base: 'main',
      tierName: 'standard',
      slotIndex: 27,
      slotItemId: 'bead-a',
      apiUrl: 'http://api.test',
      feedConfig: config,
    }, { deps: replaySeams });

    expect(replay.commits.map(commit => commit.sha)).toEqual(['1111111111111111111111111111111111111111']);
    expect(replaySeams.deliveries).toHaveLength(1);
    expect(replaySeams.deliveries[0].message).toBe(liveDeliveries[0].message);
    expect(replaySeams.deliveries[0].message).toContain('http://api.test/api/tiered/callouts');
  });

  it('decommissions a tier during compaction and crash replay when reroute removes it from the remaining schedule', async () => {
    const seams = deps();
    const target = {
      kind: 'tier' as const,
      issueId: 'PAN-1791',
      workspace: '/ws',
      base: 'main',
      agentId: 'agent-pan-1791-slot-27',
      tierName: 'standard',
      slotIndex: 27,
      slotItemId: 'bead-a',
      reroute: {
        doc: doc([tierItem('bead-a', 'simple')]),
        config: tierConfig(),
      },
    };

    await expect(compactAtTierRunBoundary({
      target,
      compaction: {
        atRunBoundary: true,
        estimatedContextTokens: 60,
        modelContextWindow: 100,
        replayThreshold: 0.5,
      },
      deps: seams,
    })).resolves.toBeNull();
    expect(seams.stop).toHaveBeenCalledWith('agent-pan-1791-slot-27');
    expect(seams.spawn).not.toHaveBeenCalled();

    const crashSeams = deps();
    await expect(replayCrashedStandingAgent(target, { deps: crashSeams })).resolves.toBeNull();
    expect(crashSeams.spawn).not.toHaveBeenCalled();
  });

  it('respawns with the tier model and harness from the current config when reroute is on', async () => {
    const seams = deps();
    const config = tierConfig({
      tiers: {
        cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple'] },
        standard: { model: 'gpt-5.5', harness: 'codex', difficulties: ['medium', 'complex'] },
        frontier: { model: 'claude-opus-4-8', harness: 'claude-code', difficulties: ['expert'] },
      },
      difficultyToTier: {
        trivial: 'cheap',
        simple: 'cheap',
        medium: 'standard',
        complex: 'standard',
        expert: 'frontier',
      },
    });

    const replay = await replayCrashedStandingAgent({
      kind: 'tier',
      issueId: 'PAN-1791',
      workspace: '/ws',
      base: 'main',
      tierName: 'standard',
      slotIndex: 27,
      slotItemId: 'bead-a',
      reroute: {
        doc: doc([tierItem('bead-a', 'medium')]),
        config,
      },
    }, { deps: seams });

    expect(replay?.agent.model).toBe('gpt-5.5');
    expect(replay?.agent.harness).toBe('codex');
    expect(seams.spawn).toHaveBeenCalledWith('PAN-1791', 'work', {
      slotIndex: 27,
      slotItemId: 'bead-a',
      prompt: undefined,
      model: 'gpt-5.5',
      harness: 'codex',
    });
  });

  it('uses tierOverrides effective difficulty when recomputing remaining reroute schedule', async () => {
    const withoutOverride = deps();
    const target = {
      kind: 'tier' as const,
      issueId: 'PAN-1791',
      workspace: '/ws',
      base: 'main',
      tierName: 'standard',
      slotIndex: 27,
      slotItemId: 'bead-a',
      reroute: {
        doc: doc([tierItem('bead-a', 'simple')]),
        config: tierConfig(),
      },
    };

    await expect(replayCrashedStandingAgent(target, { deps: withoutOverride })).resolves.toBeNull();
    expect(withoutOverride.spawn).not.toHaveBeenCalled();

    const withOverride = deps();
    const replay = await replayCrashedStandingAgent({
      ...target,
      reroute: {
        ...target.reroute,
        tierOverrides: {
          'bead-a': {
            effectiveDifficulty: 'medium',
            promotions: 1,
            history: [{ at: '2026-07-02T00:00:00.000Z', from: 'simple', to: 'medium', reason: 'test' }],
          },
        },
      },
    }, { deps: withOverride });

    expect(replay).not.toBeNull();
    expect(withOverride.spawn).toHaveBeenCalledTimes(1);
  });
});

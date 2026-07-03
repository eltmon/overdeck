import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentState } from '../agent-state.js';
import type { DeliveryResult } from '../delivery.js';
import type { VBriefDifficulty, VBriefDocument, VBriefItem } from '../../vbrief/types.js';
import { autoMergeFastTrackBatch, FAST_TRACK_GATE_COMMANDS, groupFastTrack } from '../fast-track.js';
import { resolveTier, type ResolveTierConfig } from '../resolve-tier.js';
import { computeTierRunSchedule, StandingTierManager, type StandingTierSpawn } from '../standing-tiers.js';
import { broadcastCommit } from '../tier-feed.js';
import {
  deliverCommitForReview,
  shouldHaltDispatch,
  supervisorAgentId,
  type SupervisorVerdict,
} from '../tier-supervisor.js';
import { replayCrashedStandingAgent } from '../tier-replay.js';

const ISSUE_ID = 'PAN-1791';
const WORKSPACE = '/workspace/feature-pan-1791';

const TIER_CONFIG: ResolveTierConfig = {
  tiers: {
    cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple'] },
    standard: { model: 'claude-sonnet-5', harness: 'claude-code', difficulties: ['medium', 'complex'] },
    frontier: { model: 'claude-opus-4-8', harness: 'claude-code', difficulties: ['expert'] },
  },
  difficultyToTier: {
    trivial: 'cheap',
    simple: 'cheap',
    medium: 'standard',
    complex: 'standard',
    expert: 'frontier',
  },
};

function fixtureItem(id: string, difficulty: VBriefDifficulty, filesScope: string[]): VBriefItem {
  return {
    id,
    title: id,
    status: 'pending',
    metadata: {
      difficulty,
      files_scope: filesScope,
      files_scope_confidence: 'high',
      requiresInspection: true,
      traces: ['FR-1'],
    },
    items: [
      {
        id: `${id}.ac1`,
        title: `${id} acceptance criterion is satisfied`,
        status: 'pending',
        metadata: { kind: 'acceptance_criterion' },
      },
    ],
  };
}

function fixturePlan(): VBriefDocument {
  return {
    vBRIEFInfo: { version: '0.6', created: '2026-07-02T00:00:00Z' },
    plan: {
      id: ISSUE_ID,
      title: 'Tiered execution dogfood fixture',
      status: 'running',
      metadata: { tiered_execution: 'on' },
      items: [
        fixtureItem('trivial-docs-a', 'trivial', ['docs/a.md']),
        fixtureItem('trivial-docs-b', 'trivial', ['docs/b.md']),
        fixtureItem('medium-api', 'medium', ['src/api.ts']),
        fixtureItem('expert-orchestrator', 'expert', ['src/orchestrator.ts']),
      ],
      edges: [
        { from: 'trivial-docs-b', to: 'medium-api', type: 'blocks' },
        { from: 'medium-api', to: 'expert-orchestrator', type: 'blocks' },
      ],
    },
  };
}

function fakeSpawn(): {
  spawn: StandingTierSpawn;
  calls: Array<{ issueId: string; role: string; options: Record<string, unknown> }>;
} {
  const calls: Array<{ issueId: string; role: string; options: Record<string, unknown> }> = [];
  const spawn: StandingTierSpawn = vi.fn(async (issueId, role, options) => {
    calls.push({ issueId, role, options: options as Record<string, unknown> });
    return {
      id: `agent-${issueId.toLowerCase()}-slot-${options.slotIndex}`,
      issueId,
      role,
      status: 'running',
      workspace: WORKSPACE,
      startedAt: new Date().toISOString(),
    } as AgentState;
  });
  return { spawn, calls };
}

describe('tiered execution dogfood e2e fixture', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-02T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('routes by difficulty, broadcasts commits, supervises verdicts, halts dependents, fast-tracks trivial batches, and replays killed tiers', async () => {
    const doc = fixturePlan();
    const schedule = computeTierRunSchedule(doc, TIER_CONFIG);
    expect(schedule).toEqual([
      { tierName: 'cheap', beadIds: ['trivial-docs-a', 'trivial-docs-b'] },
      { tierName: 'standard', beadIds: ['medium-api'] },
      { tierName: 'frontier', beadIds: ['expert-orchestrator'] },
    ]);

    const { spawn, calls: spawnCalls } = fakeSpawn();
    const manager = new StandingTierManager({ issueId: ISSUE_ID, schedule, spawn, firstSlotIndex: 10 });
    await manager.ensureStandingTiersForRun(99);
    const standingTiers = ['cheap', 'standard', 'frontier'].map((tierName) => manager.getStandingAgent(tierName)!);
    expect(standingTiers.map((tier) => [tier.tierName, tier.agentId])).toEqual([
      ['cheap', 'agent-pan-1791-slot-10'],
      ['standard', 'agent-pan-1791-slot-11'],
      ['frontier', 'agent-pan-1791-slot-12'],
    ]);

    const routed = new Map<string, string>();
    for (const item of doc.plan.items) {
      const tier = resolveTier(item, TIER_CONFIG);
      const agentId = await manager.dispatchBeadToTier(tier.tierName, item);
      routed.set(item.id, agentId);
      expect(agentId).toBe(manager.getStandingAgent(tier.tierName)?.agentId);
      manager.completeBead(item.id);
    }
    expect(routed).toEqual(new Map([
      ['trivial-docs-a', 'agent-pan-1791-slot-10'],
      ['trivial-docs-b', 'agent-pan-1791-slot-10'],
      ['medium-api', 'agent-pan-1791-slot-11'],
      ['expert-orchestrator', 'agent-pan-1791-slot-12'],
    ]));

    const fastTrack = groupFastTrack(doc.plan.items);
    expect(fastTrack.batches.map((batch) => batch.items.map((item) => item.id))).toEqual([
      ['trivial-docs-a', 'trivial-docs-b'],
    ]);
    const run = vi.fn(async () => ({ stdout: 'ok', stderr: '' }));
    const fastTrackOutcome = await autoMergeFastTrackBatch(
      { issueId: ISSUE_ID, featureWorkspace: WORKSPACE },
      10,
      fastTrack.batches[0],
      { enabled: true, mergeOptions: { deps: { run } } },
    );
    expect(fastTrackOutcome.refused).toBe(false);
    expect(fastTrackOutcome.result).toMatchObject({ verified: true, merged: true });
    expect(run.mock.calls.map(([command]) => command)).toEqual([
      ...FAST_TRACK_GATE_COMMANDS,
      'git merge --no-ff "feature/pan-1791-slot-10"',
    ]);

    const feedDeliveries: Array<{ agentId: string; message: string; caller?: string }> = [];
    const supervisorDeliveries: Array<{ agentId: string; message: string; caller?: string }> = [];
    const deliverFeed = vi.fn(async (agentId: string, message: string, caller?: string): Promise<DeliveryResult> => {
      feedDeliveries.push({ agentId, message, caller });
      return { ok: true, path: 'tmux' };
    });
    const deliverSupervisor = vi.fn(async (agentId: string, message: string, caller?: string): Promise<DeliveryResult> => {
      supervisorDeliveries.push({ agentId, message, caller });
      return { ok: true, path: 'supervisor' };
    });
    const recordDelivery = vi.fn(async () => undefined);
    const getDiff = vi.fn(async (_workspace: string, sha: string) => `commit ${sha}\n\ndiff --git a/${sha}.ts b/${sha}.ts\n+${sha}\n`);
    const verdicts: SupervisorVerdict[] = [];
    const supervisorId = supervisorAgentId(ISSUE_ID);

    async function commitBead(item: VBriefItem, sha: string, status: SupervisorVerdict['status']): Promise<void> {
      await broadcastCommit({
        workspace: WORKSPACE,
        issueId: ISSUE_ID,
        sha,
        beadTitle: item.title,
        beadId: item.id,
        tiers: standingTiers,
        deliver: deliverFeed,
        gitShow: getDiff,
        recordDelivery,
      });
      await deliverCommitForReview({
        supervisorAgentId: supervisorId,
        workspacePath: WORKSPACE,
        issueId: ISSUE_ID,
        item,
        sha,
        prdMarkdown: '- **FR-1 — Dogfood.** The fixture exercises tiered execution.',
        deps: { deliver: deliverSupervisor, getDiff },
      });
      verdicts.push({ beadId: item.id, status });
    }

    const byId = new Map(doc.plan.items.map((item) => [item.id, item]));
    await commitBead(byId.get('trivial-docs-b')!, 'sha-fast-track', 'passed');
    await commitBead(byId.get('medium-api')!, 'sha-medium-bad', 'failed');

    expect(shouldHaltDispatch(verdicts, byId.get('expert-orchestrator')!, doc)).toBe(true);
    const dispatchBeforeFix = vi.fn(async () => manager.dispatchBeadToTier('frontier', byId.get('expert-orchestrator')!));
    if (!shouldHaltDispatch(verdicts, byId.get('expert-orchestrator')!, doc)) {
      await dispatchBeforeFix();
    }
    expect(dispatchBeforeFix).not.toHaveBeenCalled();

    await commitBead(byId.get('medium-api')!, 'sha-medium-fix', 'passed');
    expect(shouldHaltDispatch(verdicts, byId.get('expert-orchestrator')!, doc)).toBe(false);
    await expect(manager.dispatchBeadToTier('frontier', byId.get('expert-orchestrator')!)).resolves.toBe('agent-pan-1791-slot-12');
    manager.completeBead('expert-orchestrator');
    await commitBead(byId.get('expert-orchestrator')!, 'sha-expert', 'passed');

    expect(deliverFeed).toHaveBeenCalledTimes(4 * standingTiers.length);
    expect(feedDeliveries.map((delivery) => delivery.agentId)).toEqual([
      'agent-pan-1791-slot-10', 'agent-pan-1791-slot-11', 'agent-pan-1791-slot-12',
      'agent-pan-1791-slot-10', 'agent-pan-1791-slot-11', 'agent-pan-1791-slot-12',
      'agent-pan-1791-slot-10', 'agent-pan-1791-slot-11', 'agent-pan-1791-slot-12',
      'agent-pan-1791-slot-10', 'agent-pan-1791-slot-11', 'agent-pan-1791-slot-12',
    ]);
    expect(supervisorDeliveries).toHaveLength(4);
    expect(supervisorDeliveries.every((delivery) => delivery.agentId === supervisorId)).toBe(true);
    expect(supervisorDeliveries.every((delivery) => delivery.caller === 'tier-supervisor:verdict')).toBe(true);
    expect(verdicts).toEqual([
      { beadId: 'trivial-docs-b', status: 'passed' },
      { beadId: 'medium-api', status: 'failed' },
      { beadId: 'medium-api', status: 'passed' },
      { beadId: 'expert-orchestrator', status: 'passed' },
    ]);

    const replayDeliveries: Array<{ agentId: string; message: string; caller?: string }> = [];
    const replaySpawn = vi.fn(async (issueId: string, role: 'work' | 'review', options: Record<string, unknown>) => ({
      id: `agent-${issueId.toLowerCase()}-slot-${options.slotIndex}`,
      issueId,
      role,
      status: 'running',
      workspace: WORKSPACE,
      startedAt: new Date().toISOString(),
    } as AgentState));
    const replayDeliver = vi.fn(async (agentId: string, message: string, caller?: string): Promise<DeliveryResult> => {
      replayDeliveries.push({ agentId, message, caller });
      return { ok: true, path: 'tmux' };
    });

    const replay = await replayCrashedStandingAgent({
      kind: 'tier',
      issueId: ISSUE_ID,
      workspace: WORKSPACE,
      base: 'main',
      tierName: 'standard',
      agentId: 'agent-pan-1791-slot-11',
      slotIndex: 11,
      slotItemId: 'medium-api',
    }, {
      deps: {
        spawn: replaySpawn,
        deliver: replayDeliver,
        gitLog: async () => [
          { sha: 'sha-fast-track', subject: 'trivial-docs-b' },
          { sha: 'sha-medium-fix', subject: 'medium-api' },
        ],
        gitShow: getDiff,
      },
    });

    expect(replay.agent).toMatchObject({ id: 'agent-pan-1791-slot-11', status: 'running' });
    expect(replaySpawn).toHaveBeenCalledWith(ISSUE_ID, 'work', {
      slotIndex: 11,
      slotItemId: 'medium-api',
      prompt: undefined,
    });
    expect(replay.deliveries).toHaveLength(2);
    expect(replayDeliveries.map((delivery) => delivery.caller)).toEqual(['tier-replay:tier', 'tier-replay:tier']);
    expect(replayDeliveries.every((delivery) => delivery.agentId === 'agent-pan-1791-slot-11')).toBe(true);
    expect(replayDeliveries[1].message).toContain('Commit feed (ingestion-only): sha-medium-fix');

    expect(spawnCalls.map((call) => call.options.slotItemId)).toEqual(['trivial-docs-a', 'medium-api', 'expert-orchestrator']);
  });
});

import { describe, expect, it } from 'vitest';
import type { AgentState } from '../agent-state.js';
import type { DeliveryResult } from '../delivery.js';
import { chooseDispatchTier, chooseTierAssignment } from '../dispatch-tier.js';
import { autoMergeFastTrackBatch, groupFastTrack } from '../fast-track.js';
import { resolveTier } from '../resolve-tier.js';
import { broadcastCommit, composeCommitFeedMessage } from '../tier-feed.js';
import { replayCrashedStandingAgent } from '../tier-replay.js';
import {
  resolveTieredExecutionEnabled,
  validateTieredExecutionConfig,
  type ValidatedTieredExecutionConfig,
} from '../tier-table.js';
import { complexityToModel, legacyComplexityTierConfig, type ComplexityLevel } from '../../cloister/complexity.js';
import type { VBriefItem } from '../../vbrief/types.js';

/**
 * Enablement-gate parity lock (PAN-1791 FR-8 / NFR-2). The whole tiered
 * execution feature SHIPS DARK: with tiered_execution disabled (the
 * default), every surface this branch adds must produce today's behavior —
 * the legacy difficulty->model mapping, the unchanged binary dispatch
 * decision with no model override, and an unreachable auto-merge path.
 * If any assertion here breaks, disabled-mode behavior changed — that is a
 * regression to fix, never a test to update.
 */

const LEVELS: ComplexityLevel[] = ['trivial', 'simple', 'medium', 'complex', 'expert'];

function item(metadata: VBriefItem['metadata'], id = 'item-1'): VBriefItem {
  return { id, title: 't', status: 'pending', metadata };
}

function enabledWithDefaultKnobs(): ValidatedTieredExecutionConfig {
  return validateTieredExecutionConfig({
    enabled: true,
    tiers: {
      cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple'] },
      standard: { model: 'claude-sonnet-5', harness: 'claude-code', difficulties: ['medium', 'complex'] },
      frontier: { model: 'claude-opus-4-8', harness: 'claude-code', difficulties: ['expert'] },
    },
    supervisor: { model: 'claude-opus-4-8', harness: 'claude-code', subscribe: 'flagged' },
    replay_threshold: 0.5,
  });
}

describe('tiered execution ships dark (enabled=false)', () => {
  it('the loader defaults to disabled with no tiered_execution block', () => {
    const config = validateTieredExecutionConfig(undefined);
    expect(config.enabled).toBe(false);
    expect(config.replay_threshold).toBe(0.5);
    expect(config.tiers).toEqual({});
  });

  it('per-issue resolution inherits the disabled global flag when unset', () => {
    expect(resolveTieredExecutionEnabled({ enabled: false }, {})).toBe(false);
    expect(resolveTieredExecutionEnabled({ enabled: false }, undefined)).toBe(false);
  });

  it('resolveTier reproduces the legacy difficulty->model output for all five difficulties', () => {
    // Locked mapping: trivial/simple->haiku, medium/complex->sonnet, expert->opus.
    const expected: Record<ComplexityLevel, string> = {
      trivial: 'haiku',
      simple: 'haiku',
      medium: 'sonnet',
      complex: 'sonnet',
      expert: 'opus',
    };
    for (const level of LEVELS) {
      const resolved = resolveTier(item({ difficulty: level }), legacyComplexityTierConfig());
      expect(resolved.model).toBe(expected[level]);
      expect(resolved.model).toBe(complexityToModel(level));
    }
  });

  it('chooseTierAssignment returns exactly the pre-change dispatch decision with no model override', () => {
    const items = [
      item({ difficulty: 'expert' }),
      item({ difficulty: 'trivial', files_scope: ['a.ts'], files_scope_confidence: 'high' }),
      item({ readiness: 'ready', files_scope: ['a.ts'], files_scope_confidence: 'high' }),
      item({}),
    ];
    for (const testItem of items) {
      const assignment = chooseTierAssignment(testItem, undefined);
      expect(assignment).toEqual({ dispatch: chooseDispatchTier(testItem) });
      expect(assignment.model).toBeUndefined();
      expect(assignment.harness).toBeUndefined();
      expect(assignment.tierName).toBeUndefined();
    }
  });

  it('the auto-merge path is unreachable: disabled tiering refuses the batch and executes zero commands', () => {
    // No spawn, no gate command, no git merge — nothing runs while disabled.
    // Standing-tier and supervisor spawn locks extend this file when those
    // modules land (they do not exist on this branch yet).
    const calls: string[] = [];
    const run = async (command: string) => {
      calls.push(command);
      return { stdout: 'ok', stderr: '' };
    };
    const batch = groupFastTrack([
      item({ difficulty: 'trivial', files_scope: ['docs/a.md'], files_scope_confidence: 'high' }, 'a'),
      item({ difficulty: 'trivial', files_scope: ['docs/b.md'], files_scope_confidence: 'high' }, 'b'),
    ]).batches[0];

    return autoMergeFastTrackBatch(
      { issueId: 'PAN-1', featureWorkspace: '/ws/feature-pan-1' },
      1,
      batch,
      { enabled: false, mergeOptions: { deps: { run } } },
    ).then(outcome => {
      expect(outcome.refused).toBe(true);
      expect(outcome.result).toBeUndefined();
      expect(calls).toHaveLength(0);
    });
  });
});

describe('tiered execution enabled with v2 knobs at defaults', () => {
  it('normalizes every new knob to current-behavior defaults', () => {
    const config = enabledWithDefaultKnobs();

    expect(config.feed).toEqual({
      callouts: 'off',
      exclude: [],
      exclude_subjects: [],
      max_diff_bytes: null,
    });
    expect(config.escalation).toEqual({
      enabled: false,
      retries_at_tier: 0,
      max_promotions: 0,
      flounder_budget_minutes: {},
    });
    expect(config.compaction_reroute).toBe('off');
    expect(config.supervisor?.owns_inspection).toBe(false);
    expect(config.byKind).toEqual({});
  });

  it('keeps feed deliveries byte-identical to the baseline when callouts are off by default', async () => {
    const config = enabledWithDefaultKnobs();
    const baseline = composeCommitFeedMessage('abc123', 'my bead', 'commit abc123\n+added\n');
    const deliveries: string[] = [];

    await broadcastCommit({
      workspace: '/ws',
      issueId: 'PAN-1',
      sha: 'abc123',
      beadTitle: 'my bead',
      tiers: [{ tierName: 'cheap', agentId: 'agent-pan-1-slot-1' }],
      feedConfig: config.feed,
      gitShow: async () => 'commit abc123\n+added\n',
      deliver: async (_agentId, message): Promise<DeliveryResult> => {
        deliveries.push(message);
        return { ok: true, path: 'tmux' };
      },
      recordDelivery: async () => undefined,
    });

    expect(deliveries).toEqual([baseline]);
  });

  it('keeps replay respawn behavior and feed bytes unchanged when compaction reroute is off by default', async () => {
    const config = enabledWithDefaultKnobs();
    const deliveries: string[] = [];
    const spawnCalls: Array<Record<string, unknown>> = [];
    const spawn = async (issueId: string, role: string, options: Record<string, unknown>) => {
      spawnCalls.push(options);
      return {
        id: `agent-${issueId.toLowerCase()}-slot-${options.slotIndex}`,
        issueId,
        role,
        status: 'running',
        workspace: '/ws',
        startedAt: '2026-07-02T00:00:00.000Z',
      } as AgentState;
    };

    const replay = await replayCrashedStandingAgent({
      kind: 'tier',
      issueId: 'PAN-1',
      workspace: '/ws',
      base: 'main',
      tierName: 'standard',
      slotIndex: 7,
      slotItemId: 'bead-a',
      feedConfig: config.feed,
      reroute: {
        doc: {
          vBRIEFInfo: { version: '0.6', created: '2026-07-02T00:00:00.000Z' },
          plan: { id: 'pan-1', title: 'plan', status: 'running', items: [item({ difficulty: 'expert' }, 'bead-a')] },
        },
        config,
        tierOverrides: {
          'bead-a': {
            effectiveDifficulty: 'expert',
            promotions: 1,
            history: [{ at: '2026-07-02T00:00:00.000Z', from: 'medium', to: 'expert', reason: 'ignored while off' }],
          },
        },
      },
    }, {
      deps: {
        spawn,
        deliver: async (_agentId, message): Promise<DeliveryResult> => {
          deliveries.push(message);
          return { ok: true, path: 'tmux' };
        },
        gitLog: async () => [{ sha: 'abc123', subject: 'bead-a' }],
        gitShow: async () => 'commit abc123\n+added\n',
      },
    });

    expect(replay.agent.id).toBe('agent-pan-1-slot-7');
    expect(spawnCalls).toEqual([{ slotIndex: 7, slotItemId: 'bead-a', prompt: undefined }]);
    expect(deliveries).toEqual([composeCommitFeedMessage('abc123', 'bead-a', 'commit abc123\n+added\n')]);
  });

  it('routes by difficulty when by_kind is absent, even for judgment-deliverable kinds', () => {
    const config = enabledWithDefaultKnobs();
    const design = item({ kind: 'design', difficulty: 'simple' });
    const spike = item({ kind: 'spike', difficulty: 'simple' });

    expect(chooseTierAssignment(design, config).tierName).toBe('cheap');
    expect(chooseTierAssignment(spike, config).tierName).toBe('cheap');
  });
});

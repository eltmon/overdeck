import { describe, expect, it } from 'vitest';
import { chooseDispatchTier, chooseTierAssignment } from '../dispatch-tier.js';
import { autoMergeFastTrackBatch, groupFastTrack } from '../fast-track.js';
import { resolveTier } from '../resolve-tier.js';
import {
  resolveTieredExecutionEnabled,
  validateTieredExecutionConfig,
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

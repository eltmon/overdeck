import { describe, expect, it } from 'vitest';
import {
  applyEffectiveDifficulty,
  applyEscalationAction,
  decideEscalation,
  type EscalationAction,
} from '../tier-escalation.js';
import { resolveStaffing } from '../staffing.js';
import type { TierOverridesMap } from '../../xbrief/io.js';
import type { ValidatedEscalationConfig } from '../tier-table.js';
import type { XBriefItem } from '../../xbrief/types.js';

function bead(id: string, metadata: Record<string, unknown> = {}): Pick<XBriefItem, 'id' | 'metadata'> {
  return { id, metadata: metadata as XBriefItem['metadata'] };
}

function escalationConfig(overrides: Partial<ValidatedEscalationConfig> = {}): ValidatedEscalationConfig {
  return { enabled: true, retries_at_tier: 0, max_promotions: 5, ...overrides };
}

const TRIGGER = { kind: 'verification-failed' as const, itemId: 'task', detail: 'tests failed' };

describe('decideEscalation (PAN-4512 restoration)', () => {
  it('ac5: blocks when the item has no effective difficulty', () => {
    const action = decideEscalation(TRIGGER, bead('task'), escalationConfig(), {});
    expect(action).toEqual({ action: 'block', reason: 'task task has no effective difficulty' });
  });

  it('ac5: blocks when promotions reached max_promotions', () => {
    const overrides: TierOverridesMap = { task: { effectiveDifficulty: 'medium', promotions: 2, history: [] } };
    const action = decideEscalation(TRIGGER, bead('task', { difficulty: 'medium' }), escalationConfig({ max_promotions: 2 }), overrides);
    expect(action).toMatchObject({ action: 'block' });
  });

  it('ac5: blocks when the item is already at expert', () => {
    const action = decideEscalation(TRIGGER, bead('task', { difficulty: 'expert' }), escalationConfig(), {});
    expect(action).toMatchObject({ action: 'block', reason: expect.stringContaining('cannot promote beyond expert') });
  });

  it('ac5: retries with attempt + 1 when under retries_at_tier', () => {
    const trigger = { ...TRIGGER, attemptsAtCurrentTier: 1 };
    const action = decideEscalation(trigger, bead('task', { difficulty: 'medium' }), escalationConfig({ retries_at_tier: 3 }), {});
    expect(action).toEqual({ action: 'retry', attempt: 2 });
  });

  it('promotes to the next difficulty when effort_first is unset', () => {
    const action = decideEscalation(TRIGGER, bead('task', { difficulty: 'medium' }), escalationConfig(), {});
    expect(action).toEqual({ action: 'promote', from: 'medium', to: 'complex', reason: 'verification failed: tests failed' });
  });

  it('ac3: promotes when effort_first is on but there is no higher supported level (already at max)', () => {
    const action = decideEscalation(
      TRIGGER,
      bead('task', { difficulty: 'medium' }),
      escalationConfig({ effort_first: true }),
      {},
      { currentEffort: 'max' },
    );
    expect(action).toMatchObject({ action: 'promote', from: 'medium', to: 'complex' });
  });

  it('ac3: promotes when the model+harness pair supports only low/medium/high and current effort is already "high"', () => {
    // claude-opus-4-6 (effortLevels low/medium/high/max) intersected with the
    // ohmypi harness (effortLevels low/medium/high/xhigh) supports only
    // low/medium/high — nothing above 'high' for this pair.
    const action = decideEscalation(
      TRIGGER,
      bead('task', { difficulty: 'medium' }),
      escalationConfig({ effort_first: true }),
      {},
      { currentEffort: 'high', model: 'claude-opus-4-6', harness: 'ohmypi' },
    );
    expect(action).toMatchObject({ action: 'promote', from: 'medium', to: 'complex' });
  });

  it('raises effort instead of promoting when effort_first is on and a higher level is supported', () => {
    const action = decideEscalation(
      TRIGGER,
      bead('task', { difficulty: 'medium' }),
      escalationConfig({ effort_first: true }),
      {},
      { currentEffort: 'medium' },
    );
    expect(action).toEqual({
      action: 'raise-effort',
      difficulty: 'medium',
      from: 'medium',
      to: 'high',
      reason: 'verification failed: tests failed',
    });
  });

  it('falls through to promote on a second escalation once effectiveEffort is already set', () => {
    const overrides: TierOverridesMap = {
      task: { effectiveDifficulty: 'medium', promotions: 0, effectiveEffort: 'high', history: [] },
    };
    const action = decideEscalation(
      TRIGGER,
      bead('task', { difficulty: 'medium' }),
      escalationConfig({ effort_first: true }),
      overrides,
      { currentEffort: 'high' },
    );
    expect(action).toMatchObject({ action: 'promote', from: 'medium', to: 'complex' });
  });
});

describe('applyEscalationAction (PAN-4257 ac4)', () => {
  it('ac4: a promote action increments promotions, sets effectiveDifficulty, has no effectiveEffort key, and leaves the input map unchanged', () => {
    const input: TierOverridesMap = {};
    const action: EscalationAction = { action: 'promote', from: 'medium', to: 'complex', reason: 'r' };
    const result = applyEscalationAction(input, 'task', action, '2026-10-04T00:00:00.000Z');

    expect(result.task).toMatchObject({ effectiveDifficulty: 'complex', promotions: 1 });
    expect('effectiveEffort' in result.task).toBe(false);
    expect(result.task.history).toEqual([{ at: '2026-10-04T00:00:00.000Z', from: 'medium', to: 'complex', reason: 'r' }]);
    expect(input).toEqual({});
  });

  it('a promote action over an existing override preserves and increments its promotion count', () => {
    const input: TierOverridesMap = { task: { effectiveDifficulty: 'medium', promotions: 1, history: [] } };
    const result = applyEscalationAction(input, 'task', { action: 'promote', from: 'medium', to: 'complex', reason: 'r' });
    expect(result.task.promotions).toBe(2);
    expect(input.task.promotions).toBe(1);
  });

  it('a raise-effort action sets effectiveEffort and keeps effectiveDifficulty, without touching promotions', () => {
    const input: TierOverridesMap = {};
    const action: EscalationAction = { action: 'raise-effort', difficulty: 'medium', from: 'medium', to: 'high', reason: 'r' };
    const result = applyEscalationAction(input, 'task', action, '2026-10-04T00:00:00.000Z');

    expect(result.task).toEqual({
      effectiveDifficulty: 'medium',
      promotions: 0,
      effectiveEffort: 'high',
      history: [{ at: '2026-10-04T00:00:00.000Z', kind: 'effort', from: 'medium', to: 'high', reason: 'r' }],
    });
    expect(input).toEqual({});
  });

  it('retry and block actions return the input map unchanged (same reference)', () => {
    const input: TierOverridesMap = {};
    expect(applyEscalationAction(input, 'task', { action: 'retry', attempt: 1 })).toBe(input);
    expect(applyEscalationAction(input, 'task', { action: 'block', reason: 'r' })).toBe(input);
  });
});

describe('applyEffectiveDifficulty effort overlay (PAN-4257)', () => {
  it('overlays metadata.effort when the override carries effectiveEffort', () => {
    const overrides: TierOverridesMap = {
      task: { effectiveDifficulty: 'medium', promotions: 0, effectiveEffort: 'high', history: [] },
    };
    const result = applyEffectiveDifficulty(bead('task', { difficulty: 'medium' }), overrides);
    expect(result.metadata).toMatchObject({ difficulty: 'medium', effort: 'high' });
  });

  it('adds no effort key when the override has no effectiveEffort', () => {
    const overrides: TierOverridesMap = { task: { effectiveDifficulty: 'complex', promotions: 1, history: [] } };
    const result = applyEffectiveDifficulty(bead('task', { difficulty: 'medium' }), overrides);
    expect('effort' in (result.metadata ?? {})).toBe(false);
  });
});

describe('effort-first escalation sequence through resolveStaffing (PAN-4257 ac1/ac2)', () => {
  const TIER_CONFIG = {
    enabled: true,
    tiers: {
      cheap: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: ['trivial', 'simple'] },
      standard: { model: 'claude-sonnet-5-5', harness: 'claude-code', difficulties: ['medium'], effort: 'medium' },
      strong: { model: 'claude-opus-5-5', harness: 'claude-code', difficulties: ['complex'] },
      frontier: { model: 'claude-opus-5-5', harness: 'claude-code', difficulties: ['expert'] },
    },
    difficultyToTier: { trivial: 'cheap', simple: 'cheap', medium: 'standard', complex: 'strong', expert: 'frontier' },
    byKind: {},
  } as never;

  const WORK_ROLES = { work: { model: 'claude-sonnet-5-5' } } as never;

  function item(metadata: Record<string, unknown>): Pick<XBriefItem, 'id' | 'title' | 'metadata'> {
    return { id: 'task', title: 'task', metadata: metadata as XBriefItem['metadata'] };
  }

  it('ac1: the first escalation raises effort in place of promoting, keeping the same tier and model', () => {
    const staffing = resolveStaffing(item({ difficulty: 'medium' }), {
      config: { roles: WORK_ROLES, tieredExecution: TIER_CONFIG } as never,
    });
    expect(staffing).toMatchObject({ tierName: 'standard', model: 'claude-sonnet-5-5', effort: 'medium', effortSource: 'tier' });

    const action = decideEscalation(
      TRIGGER,
      item({ difficulty: 'medium' }),
      escalationConfig({ effort_first: true }),
      {},
      { currentEffort: staffing.effort, model: staffing.model, harness: staffing.harness },
    );
    expect(action).toMatchObject({ action: 'raise-effort', from: 'medium', to: 'high' });

    const overrides = applyEscalationAction({}, 'task', action);
    const restaffed = resolveStaffing(item({ difficulty: 'medium' }), {
      config: { roles: WORK_ROLES, tieredExecution: TIER_CONFIG } as never,
      tierOverrides: overrides,
    });
    expect(restaffed).toMatchObject({ tierName: 'standard', model: 'claude-sonnet-5-5', effort: 'high', effortSource: 'item' });
  });

  it('ac2: a second escalation promotes to the next tier, since effort was already raised once', () => {
    const firstOverrides: TierOverridesMap = {
      task: {
        effectiveDifficulty: 'medium',
        promotions: 0,
        effectiveEffort: 'high',
        history: [{ at: '2026-10-04T00:00:00.000Z', kind: 'effort', from: 'medium', to: 'high', reason: 'r' }],
      },
    };
    const staffingAfterRaise = resolveStaffing(item({ difficulty: 'medium' }), {
      config: { roles: WORK_ROLES, tieredExecution: TIER_CONFIG } as never,
      tierOverrides: firstOverrides,
    });

    const action = decideEscalation(
      TRIGGER,
      item({ difficulty: 'medium' }),
      escalationConfig({ effort_first: true }),
      firstOverrides,
      { currentEffort: staffingAfterRaise.effort, model: staffingAfterRaise.model, harness: staffingAfterRaise.harness },
    );
    expect(action).toEqual({ action: 'promote', from: 'medium', to: 'complex', reason: 'verification failed: tests failed' });

    const secondOverrides = applyEscalationAction(firstOverrides, 'task', action);
    const restaffed = resolveStaffing(item({ difficulty: 'medium' }), {
      config: { roles: WORK_ROLES, tieredExecution: TIER_CONFIG } as never,
      tierOverrides: secondOverrides,
    });
    expect(restaffed).toMatchObject({ tierName: 'strong', model: 'claude-opus-5-5' });
  });
});

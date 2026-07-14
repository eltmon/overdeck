import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { VBriefDifficulty, VBriefItem } from '../../vbrief/types.js';
import {
  decideEscalation,
  decideFlounderingEscalation,
  decideVerificationFailureEscalation,
  isFloundering,
  type EscalationTrigger,
} from '../tier-escalation.js';
import type { ValidatedEscalationConfig } from '../tier-table.js';

function config(overrides: Partial<ValidatedEscalationConfig> = {}): ValidatedEscalationConfig {
  return {
    enabled: true,
    retries_at_tier: 2,
    max_promotions: 2,
    flounder_budget_minutes: {},
    ...overrides,
  };
}

function task(difficulty: VBriefDifficulty): VBriefItem {
  return {
    id: 'task-a',
    title: 'Escalate me',
    status: 'running',
    metadata: { difficulty },
  };
}

describe('decideEscalation', () => {
  it('retries while attempts at the current tier remain, then promotes exactly one difficulty step', () => {
    const first = decideEscalation(
      { kind: 'verification-failed', taskId: 'task-a', detail: 'typecheck failed' },
      task('simple'),
      config({ retries_at_tier: 2 }),
      {},
    );
    const exhausted = decideEscalation(
      { kind: 'verification-failed', taskId: 'task-a', detail: 'typecheck failed', attemptsAtCurrentTier: 2 },
      task('simple'),
      config({ retries_at_tier: 2 }),
      {},
    );

    expect(first).toEqual({ action: 'retry', attempt: 1 });
    expect(exhausted).toEqual({
      action: 'promote',
      from: 'simple',
      to: 'medium',
      reason: 'verification failed: typecheck failed',
    });
  });

  it('blocks when max promotions are already reached', () => {
    const decision = decideEscalation(
      { kind: 'supervisor-blocked', taskId: 'task-a', sha: 'abcdef123456', attemptsAtCurrentTier: 2 },
      task('simple'),
      config({ max_promotions: 1 }),
      {
        'task-a': {
          effectiveDifficulty: 'medium',
          promotions: 1,
          history: [{ at: '2026-07-02T00:00:00.000Z', from: 'simple', to: 'medium', reason: 'test' }],
        },
      },
    );

    expect(decision).toEqual({
      action: 'block',
      reason: 'max promotions reached for task-a at medium',
    });
  });

  it('blocks promotion when max_promotions is zero', () => {
    const decision = decideEscalation(
      { kind: 'verification-failed', taskId: 'task-a', detail: 'typecheck failed', attemptsAtCurrentTier: 1 },
      task('simple'),
      config({ retries_at_tier: 1, max_promotions: 0 }),
      {},
    );

    expect(decision).toEqual({
      action: 'block',
      reason: 'max promotions reached for task-a at simple',
    });
  });

  it('blocks expert tasks because the ladder has no higher difficulty', () => {
    const decision = decideEscalation(
      { kind: 'floundering', taskId: 'task-a', dispatchedAt: '2026-07-02T10:00:00.000Z', now: '2026-07-02T11:00:00.000Z' },
      task('expert'),
      config(),
      {},
    );

    expect(decision).toEqual({
      action: 'block',
      reason: 'expert task task-a cannot promote beyond expert',
    });
  });

  it('is deterministic for identical inputs', () => {
    const trigger: EscalationTrigger = {
      kind: 'supervisor-blocked',
      taskId: 'task-a',
      sha: 'abcdef123456',
      attemptsAtCurrentTier: 3,
    };
    const item = task('medium');
    const escalation = config({ retries_at_tier: 1, max_promotions: 3 });
    const overrides = {
      'task-a': {
        effectiveDifficulty: 'medium' as const,
        promotions: 1,
        history: [{ at: '2026-07-02T00:00:00.000Z', from: 'simple' as const, to: 'medium' as const, reason: 'test' }],
      },
    };

    expect(decideEscalation(trigger, item, escalation, overrides)).toEqual(
      decideEscalation(trigger, item, escalation, overrides),
    );
  });

  it('does not import filesystem, process, or network modules', () => {
    const source = readFileSync(new URL('../tier-escalation.ts', import.meta.url), 'utf-8');

    expect(source).not.toMatch(/from ['"](?:node:)?fs['"]/);
    expect(source).not.toMatch(/from ['"](?:node:)?child_process['"]/);
    expect(source).not.toMatch(/from ['"](?:node:)?http['"]/);
    expect(source).not.toMatch(/from ['"](?:node:)?https['"]/);
    expect(source).not.toMatch(/from ['"](?:node:)?net['"]/);
  });

  it('exports foreman seams for verification failure and floundering triggers', () => {
    expect(decideVerificationFailureEscalation({
      task: task('simple'),
      config: config({ retries_at_tier: 0 }),
      overrides: {},
      detail: 'gate failed',
    })).toEqual({
      action: 'promote',
      from: 'simple',
      to: 'medium',
      reason: 'verification failed: gate failed',
    });

    expect(decideFlounderingEscalation({
      task: task('medium'),
      config: config({ retries_at_tier: 0, flounder_budget_minutes: { medium: 30 } }),
      overrides: {},
      dispatchedAt: '2026-07-02T10:00:00.000Z',
      now: '2026-07-02T10:31:00.000Z',
    })).toEqual({
      action: 'promote',
      from: 'medium',
      to: 'complex',
      reason: 'floundering since 2026-07-02T10:00:00.000Z',
    });

    expect(decideFlounderingEscalation({
      task: task('medium'),
      config: config({ flounder_budget_minutes: {} }),
      overrides: {},
      dispatchedAt: '2026-07-02T10:00:00.000Z',
      now: '2026-07-02T12:00:00.000Z',
    })).toBeNull();
  });
});

describe('isFloundering', () => {
  it('is inactive when no budget is configured', () => {
    expect(isFloundering(
      '2026-07-02T10:00:00.000Z',
      '2026-07-02T12:00:00.000Z',
      undefined,
    )).toBe(false);
  });

  it('returns true only when elapsed minutes exceed the configured budget', () => {
    expect(isFloundering(
      '2026-07-02T10:00:00.000Z',
      '2026-07-02T10:44:59.000Z',
      45,
    )).toBe(false);
    expect(isFloundering(
      '2026-07-02T10:00:00.000Z',
      '2026-07-02T10:45:01.000Z',
      45,
    )).toBe(true);
  });
});

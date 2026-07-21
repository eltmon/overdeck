import { describe, expect, it } from 'vitest';
import {
  LEGACY_PARKED_LABELS,
  OBJECTION_LABEL,
  PARKED_LABEL,
  RELEASED_LABEL,
  VETOED_LABEL,
} from '../../backlog/pickup.js';
import type { NormalizedConfig } from '../../config-yaml.js';
import {
  decideAutonomousPlanDispatch,
  type AutonomousPlanDispatchInput,
} from '../autonomous-plan-dispatch.js';

const WORKHORSES: NonNullable<NormalizedConfig['workhorses']> = {
  expensive: 'claude-opus-4-8',
  mid: 'claude-sonnet-5',
  cheap: 'claude-haiku-4-5',
};

function input(overrides: Partial<AutonomousPlanDispatchInput> = {}): AutonomousPlanDispatchInput {
  return {
    autoPickupBacklog: false,
    labels: [RELEASED_LABEL],
    workhorses: WORKHORSES,
    ...overrides,
  };
}

describe('decideAutonomousPlanDispatch', () => {
  it('fails closed when tracker labels are unavailable even with auto-pickup enabled', () => {
    const decision = decideAutonomousPlanDispatch(input({
      autoPickupBacklog: true,
      labels: null,
      recordedModel: 'gpt-5.5',
    }));

    expect(decision).toMatchObject({ allow: false, code: 'labels-unavailable' });
    expect(decision.reason).toContain('run pan plan manually');
  });

  it.each([
    [PARKED_LABEL, 'parked'],
    [LEGACY_PARKED_LABELS[0].toUpperCase(), 'parked'],
    [LEGACY_PARKED_LABELS[1], 'parked'],
    [VETOED_LABEL, 'vetoed'],
    [OBJECTION_LABEL, 'objection'],
  ] as const)('blocks %s before release or staffing can allow dispatch', (label, code) => {
    const decision = decideAutonomousPlanDispatch(input({
      autoPickupBacklog: true,
      labels: [RELEASED_LABEL.toUpperCase(), label],
      recordedModel: 'gpt-5.5',
      autonomousModel: 'workhorse:cheap',
    }));

    expect(decision).toMatchObject({ allow: false, code });
    expect(decision.reason).toContain('run pan plan manually');
  });

  it('applies blocker precedence before staffing and in parked, vetoed, objection order', () => {
    expect(decideAutonomousPlanDispatch(input({
      autoPickupBacklog: true,
      labels: [RELEASED_LABEL, OBJECTION_LABEL, VETOED_LABEL, PARKED_LABEL],
      recordedModel: 'gpt-5.5',
    }))).toMatchObject({ allow: false, code: 'parked' });

    expect(decideAutonomousPlanDispatch(input({
      autoPickupBacklog: true,
      labels: [RELEASED_LABEL, OBJECTION_LABEL, VETOED_LABEL],
      recordedModel: 'gpt-5.5',
    }))).toMatchObject({ allow: false, code: 'vetoed' });
  });

  it('requires release when auto-pickup is disabled', () => {
    const decision = decideAutonomousPlanDispatch(input({
      labels: ['ready'],
      recordedModel: 'gpt-5.5',
    }));

    expect(decision).toMatchObject({ allow: false, code: 'not-released' });
    expect(decision.reason).toContain('released label or enable auto-pickup');
  });

  it('accepts a case-insensitive released label', () => {
    expect(decideAutonomousPlanDispatch(input({
      labels: [RELEASED_LABEL.toUpperCase()],
      recordedModel: 'gpt-5.5',
    }))).toEqual({ allow: true, model: 'gpt-5.5', modelSource: 'recorded' });
  });

  it('uses auto-pickup as the release posture', () => {
    expect(decideAutonomousPlanDispatch(input({
      autoPickupBacklog: true,
      labels: [],
      recordedModel: 'gpt-5.5',
    }))).toEqual({ allow: true, model: 'gpt-5.5', modelSource: 'recorded' });
  });

  it('prefers the recorded model without resolving the configured autonomous model', () => {
    expect(decideAutonomousPlanDispatch(input({
      recordedModel: 'gpt-5.5',
      autonomousModel: 'workhorse:missing',
    }))).toEqual({ allow: true, model: 'gpt-5.5', modelSource: 'recorded' });
  });

  it('dereferences the configured autonomous workhorse model', () => {
    expect(decideAutonomousPlanDispatch(input({
      autonomousModel: 'workhorse:cheap',
    }))).toEqual({
      allow: true,
      model: 'claude-haiku-4-5',
      modelSource: 'autonomousModel',
    });
  });

  it('refuses dispatch when no autonomous model is configured', () => {
    const decision = decideAutonomousPlanDispatch(input());

    expect(decision).toMatchObject({ allow: false, code: 'no-autonomous-model' });
    expect(decision.reason).toContain('Set roles.plan.autonomousModel or run pan plan manually');
  });

  it('refuses dispatch when the configured autonomous model cannot be dereferenced', () => {
    const decision = decideAutonomousPlanDispatch(input({
      autonomousModel: 'workhorse:missing',
    }));

    expect(decision).toMatchObject({ allow: false, code: 'no-autonomous-model' });
    expect(decision.reason).toContain('valid roles.plan.autonomousModel');
  });
});

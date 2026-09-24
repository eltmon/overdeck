import { describe, expect, it } from 'vitest';

import {
  FALLBACK_GROUPS,
  formatCost,
  PI_TOS_BLOCK_REASON,
  canUsePickerHarness,
  getProviderForPickerModel,
  type HarnessPolicyDecisions,
  type ModelGroup,
} from './ModelPicker';

const groups: ModelGroup[] = [
  {
    provider: 'anthropic',
    label: 'Anthropic',
    models: [{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic' }],
  },
  {
    provider: 'openai',
    label: 'OpenAI',
    models: [{ id: 'gpt-5.5', label: 'GPT-5.5', provider: 'openai' }],
  },
];

const policyDecisions: HarnessPolicyDecisions = {
  'claude-sonnet-4-6': {
    pi: { allowed: false, reason: PI_TOS_BLOCK_REASON },
    'claude-code': { allowed: true },
  },
  'claude-sonnet-4-6-api-key': {
    pi: { allowed: true },
  },
  'gpt-5.5': {
    pi: { allowed: true },
  },
};

describe('ModelPicker harness policy', () => {
  it('disables Pi for models blocked by the canonical policy response', () => {
    const provider = getProviderForPickerModel('claude-sonnet-4-6', groups);

    expect(provider).toBe('anthropic');
    expect(canUsePickerHarness('pi', 'claude-sonnet-4-6', policyDecisions)).toEqual({
      allowed: false,
      reason: PI_TOS_BLOCK_REASON,
    });
  });

  it('allows Pi when the canonical policy response allows it', () => {
    expect(canUsePickerHarness('pi', 'claude-sonnet-4-6-api-key', policyDecisions)).toEqual({
      allowed: true,
    });
    expect(canUsePickerHarness('pi', 'gpt-5.5', policyDecisions)).toEqual({
      allowed: true,
    });
  });

  it('does not allow a harness missing from a loaded model decision row', () => {
    const decision = canUsePickerHarness('codex', 'claude-sonnet-4-6', policyDecisions);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('No harness-policy decision for codex');
  });

  it('leaves options usable while the model has no decision row yet', () => {
    expect(canUsePickerHarness('codex', 'model-not-in-batch', policyDecisions)).toEqual({ allowed: true });
    expect(canUsePickerHarness('codex', 'claude-sonnet-4-6', undefined)).toEqual({ allowed: true });
  });

  it('keeps Claude Code available for Anthropic subscription auth', () => {
    expect(canUsePickerHarness('claude-code', 'claude-sonnet-4-6', policyDecisions)).toEqual({
      allowed: true,
    });
  });
});


it('distinguishes unavailable pricing from a free model', () => {
  expect(formatCost(null)).toBe('Pricing unavailable');
  expect(formatCost(0)).toBe('FREE');
});

it('includes Claude Opus 5.5 in the offline fallback catalog', () => {
  const anthropic = FALLBACK_GROUPS.find(group => group.provider === 'anthropic');
  expect(anthropic?.models).toContainEqual(expect.objectContaining({
    id: 'claude-opus-5-5',
    costPer1MTokens: 12,
  }));
});

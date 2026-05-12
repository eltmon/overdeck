import { describe, expect, it } from 'vitest';

import {
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

  it('keeps Claude Code available for Anthropic subscription auth', () => {
    expect(canUsePickerHarness('claude-code', 'claude-sonnet-4-6', policyDecisions)).toEqual({
      allowed: true,
    });
  });
});

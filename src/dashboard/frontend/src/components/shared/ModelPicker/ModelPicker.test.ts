import { describe, expect, it } from 'vitest';

import {
  PI_TOS_BLOCK_REASON,
  canUsePickerHarness,
  getProviderForPickerModel,
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

describe('ModelPicker harness policy', () => {
  it('disables Pi only for Anthropic models authenticated via Claude Code subscription', () => {
    const provider = getProviderForPickerModel('claude-sonnet-4-6', groups);

    expect(canUsePickerHarness('pi', provider, 'subscription')).toEqual({
      allowed: false,
      reason: PI_TOS_BLOCK_REASON,
    });
  });

  it('allows Pi for Anthropic API-key auth and non-Anthropic providers', () => {
    expect(canUsePickerHarness('pi', getProviderForPickerModel('claude-sonnet-4-6', groups), 'api-key')).toEqual({
      allowed: true,
    });
    expect(canUsePickerHarness('pi', getProviderForPickerModel('gpt-5.5', groups), 'subscription')).toEqual({
      allowed: true,
    });
  });

  it('keeps Claude Code available for Anthropic subscription auth', () => {
    expect(canUsePickerHarness('claude-code', 'anthropic', 'subscription')).toEqual({
      allowed: true,
    });
  });
});

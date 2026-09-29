import { describe, expect, it, vi } from 'vitest';

import { familyOf, resolvePlanCritic } from '../plan-critic-model.js';

describe('familyOf', () => {
  it('maps known families from the model id', () => {
    expect(familyOf('claude-opus-4-8')).toBe('claude');
    expect(familyOf('gpt-5.5')).toBe('gpt');
  });

  it('names an other-family model by its provider', () => {
    expect(familyOf('qwen3-max')).toBe('provider:dashscope');
  });

  it('gives an unknown model its own family', () => {
    expect(familyOf('totally-made-up-model')).toBe('unknown:totally-made-up-model');
  });
});

describe('resolvePlanCritic', () => {
  const workhorses = { expensive: 'claude-opus-4-8', mid: 'claude-sonnet-5-5', cheap: 'gpt-5.6-sol' };

  it('refuses when roles.plan.sub.critic.model is unset', async () => {
    const result = await resolvePlanCritic({
      plannerModel: 'claude-opus-4-8',
      config: { roles: { plan: { model: 'workhorse:expensive' } }, workhorses },
      resolveHarnessImpl: vi.fn(),
    });
    expect(result).toMatchObject({ ok: false, reason: 'critic-not-configured' });
    if (!result.ok) {
      expect(result.message).toContain('roles.plan.sub.critic.model');
      expect(result.message).toContain('claude');
    }
  });

  it('refuses a critic in the planner family', async () => {
    const resolveHarnessImpl = vi.fn();
    const result = await resolvePlanCritic({
      plannerModel: 'claude-opus-4-8',
      config: { roles: { plan: { model: 'workhorse:expensive', sub: { critic: { model: 'claude-sonnet-5-5' } } } }, workhorses },
      resolveHarnessImpl,
    });
    expect(result).toMatchObject({ ok: false, reason: 'critic-same-family' });
    expect(resolveHarnessImpl).not.toHaveBeenCalled();
  });

  it('resolves a different-family critic and its harness', async () => {
    const resolveHarnessImpl = vi.fn().mockResolvedValue('codex');
    const result = await resolvePlanCritic({
      plannerModel: 'claude-opus-4-8',
      config: { roles: { plan: { model: 'workhorse:expensive', sub: { critic: { model: 'gpt-5.6-sol' } } } }, workhorses },
      resolveHarnessImpl,
    });
    expect(result).toEqual({ ok: true, model: 'gpt-5.6-sol', harness: 'codex', family: 'gpt', plannerFamily: 'claude' });
    expect(resolveHarnessImpl).toHaveBeenCalledWith('gpt-5.6-sol');
  });

  it('dereferences a workhorse ref', async () => {
    const result = await resolvePlanCritic({
      plannerModel: 'claude-opus-4-8',
      config: { roles: { plan: { model: 'workhorse:expensive', sub: { critic: { model: 'workhorse:cheap' } } } }, workhorses },
      resolveHarnessImpl: vi.fn().mockResolvedValue('codex'),
    });
    expect(result).toMatchObject({ ok: true, model: 'gpt-5.6-sol', family: 'gpt' });
  });
});

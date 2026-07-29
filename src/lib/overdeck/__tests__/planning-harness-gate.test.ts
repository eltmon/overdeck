import { describe, it, expect } from 'vitest';
import { resolvePlanningEffectiveHarness } from '../planning-sessions.js';

describe('resolvePlanningEffectiveHarness (PAN-1837 review fix)', () => {
  it('returns the requested harness unchanged when there is no model override', () => {
    expect(resolvePlanningEffectiveHarness('kimi-code', undefined, undefined)).toBe('kimi-code');
    expect(resolvePlanningEffectiveHarness('claude-code', undefined, undefined)).toBe('claude-code');
  });

  it('returns kimi-code unchanged when the override model is a Kimi model', () => {
    expect(resolvePlanningEffectiveHarness('kimi-code', 'kimi-code/k3', undefined)).toBe('kimi-code');
  });

  it('throws instead of silently substituting claude-code when the harness/model pair is denied', () => {
    // kimi-code paired with a non-Kimi model is denied by harness-policy's
    // KIMI_CODE_KIMI_ONLY_BLOCK — the previous behavior silently returned
    // 'claude-code' here, making an explicit kimi-code planning request
    // unreachable the moment a caller also passed a model override.
    expect(() => resolvePlanningEffectiveHarness('kimi-code', 'claude-sonnet-5', undefined)).toThrow(
      /Kimi Code harness runs Kimi \(Moonshot\) models only/,
    );
  });

  it('throws instead of silently substituting claude-code for a denied acp/model pair', () => {
    expect(() => resolvePlanningEffectiveHarness('acp', 'claude-sonnet-5', undefined)).toThrow(
      /ACP currently supports the Kimi provider only/,
    );
  });

  it('allows claude-code and codex regardless of model override', () => {
    expect(resolvePlanningEffectiveHarness('claude-code', 'claude-sonnet-5', undefined)).toBe('claude-code');
    expect(resolvePlanningEffectiveHarness('codex', 'claude-sonnet-5', undefined)).toBe('codex');
  });
});
